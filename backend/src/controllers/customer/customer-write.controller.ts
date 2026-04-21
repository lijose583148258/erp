import { Response } from 'express';
import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { logger } from '../../utils/logger';
import { withDbRetry } from '../../utils/dbRetry';
import { getPrimaryCustomerAddress } from '../../utils/customerAddressV2';
import {
  canCreateCustomer,
  canEditCustomerProfile,
  getNormalizedUserSegment,
  isOwnCustomerOperator,
  resolveWritableSegment,
  validateAssignedSalesperson,
} from './customer.access';
import {
  buildCustomerPayload,
  deriveAddresses,
  deriveContacts,
  getCustomerDisplayName,
  isSalesPoolChangeAllowed,
  normalizeCustomerContacts,
  pickCustomerName,
  serializeCustomerAliases,
} from './customer.payload';
import {
  loadCustomerForRequest,
  loadOrderStats,
  persistCustomerAddresses,
  persistCustomerContacts,
  writeCustomerAuditLog,
} from './customer.persistence';
import { CustomerPoolState, CustomerSegment } from './customer.types';
import { asRequestBody, toCustomerPoolState, toNullableString, toOptionalString } from './customer-request.helpers';

export async function createCustomer(req: AuthRequest, res: Response) {
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

export async function updateCustomer(req: AuthRequest, res: Response) {
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

export async function deleteCustomer(req: AuthRequest, res: Response) {
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
