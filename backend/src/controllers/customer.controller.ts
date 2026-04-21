
import { Response } from 'express';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { logger } from '../utils/logger';
import { withDbRetry } from '../utils/dbRetry';
import { buildCustomerExportWorkbook, buildCustomerImportData } from '../services/customer-io.service';
import type { CustomerImportData } from '../services/customer-io.service';
import { OrderWorkspaceService } from '../services/order-workspace.service';
import { getPrimaryCustomerAddress } from '../utils/customerAddressV2';
import {
  buildCustomerExportWhere,
  buildCustomerWhere,
  canCreateCustomer,
  canEditCustomerProfile,
  canImportCustomer,
  canManageCustomerPool,
  canViewCustomerSensitiveRelations,
  getNormalizedUserSegment,
  isOwnCustomerOperator,
  resolveWritableSegment,
  validateAssignedSalesperson,
} from './customer/customer.access';
import {
  buildCustomerPayload,
  deriveAddresses,
  deriveContacts,
  getCustomerDisplayName,
  isSalesPoolChangeAllowed,
  normalizeCustomerContacts,
  normalizePoolState,
  pickCustomerName,
  resolvePoolAuditAction,
  serializeCustomerAliases,
} from './customer/customer.payload';
import {
  loadCustomerAddressMap,
  loadCustomerContactMap,
  loadCustomerForRequest,
  loadOrderStats,
  parseAuditDetails,
  persistCustomerAddresses,
  persistCustomerContacts,
  writeCustomerAuditLog,
} from './customer/customer.persistence';
import { CustomerPoolAction, CustomerPoolState, CustomerSegment, MAX_CUSTOMER_PAGE_SIZE } from './customer/customer.types';

type CustomerRequestBody = Record<string, unknown>;

const asRequestBody = (value: unknown): CustomerRequestBody =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as CustomerRequestBody : {};

const toOptionalString = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

const toNullableString = (value: unknown) => toOptionalString(value) || null;

const toCustomerPoolState = (value: unknown, fallback: CustomerPoolState): CustomerPoolState => {
  return value === 'public' || value === 'internal' || value === 'private' ? value : fallback;
};

export class CustomerController {
  async getCustomers(req: AuthRequest, res: Response) {
    try {
      const {
        page = 1,
        pageSize = MAX_CUSTOMER_PAGE_SIZE,
        search,
        status,
        riskLevel,
        segment,
        poolState,
        salespersonId,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;

      const limit = Math.min(Number(pageSize) || MAX_CUSTOMER_PAGE_SIZE, MAX_CUSTOMER_PAGE_SIZE);
      const offset = (Number(page) - 1) * limit;
      const filters: Prisma.CustomerWhereInput = {};
      const sortKeyMap: Record<string, string> = {
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        name: 'name',
        creditLimit: 'creditLimit',
        overdueAmount: 'overdueAmount',
        riskLevel: 'riskLevel',
        poolUpdatedAt: 'poolUpdatedAt',
        salespersonId: 'salespersonId',
      };
      const resolvedSortBy = sortKeyMap[String(sortBy)] || 'createdAt';
      const resolvedSortOrder = String(sortOrder) === 'asc' ? 'asc' : 'desc';

      if (search) {
        filters.OR = [
          { name: { contains: String(search) } },
          { nameZh: { contains: String(search) } },
          { nameEn: { contains: String(search) } },
          { nameVi: { contains: String(search) } },
          { nameAliases: { contains: String(search) } },
          { licenseNumber: { contains: String(search) } },
          { contactName: { contains: String(search) } },
          { contactPhone: { contains: String(search) } },
          { contactEmail: { contains: String(search) } },
        ];
      }

      if (status) filters.status = String(status);
      if (riskLevel) filters.riskLevel = String(riskLevel);
      if (segment) filters.segment = String(segment);
      if (poolState) filters.poolState = String(poolState);
      if (salespersonId) filters.salespersonId = Number(salespersonId);

      const where = buildCustomerWhere(req, filters);

      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: { [resolvedSortBy]: resolvedSortOrder } as Prisma.CustomerOrderByWithRelationInput,
          include: {
            salesperson: { select: { id: true, username: true } },
            poolUpdatedByUser: { select: { id: true, username: true } },
          },
        }),
        prisma.customer.count({ where }),
      ]);

      const [addressMap, contactMap, orderStatsMap] = await Promise.all([
        loadCustomerAddressMap(customers.map(customer => customer.id)),
        loadCustomerContactMap(customers.map(customer => customer.id)),
        loadOrderStats(customers.map(customer => customer.id)),
      ]);

      const data = customers.map(customer => buildCustomerPayload(
        {
          ...customer,
          address: addressMap.get(customer.id)?.address || customer.address || null,
          addressesJson: addressMap.get(customer.id)?.addressesJson || null,
          contactsJson: contactMap.get(customer.id)?.contactsJson || null,
        },
        orderStatsMap.get(customer.id),
      ));

      return res.json({
        success: true,
        data,
        meta: {
          page: Number(page),
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户列表错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async getCustomerStats(req: AuthRequest, res: Response) {
    try {
      const customers = await prisma.customer.findMany({
        where: buildCustomerWhere(req),
        select: {
          id: true,
          riskLevel: true,
          segment: true,
          poolState: true,
          overdueAmount: true,
          creditHold: true,
          shipmentHold: true,
          status: true,
          salespersonId: true,
        },
      });

      const totalCustomers = customers.length;
      const publicPoolCustomers = customers.filter(customer => normalizePoolState(customer) === 'public').length;
      const internalPoolCustomers = customers.filter(customer => normalizePoolState(customer) === 'internal').length;
      const privatePoolCustomers = customers.filter(customer => normalizePoolState(customer) === 'private').length;
      const directCustomers = customers.filter(customer => customer.segment === 'direct').length;
      const channelCustomers = customers.filter(customer => customer.segment === 'channel').length;
      const mixedCustomers = customers.filter(customer => !customer.segment || customer.segment === 'mixed').length;
      const creditHoldCustomers = customers.filter(customer => customer.creditHold).length;
      const shipmentHoldCustomers = customers.filter(customer => customer.shipmentHold).length;
      const overdueAmount = customers.reduce((sum, customer) => sum + Number(customer.overdueAmount || 0), 0);

      return res.json({
        success: true,
        data: {
          totalCustomers,
          activeCustomers: customers.filter(customer => customer.status === 'active').length,
          publicPoolCustomers,
          internalPoolCustomers,
          privatePoolCustomers,
          directCustomers,
          channelCustomers,
          mixedCustomers,
          creditHoldCustomers,
          shipmentHoldCustomers,
          overdueAmount,
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户统计错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async getCustomerById(req: AuthRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      const customer = await loadCustomerForRequest(req, id);

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      const [statsMap] = await Promise.all([loadOrderStats([customer.id])]);

      return res.json({
        success: true,
        data: buildCustomerPayload(customer, statsMap.get(customer.id)),
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户详情错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async createCustomer(req: AuthRequest, res: Response) {
    try {
      if (!canCreateCustomer(req)) {
        return res.status(403).json({
          success: false,
          message: '当前角色不能创建客户',
        } as ApiResponse);
      }

      const body = asRequestBody(req.body);
      const contacts = normalizeCustomerContacts(Array.isArray(body.contacts) ? body.contacts : []);
      const primaryContact = contacts.find(contact => contact.isPrimary) || contacts[0] || null;
      const contactName = body.contactName ?? primaryContact?.name ?? null;
      const contactPhone = body.contactPhone ?? primaryContact?.phone ?? null;
      const contactEmail = body.contactEmail ?? primaryContact?.email ?? null;
      const addresses = deriveAddresses(body, Array.isArray(body.addresses) ? body.addresses : undefined);
      const primaryAddress = getPrimaryCustomerAddress({ addresses, address: toNullableString(body.address) });

      const isSales = isOwnCustomerOperator(req);
      const userSegment = getNormalizedUserSegment(req);
      const poolState: CustomerPoolState = isSales ? 'private' : toCustomerPoolState(body.poolState, 'internal');
      let salespersonId: number | null = null;

      if (poolState === 'private') {
        salespersonId = isSales ? req.user!.userId : Number(body.salespersonId || body.assignedSalespersonId || 0) || null;
        if (!salespersonId) {
          return res.status(400).json({
            success: false,
            message: '私海客户必须指定销售负责人',
          } as ApiResponse);
        }
      }

      const segmentResolution = resolveWritableSegment(req, body.segment, userSegment || 'mixed');
      if (!segmentResolution.ok) {
        return res.status(403).json({
          success: false,
          message: segmentResolution.message,
        } as ApiResponse);
      }

      if (salespersonId) {
        const salespersonCheck = await validateAssignedSalesperson(salespersonId, segmentResolution.segment);
        if (!salespersonCheck.ok) {
          return res.status(400).json({
            success: false,
            message: salespersonCheck.message,
          } as ApiResponse);
        }
      }

      const customerData: Prisma.CustomerCreateInput = {
          name: String(pickCustomerName(body) || ''),
          nameZh: toNullableString(body.nameZh),
          nameEn: toNullableString(body.nameEn),
          nameVi: toNullableString(body.nameVi),
          nameAliases: serializeCustomerAliases(body.nameAliases),
          licenseNumber: toNullableString(body.licenseNumber),
          creditLimit: body.creditLimit !== undefined ? Number(body.creditLimit) : null,
          overdueAmount: 0,
          riskLevel: toOptionalString(body.riskLevel) || 'low',
          collectionsStatus: 'normal',
          dunningLevel: 0,
          nextActionAt: null,
          creditHold: false,
          creditHoldReason: null,
          creditHoldSource: null,
          creditHoldUpdatedAt: null,
          shipmentHold: false,
          shipmentHoldReason: null,
          shipmentHoldSource: null,
          shipmentHoldUpdatedAt: null,
          segment: segmentResolution.segment,
          poolState,
          poolReason: toNullableString(body.poolReason),
          poolUpdatedAt: new Date(),
          poolUpdatedByUser: { connect: { id: req.user!.userId } },
          status: toOptionalString(body.status) || 'active',
          contactName: toNullableString(contactName),
          contactPhone: toNullableString(contactPhone),
          contactEmail: toNullableString(contactEmail),
          address: primaryAddress?.fullAddress || toNullableString(body.address),
          notes: toNullableString(body.notes),
          ...(salespersonId ? { salesperson: { connect: { id: salespersonId } } } : {}),
        };

      const created = await withDbRetry(() => prisma.$transaction(async (tx) => {
        const createdCustomer = await tx.customer.create({
          data: customerData,
          include: {
            salesperson: { select: { id: true, username: true } },
            poolUpdatedByUser: { select: { id: true, username: true } },
          },
        });

        await persistCustomerAddresses(tx, createdCustomer.id, addresses);
        await persistCustomerContacts(tx, createdCustomer.id, contacts);
        return createdCustomer;
      }), { label: 'createCustomer' });

      await writeCustomerAuditLog({
        userId: req.user!.userId,
        action: 'CREATE',
        resourceId: created.id,
        details: `创建客户: ${created.name}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return res.status(201).json({
        success: true,
        data: buildCustomerPayload(created, undefined, {
          contacts,
          addresses,
          licenseUrl: body.licenseUrl,
          licenseStatus: body.licenseStatus,
          termsDays: Number(body.termsDays || 30),
        }),
        message: '客户创建成功',
      } as ApiResponse);
    } catch (error) {
      logger.error('创建客户错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async updateCustomer(req: AuthRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      const existing = await loadCustomerForRequest(req, id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      if (req.user?.role === 'sales' && !isSalesPoolChangeAllowed(existing, req.body || {})) {
        return res.status(403).json({
          success: false,
          message: '销售角色不能修改客户池归属',
        } as ApiResponse);
      }

      const body = asRequestBody(req.body);
      if (!canEditCustomerProfile(req, existing)) {
        return res.status(403).json({
          success: false,
          message: '当前角色对该客户仅有查看权限',
        } as ApiResponse);
      }

      if (
        body.poolState !== undefined ||
        body.salespersonId !== undefined ||
        body.assignedSalespersonId !== undefined ||
        body.poolReason !== undefined
      ) {
        return res.status(400).json({
          success: false,
          message: '客户池归属只能通过专用池接口调整',
        } as ApiResponse);
      }

      const contacts = body.contacts !== undefined
        ? normalizeCustomerContacts(Array.isArray(body.contacts) ? body.contacts : [])
        : deriveContacts(existing);
      const primaryContact = contacts.find(contact => contact.isPrimary) || contacts[0] || null;
      const contactName = body.contacts !== undefined
        ? (body.contactName ?? primaryContact?.name ?? null)
        : (body.contactName ?? primaryContact?.name ?? existing.contactName);
      const contactPhone = body.contacts !== undefined
        ? (body.contactPhone ?? primaryContact?.phone ?? null)
        : (body.contactPhone ?? primaryContact?.phone ?? existing.contactPhone);
      const contactEmail = body.contacts !== undefined
        ? (body.contactEmail ?? primaryContact?.email ?? null)
        : (body.contactEmail ?? primaryContact?.email ?? existing.contactEmail);
      const addresses = body.addresses !== undefined
        ? deriveAddresses(body, Array.isArray(body.addresses) ? body.addresses : undefined)
        : deriveAddresses(existing);
      const primaryAddress = getPrimaryCustomerAddress({ addresses, address: toNullableString(body.address || existing.address) });

      const updateData: Prisma.CustomerUpdateInput = {};
      if (body.name !== undefined) updateData.name = String(body.name);
      else if (body.nameZh !== undefined || body.nameEn !== undefined || body.nameVi !== undefined) {
        updateData.name = String(body.nameZh || body.nameEn || body.nameVi || existing.name);
      }
      if (body.nameZh !== undefined) updateData.nameZh = toNullableString(body.nameZh);
      if (body.nameEn !== undefined) updateData.nameEn = toNullableString(body.nameEn);
      if (body.nameVi !== undefined) updateData.nameVi = toNullableString(body.nameVi);
      if (body.nameAliases !== undefined) updateData.nameAliases = serializeCustomerAliases(body.nameAliases);
      if (body.licenseNumber !== undefined) updateData.licenseNumber = toNullableString(body.licenseNumber);
      if (body.creditLimit !== undefined) updateData.creditLimit = body.creditLimit === '' ? null : Number(body.creditLimit);
      if (body.riskLevel !== undefined) updateData.riskLevel = String(body.riskLevel);
      if (body.segment !== undefined) {
        const segmentResolution = resolveWritableSegment(req, body.segment, (existing.segment as CustomerSegment) || 'mixed');
        if (!segmentResolution.ok) {
          return res.status(403).json({
            success: false,
            message: segmentResolution.message,
          } as ApiResponse);
        }
        updateData.segment = segmentResolution.segment;
      }
      if (body.status !== undefined) updateData.status = String(body.status);
      if (body.address !== undefined || body.addresses !== undefined) {
        updateData.address = primaryAddress?.fullAddress || toNullableString(body.address);
      }
      if (body.notes !== undefined) updateData.notes = toNullableString(body.notes);
      if (body.contactName !== undefined || body.contacts !== undefined) updateData.contactName = toNullableString(contactName);
      if (body.contactPhone !== undefined || body.contacts !== undefined) updateData.contactPhone = toNullableString(contactPhone);
      if (body.contactEmail !== undefined || body.contacts !== undefined) updateData.contactEmail = toNullableString(contactEmail);

      const resolvedName = String(updateData.name ?? existing.name ?? '').trim();
      if (!resolvedName) {
        return res.status(400).json({
          success: false,
          message: '客户至少需要保留一个公司名称',
        } as ApiResponse);
      }
      updateData.name = resolvedName;

      const updated = await withDbRetry(() => prisma.$transaction(async (tx) => {
        const updatedCustomer = await tx.customer.update({
          where: { id },
          data: updateData,
          include: {
            salesperson: { select: { id: true, username: true } },
            poolUpdatedByUser: { select: { id: true, username: true } },
          },
        });

        if (body.address !== undefined || body.addresses !== undefined) {
          await persistCustomerAddresses(tx, updatedCustomer.id, addresses);
        }
        if (body.contacts !== undefined) {
          await persistCustomerContacts(tx, updatedCustomer.id, contacts);
        }

        return updatedCustomer;
      }), { label: 'updateCustomer' });

      await writeCustomerAuditLog({
        userId: req.user!.userId,
        action: 'UPDATE',
        resourceId: updated.id,
        details: `更新客户: ${updated.name}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      const statsMap = await loadOrderStats([updated.id]);

      return res.json({
        success: true,
        data: buildCustomerPayload(updated, statsMap.get(updated.id), {
          contacts,
          addresses,
          licenseUrl: body.licenseUrl,
          licenseStatus: body.licenseStatus,
          termsDays: Number(body.termsDays || 30),
        }),
        message: '客户更新成功',
      } as ApiResponse);
    } catch (error) {
      logger.error('更新客户错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async deleteCustomer(req: AuthRequest, res: Response) {
    try {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: '仅管理员可停用客户',
        } as ApiResponse);
      }

      const id = Number(req.params.id);
      const existing = await prisma.customer.findUnique({
        where: { id },
        select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true, nameAliases: true, status: true },
      });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
        return res.status(403).json({
          success: false,
          message: '当前角色无权停用客户',
        } as ApiResponse);
      }

      const updated = await prisma.customer.update({
        where: { id },
        data: { status: 'inactive' },
        select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true, nameAliases: true },
      });

      await writeCustomerAuditLog({
        userId: req.user!.userId,
        action: 'DELETE',
        resourceId: updated.id,
        details: `停用客户: ${getCustomerDisplayName(updated)}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return res.json({
        success: true,
        data: updated,
        message: '客户已停用',
      } as ApiResponse);
    } catch (error) {
      logger.error('删除客户错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async importCustomers(req: AuthRequest, res: Response) {
    try {
      if (!canImportCustomer(req)) {
        return res.status(403).json({
          success: false,
          message: '当前角色不能导入客户',
        } as ApiResponse);
      }

      const importBody = asRequestBody(req.body);
      const payload = Array.isArray(req.body)
        ? req.body
        : Array.isArray(importBody.customers)
          ? importBody.customers
          : [];
      const { result, validCustomers } = await buildCustomerImportData(req, payload);
      result.success = 0;
      result.imported = 0;

      if (validCustomers.length > 0) {
        for (const customer of validCustomers as CustomerImportData[]) {
          const { addresses, contacts, salespersonId, __row, ...rest } = customer;
          if (salespersonId) {
            const salespersonCheck = await validateAssignedSalesperson(Number(salespersonId), (rest.segment as CustomerSegment) || 'mixed');
            if (!salespersonCheck.ok) {
              result.failed += 1;
              result.errors.push({
                row: __row || result.success + result.failed,
                message: salespersonCheck.message,
              });
              continue;
            }
          }
          try {
            await withDbRetry(() => prisma.$transaction(async (tx) => {
              const created = await tx.customer.create({
                data: {
                  ...rest,
                  poolUpdatedAt: new Date(),
                  poolUpdatedByUser: { connect: { id: req.user!.userId } },
                  ...(salespersonId ? { salesperson: { connect: { id: salespersonId } } } : {}),
                },
              });

              await persistCustomerAddresses(tx, created.id, addresses);
              await persistCustomerContacts(tx, created.id, contacts || []);
            }), { label: 'importCustomer' });
            result.success += 1;
            result.imported = result.success;
          } catch (error) {
            result.failed += 1;
            result.errors.push({
              row: __row || result.success + result.failed,
              message: error instanceof Error ? error.message : '客户导入失败',
            });
          }
        }
      }

      await writeCustomerAuditLog({
        userId: req.user!.userId,
        action: 'IMPORT',
        details: `批量导入客户: success ${result.success}, failed ${result.failed}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return res.json({
        success: true,
        data: {
          ...result,
          imported: result.imported || result.success,
        },
        message: '客户导入完成',
      } as ApiResponse);
    } catch (error) {
      logger.error('导入客户错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async exportCustomers(req: AuthRequest, res: Response) {
    try {
      const { workbook, customers } = await buildCustomerExportWorkbook(req, {
        status: req.query.status,
        riskLevel: req.query.riskLevel,
      }, buildCustomerExportWhere(req));

      const fileName = `customers_${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

      await writeCustomerAuditLog({
        userId: req.user!.userId,
        action: 'EXPORT',
        details: `导出客户: ${customers.length}`,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      logger.error('导出客户错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async getCustomerOrders(req: AuthRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      const customer = await loadCustomerForRequest(req, id);

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      const result = await OrderWorkspaceService.getOrders(
        {
          customerId: id,
          page: 1,
          pageSize: MAX_CUSTOMER_PAGE_SIZE,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
        req,
      );

      return res.json({
        success: true,
        data: result.data,
        meta: result.meta,
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户订单错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async getCustomerRmas(req: AuthRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      const customer = await loadCustomerForRequest(req, id);

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      const rmas = await prisma.rma.findMany({
        where: {
          customerId: id,
          ...(req.user?.role === 'sales' ? { createdBy: req.user.userId } : {}),
        },
        include: {
          creator: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({
        success: true,
        data: rmas.map(rma => ({
          ...rma,
          quantity: Number(rma.quantity),
          refundAmount: rma.refundAmount !== null ? Number(rma.refundAmount) : null,
          createdAt: rma.createdAt.toISOString(),
          resolvedAt: rma.resolvedAt ? rma.resolvedAt.toISOString() : null,
          creatorName: rma.creator.username,
        })),
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户售后错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async getCustomerAssets(req: AuthRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      const customer = await loadCustomerForRequest(req, id);

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      if (!canViewCustomerSensitiveRelations(req, customer)) {
        return res.status(403).json({
          success: false,
          message: '当前角色无权查看该客户的资产流转明细',
        } as ApiResponse);
      }

      const [balances, transactions] = await Promise.all([
        prisma.assetBalance.findMany({
          where: { customerId: id },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.assetTransaction.findMany({
          where: { customerId: id },
          include: {
            creator: { select: { id: true, username: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      return res.json({
        success: true,
        data: {
          balances: balances.map(balance => ({
            id: balance.id,
            customerId: balance.customerId,
            assetType: balance.assetType,
            balance: Number(balance.balance),
            updatedAt: balance.updatedAt.toISOString(),
          })),
          transactions: transactions.map(transaction => ({
            id: transaction.id,
            customerId: transaction.customerId,
            assetType: transaction.assetType,
            quantity: Number(transaction.quantity),
            action: transaction.action,
            relatedOrderNo: transaction.relatedOrderNo,
            note: transaction.note,
            createdAt: transaction.createdAt.toISOString(),
            creatorName: transaction.creator.username,
          })),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户资产错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async updateCustomerPool(req: AuthRequest, res: Response) {
    try {
      if (!canManageCustomerPool(req)) {
        return res.status(403).json({
          success: false,
          message: '当前角色不能调整客户池',
        } as ApiResponse);
      }

      const id = Number(req.params.id);
      const existing = await loadCustomerForRequest(req, id);

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      const poolState = req.body.poolState as CustomerPoolState;
      const reason = req.body.reason || null;
      const requestedSalespersonId = req.body.salespersonId !== undefined && req.body.salespersonId !== null
        ? Number(req.body.salespersonId)
        : null;

      let salespersonId: number | null = null;
      if (poolState === 'private') {
        salespersonId = requestedSalespersonId || existing.salespersonId || null;
        if (!salespersonId) {
          return res.status(400).json({
            success: false,
            message: '私海客户必须指定销售负责人',
          } as ApiResponse);
        }
      }

      const previousPoolState = normalizePoolState(existing);
      const nextSalespersonId = poolState === 'private' ? salespersonId : null;
      const samePool =
        previousPoolState === poolState &&
        String(existing.salespersonId || '') === String(nextSalespersonId || '');

      const existingAddressMap = await loadCustomerAddressMap([existing.id]);
      const existingAddresses = deriveAddresses({
        ...existing,
        addressesJson: existingAddressMap.get(existing.id)?.addressesJson || null,
      });

      if (samePool) {
        return res.json({
          success: true,
          data: buildCustomerPayload(existing, undefined, { addresses: existingAddresses }),
          message: '客户池未变更',
        } as ApiResponse);
      }

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: '客户池变更必须填写原因',
        } as ApiResponse);
      }

      if (nextSalespersonId) {
        const salespersonCheck = await validateAssignedSalesperson(nextSalespersonId, (existing.segment as CustomerSegment) || 'mixed');
        if (!salespersonCheck.ok) {
          return res.status(400).json({
            success: false,
            message: salespersonCheck.message,
          } as ApiResponse);
        }
      }

      const updated = await withDbRetry(() => prisma.customer.update({
        where: { id },
        data: {
          poolState,
          salesperson: nextSalespersonId ? { connect: { id: nextSalespersonId } } : { disconnect: true },
          poolReason: reason,
          poolUpdatedAt: new Date(),
          poolUpdatedByUser: { connect: { id: req.user!.userId } },
        },
        include: {
          salesperson: { select: { id: true, username: true } },
          poolUpdatedByUser: { select: { id: true, username: true } },
        },
      }), { label: 'updateCustomerPool' });

      const action = resolvePoolAuditAction(previousPoolState, poolState);

      await writeCustomerAuditLog({
        userId: req.user!.userId,
        action,
        resourceId: updated.id,
        details: JSON.stringify({
          previousPoolState,
          nextPoolState: poolState,
          salespersonId: nextSalespersonId,
          reason,
        }),
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return res.json({
        success: true,
        data: buildCustomerPayload(updated, undefined, { addresses: existingAddresses }),
        message: '客户池更新成功',
      } as ApiResponse);
    } catch (error) {
      logger.error('更新客户池错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }

  async getCustomerPoolHistory(req: AuthRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      const existing = await loadCustomerForRequest(req, id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: '客户不存在',
        } as ApiResponse);
      }

      if (!canViewCustomerSensitiveRelations(req, existing)) {
        return res.status(403).json({
          success: false,
          message: '当前角色无权查看该客户的池归属历史',
        } as ApiResponse);
      }

      const logs = await prisma.auditLog.findMany({
        where: {
          resource: 'customer',
          resourceId: id,
          action: {
            in: ['POOL_ASSIGN', 'POOL_RELEASE', 'POOL_RECLAIM', 'POOL_TRANSFER'] satisfies CustomerPoolAction[],
          },
        },
        include: {
          user: { select: { id: true, username: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const salespersonIds = Array.from(new Set([
        ...logs
          .map(log => parseAuditDetails(log.details).salespersonId)
          .filter((value): value is number => typeof value === 'number'),
        ...(existing.salespersonId ? [existing.salespersonId] : []),
      ]));

      const salespeople = salespersonIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: salespersonIds } },
            select: { id: true, username: true },
          })
        : [];
      const salespersonNameMap = new Map(salespeople.map(user => [user.id, user.username]));

      const history = logs.map((log) => {
        const details = parseAuditDetails(log.details);
        return {
          id: log.id,
          action: log.action,
          previousPoolState: details.previousPoolState || null,
          nextPoolState: details.nextPoolState || null,
          salespersonId: details.salespersonId != null ? String(details.salespersonId) : null,
          salespersonName: details.salespersonId != null ? (salespersonNameMap.get(Number(details.salespersonId)) || null) : null,
          reason: details.reason || null,
          operatorName: log.user.username,
          operatorRole: log.user.role,
          createdAt: log.createdAt.toISOString(),
        };
      });

      return res.json({
        success: true,
        data: {
          customerId: existing.id,
          history,
          latest: history[0] || null,
          currentPool: {
            poolState: normalizePoolState(existing),
            salespersonId: existing.salespersonId != null ? String(existing.salespersonId) : null,
            salespersonName: existing.salesperson?.username || null,
            poolReason: existing.poolReason || null,
            poolUpdatedAt: existing.poolUpdatedAt ? existing.poolUpdatedAt.toISOString() : null,
            poolUpdatedBy: existing.poolUpdatedByUser?.username || null,
          },
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('获取客户池历史错误:', error);
      return res.status(500).json({
        success: false,
        message: '服务器内部错误',
      } as ApiResponse);
    }
  }
}
