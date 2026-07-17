import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { buildCustomerWhere } from '../controllers/customer/customer.access';
import { buildCustomerPayload, normalizePoolState } from '../controllers/customer/customer.payload';
import {
  loadCustomerAddressMap,
  loadCustomerContactMap,
  loadOrderStats,
} from '../controllers/customer/customer.persistence';
import { DEFAULT_CUSTOMER_PAGE_SIZE, MAX_CUSTOMER_PAGE_SIZE } from '../controllers/customer/customer.types';
import { buildCustomerSearchWhereAsync } from './search.service';

export type CustomerListQuery = {
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
  status?: unknown;
  riskLevel?: unknown;
  segment?: unknown;
  poolState?: unknown;
  viewMode?: unknown;
  salespersonId?: unknown;
  sortBy?: unknown;
  sortOrder?: unknown;
};

const CUSTOMER_SORT_KEY_MAP: Record<string, keyof Prisma.CustomerOrderByWithRelationInput> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  name: 'name',
  creditLimit: 'creditLimit',
  overdueAmount: 'overdueAmount',
  riskLevel: 'riskLevel',
  poolUpdatedAt: 'poolUpdatedAt',
  salespersonId: 'salespersonId',
};

export const resolveCustomerListQuery = (query: CustomerListQuery) => {
  const resolvedPage = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSizeInput = Number(query.pageSize ?? DEFAULT_CUSTOMER_PAGE_SIZE) || DEFAULT_CUSTOMER_PAGE_SIZE;
  const pageSize = Math.min(pageSizeInput, MAX_CUSTOMER_PAGE_SIZE);
  const offset = (resolvedPage - 1) * pageSize;
  const sortBy = CUSTOMER_SORT_KEY_MAP[String(query.sortBy || 'createdAt')] || 'createdAt';
  const sortOrder = String(query.sortOrder) === 'asc' ? 'asc' : 'desc';

  return {
    page: resolvedPage,
    pageSize,
    offset,
    sortBy,
    sortOrder,
  };
};

export const buildCustomerListFilters = async (query: CustomerListQuery): Promise<Prisma.CustomerWhereInput> => {
  const filters: Prisma.CustomerWhereInput = {};
  Object.assign(filters, await buildCustomerSearchWhereAsync(query.search));

  if (query.status) filters.status = String(query.status);
  if (query.riskLevel) filters.riskLevel = String(query.riskLevel);
  if (query.segment) filters.segment = String(query.segment);
  if (query.poolState) filters.poolState = String(query.poolState);
  if (query.viewMode === 'public') filters.poolState = 'public';
  if (query.viewMode === 'my') filters.NOT = { poolState: 'public' };
  if (query.salespersonId) filters.salespersonId = Number(query.salespersonId);

  return filters;
};

export const CustomerQueryService = {
  async listCustomers(query: CustomerListQuery, req: AuthRequest) {
    const resolved = resolveCustomerListQuery(query);
    const filters = await buildCustomerListFilters(query);
    const where = buildCustomerWhere(req, filters);

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: resolved.offset,
        take: resolved.pageSize,
        orderBy: { [resolved.sortBy]: resolved.sortOrder } as Prisma.CustomerOrderByWithRelationInput,
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

    return {
      data,
      meta: {
        page: resolved.page,
        pageSize: resolved.pageSize,
        total,
        totalPages: Math.ceil(total / resolved.pageSize),
      },
    };
  },

  async getCustomerStats(req: AuthRequest) {
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

    const publicPoolCustomers = customers.filter(customer => normalizePoolState(customer) === 'public').length;
    const internalPoolCustomers = customers.filter(customer => normalizePoolState(customer) === 'internal').length;
    const privatePoolCustomers = customers.filter(customer => normalizePoolState(customer) === 'private').length;
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

    return {
      totalCustomers: customers.length,
      activeCustomers: customers.filter(customer => customer.status === 'active').length,
      publicPoolCustomers,
      internalPoolCustomers,
      privatePoolCustomers,
      directCustomers: customers.filter(customer => customer.segment === 'direct').length,
      channelCustomers: customers.filter(customer => customer.segment === 'channel').length,
      mixedCustomers: customers.filter(customer => !customer.segment || customer.segment === 'mixed').length,
      creditHoldCustomers: customers.filter(customer => customer.creditHold).length,
      shipmentHoldCustomers: customers.filter(customer => customer.shipmentHold).length,
      overdueAmount: customers.reduce((sum, customer) => sum + Number(customer.overdueAmount || 0), 0),
      segmentBreakdown,
    };
  },
};
