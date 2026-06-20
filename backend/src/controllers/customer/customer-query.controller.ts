import { Response } from 'express';
import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { logger } from '../../utils/logger';
import { buildCustomerWhere } from './customer.access';
import { buildCustomerPayload, normalizePoolState } from './customer.payload';
import {
  loadCustomerAddressMap,
  loadCustomerContactMap,
  loadCustomerForRequest,
  loadOrderStats,
} from './customer.persistence';
import { MAX_CUSTOMER_PAGE_SIZE } from './customer.types';

export async function getCustomers(req: AuthRequest, res: Response) {
    try {
      const {
        page = 1,
        pageSize = MAX_CUSTOMER_PAGE_SIZE,
        search,
        status,
        riskLevel,
        segment,
        poolState,
        viewMode,
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
          { address: { contains: String(search) } },
          { addressesJson: { contains: String(search) } },
          { contactsJson: { contains: String(search) } },
        ];
      }

      if (status) filters.status = String(status);
      if (riskLevel) filters.riskLevel = String(riskLevel);
      if (segment) filters.segment = String(segment);
      if (poolState) filters.poolState = String(poolState);
      if (viewMode === 'public') filters.poolState = 'public';
      if (viewMode === 'my') filters.NOT = { poolState: 'public' };
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

export async function getCustomerStats(req: AuthRequest, res: Response) {
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
      const segmentBreakdown = (['direct', 'channel', 'mixed'] as const).map(segment => {
        const rows = customers.filter(customer => (customer.segment || 'mixed') === segment);
        return {
          segment,
          total: rows.length,
          publicPool: rows.filter(customer => normalizePoolState(customer) === 'public').length,
          internalPool: rows.filter(customer => normalizePoolState(customer) === 'internal').length,
          privatePool: rows.filter(customer => normalizePoolState(customer) === 'private').length,
          overdueAmount: rows.reduce((sum, customer) => sum + Number(customer.overdueAmount || 0), 0),
          creditHoldCount: rows.filter(customer => customer.creditHold).length,
          shipmentHoldCount: rows.filter(customer => customer.shipmentHold).length,
        };
      });

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
          segmentBreakdown,
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

export async function getCustomerById(req: AuthRequest, res: Response) {
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
