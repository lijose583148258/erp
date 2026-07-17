import api, { ApiRequestOptions } from '../utils/api';
import { Customer, CustomerPoolHistoryEntry } from '../../types';
import { splitCustomerTextList } from '../../utils/customerAlias';
import { getCustomerPoolState, isCustomerInPublicPool } from '../../utils/customerPool';
import { normalizeCustomerAddresses } from '../../utils/customerAddressV2';
import { ApiDataResponse, toApiRecord, toNumberValue, toOptionalString, toStringValue, toUnknownArray } from '../../utils/apiMapping';

const parseContacts = (value: unknown): Customer['contacts'] => {
  if (!value) return [];
  if (Array.isArray(value)) return value as Customer['contacts'];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as Customer['contacts'] : [];
    } catch {
      return [];
    }
  }
  return [];
};

const isKnownPoolState = (value: unknown): value is NonNullable<Customer['poolState']> =>
    value === 'public' || value === 'internal' || value === 'private';

const isKnownPoolAction = (value: unknown): value is CustomerPoolHistoryEntry['action'] =>
    value === 'POOL_ASSIGN' || value === 'POOL_RELEASE' || value === 'POOL_RECLAIM' || value === 'POOL_TRANSFER';

const mapPoolHistoryEntry = (value: unknown): CustomerPoolHistoryEntry => {
    const item = toApiRecord(value);
    return {
        id: toNumberValue(item.id),
        action: isKnownPoolAction(item.action) ? item.action : 'POOL_ASSIGN',
        previousPoolState: isKnownPoolState(item.previousPoolState) ? item.previousPoolState : null,
        nextPoolState: isKnownPoolState(item.nextPoolState) ? item.nextPoolState : null,
        salespersonId: toOptionalString(item.salespersonId) || null,
        salespersonName: toOptionalString(item.salespersonName) || null,
        reason: toOptionalString(item.reason) || null,
        operatorName: toStringValue(item.operatorName || item.operator || item.userName),
        operatorRole: item.operatorRole as CustomerPoolHistoryEntry['operatorRole'],
        createdAt: toStringValue(item.createdAt, new Date().toISOString()),
    };
};

const mapPoolHistoryResponse = (value: unknown): {
    customerId: number;
    history: CustomerPoolHistoryEntry[];
    latest: CustomerPoolHistoryEntry | null;
    currentPool: {
        poolState: 'public' | 'internal' | 'private';
        salespersonId: string | null;
        salespersonName?: string | null;
        poolReason: string | null;
        poolUpdatedAt: string | null;
        poolUpdatedBy: string | null;
    };
} => {
    const item = toApiRecord(value);
    const currentPool = toApiRecord(item.currentPool);
    const history = toUnknownArray(item.history).map(mapPoolHistoryEntry);
    return {
        customerId: toNumberValue(item.customerId),
        history,
        latest: item.latest ? mapPoolHistoryEntry(item.latest) : history[0] || null,
        currentPool: {
            poolState: isKnownPoolState(currentPool.poolState) ? currentPool.poolState : 'public',
            salespersonId: toOptionalString(currentPool.salespersonId) || null,
            salespersonName: toOptionalString(currentPool.salespersonName) || null,
            poolReason: toOptionalString(currentPool.poolReason) || null,
            poolUpdatedAt: toOptionalString(currentPool.poolUpdatedAt) || null,
            poolUpdatedBy: toOptionalString(currentPool.poolUpdatedBy) || null,
        },
    };
};

const mapCustomerResponse = (value: unknown): Customer => {
    const item = toApiRecord(value);
    const statistics = toApiRecord(item.statistics);
    const poolSource = {
        poolState: isKnownPoolState(item.poolState) ? item.poolState : undefined,
        isPublicPool: Boolean(item.isPublicPool),
    };
    const poolState = getCustomerPoolState(poolSource);

    return {
        ...item,
        id: toStringValue(item.id),
        name: toStringValue(item.name),
        contacts: parseContacts(item.contacts),
        creditLimit: toNumberValue(item.creditLimit),
        usedCredit: toNumberValue(item.usedCredit),
        termsDays: toNumberValue(item.termsDays),
        riskLevel: (item.riskLevel || 'low') as Customer['riskLevel'],
        lastOrderDate: toStringValue(item.lastOrderDate),
        status: (item.status || 'active') as Customer['status'],
        segment: item.segment as Customer['segment'],
        nameZh: toOptionalString(item.nameZh),
        nameEn: toOptionalString(item.nameEn),
        nameVi: toOptionalString(item.nameVi),
        nameAliases: parseAliasesSafe(item.nameAliases),
        addresses: normalizeCustomerAddresses(item.addresses || item.addressesJson || item.address || null),
        poolState,
        isPublicPool: isCustomerInPublicPool({ poolState, isPublicPool: Boolean(item.isPublicPool) }),
        assignedSalespersonId: toOptionalString(item.salespersonId),
        historicalOrderCount: toNumberValue(statistics.totalOrders),
        avgOrderInterval: toNumberValue(statistics.avgOrderInterval),
    };
};

export type CustomerListParams = {
    page?: number;
    pageSize?: number;
    search?: string;
    segment?: 'direct' | 'channel' | 'mixed';
    viewMode?: 'my' | 'public';
};

export type CustomerPage = {
    rows: Customer[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
};

export type CustomerStats = {
    total: number;
    publicPool: number;
    internalPool: number;
    privatePool: number;
    overdueAmount: number;
    creditHoldCount: number;
    shipmentHoldCount: number;
    segmentBreakdown: Array<{
        segment: 'direct' | 'channel' | 'mixed';
        total: number;
        publicPool: number;
        internalPool: number;
        privatePool: number;
        overdueAmount: number;
        creditHoldCount: number;
        shipmentHoldCount: number;
    }>;
};

export const customerService = {
    async getPage(params: CustomerListParams, options: ApiRequestOptions = {}): Promise<CustomerPage> {
        const query = new URLSearchParams();
        query.set('page', String(params.page || 1));
        query.set('pageSize', String(params.pageSize || 30));
        if (params.search?.trim()) query.set('search', params.search.trim());
        if (params.segment) query.set('segment', params.segment);
        if (params.viewMode) query.set('viewMode', params.viewMode);

        const response = await api.get<unknown, ApiDataResponse<unknown[]>>(`/customers?${query.toString()}`, { signal: options.signal });
        return {
            rows: toUnknownArray(response.data).map(mapCustomerResponse),
            page: Number(response.meta?.page || params.page || 1),
            pageSize: Number(response.meta?.pageSize || params.pageSize || 30),
            total: Number(response.meta?.total || 0),
            totalPages: Math.max(1, Number(response.meta?.totalPages || 1)),
        };
    },

    async getStats(options: ApiRequestOptions = {}): Promise<CustomerStats> {
        const response = await api.get<unknown, ApiDataResponse<unknown>>('/customers/stats', { signal: options.signal });
        const stats = toApiRecord(response.data);
        const breakdown = toUnknownArray(stats.segmentBreakdown).map((value) => {
            const item = toApiRecord(value);
            const segment: 'direct' | 'channel' | 'mixed' =
                item.segment === 'direct' || item.segment === 'channel' ? item.segment : 'mixed';
            return {
                segment,
                total: toNumberValue(item.total),
                publicPool: toNumberValue(item.publicPool),
                internalPool: toNumberValue(item.internalPool),
                privatePool: toNumberValue(item.privatePool),
                overdueAmount: toNumberValue(item.overdueAmount),
                creditHoldCount: toNumberValue(item.creditHoldCount),
                shipmentHoldCount: toNumberValue(item.shipmentHoldCount),
            };
        });
        return {
            total: toNumberValue(stats.totalCustomers),
            publicPool: toNumberValue(stats.publicPoolCustomers),
            internalPool: toNumberValue(stats.internalPoolCustomers),
            privatePool: toNumberValue(stats.privatePoolCustomers),
            overdueAmount: toNumberValue(stats.overdueAmount),
            creditHoldCount: toNumberValue(stats.creditHoldCustomers),
            shipmentHoldCount: toNumberValue(stats.shipmentHoldCustomers),
            segmentBreakdown: breakdown,
        };
    },

    /**
     * Legacy compatibility snapshot for selector-style consumers.
     * Main customer tables must use getPage so search, sort, export, and page
     * counts are always server-side and unambiguous.
     */
    async getAll(options: ApiRequestOptions = {}): Promise<Customer[]> {
        const page = await this.getPage({ page: 1, pageSize: 100 }, options);
        return page.rows;
    },

    /**
     * 创建客户
     */
    async create(customer: Partial<Customer>): Promise<Customer> {
        const response = await api.post<unknown, ApiDataResponse<unknown>>('/customers', customer);
        return mapCustomerResponse(response.data);
    },

    async getById(id: string | number, options: ApiRequestOptions = {}): Promise<Customer> {
        const response = await api.get<unknown, ApiDataResponse<unknown>>(`/customers/${id}`, { signal: options.signal });
        return mapCustomerResponse(response.data);
    },

    /**
     * 更新客户
     */
    async update(customer: Customer): Promise<Customer> {
        const payload = {
            name: customer.name,
            nameZh: customer.nameZh,
            nameEn: customer.nameEn,
            nameVi: customer.nameVi,
            nameAliases: customer.nameAliases,
            licenseNumber: customer.licenseNumber,
            creditLimit: customer.creditLimit,
            riskLevel: customer.riskLevel,
            status: customer.status,
            address: customer.address,
            addresses: customer.addresses,
            notes: customer.notes,
            contactName: customer.contactName,
            contactPhone: customer.contactPhone,
            contactEmail: customer.contactEmail,
            contacts: customer.contacts,
            licenseUrl: customer.licenseUrl,
            licenseStatus: customer.licenseStatus,
        };
        const response = await api.put<unknown, ApiDataResponse<unknown>>(`/customers/${customer.id}`, payload);
        return mapCustomerResponse(response.data);
    },

    /**
     * 更新客户池状态
     */
    async updatePool(customerId: string, payload: { poolState: 'public' | 'internal' | 'private'; salespersonId?: string | number | null; reason?: string }): Promise<Customer> {
        const response = await api.patch<unknown, ApiDataResponse<unknown>>(`/customers/${customerId}/pool`, payload);
        return mapCustomerResponse(response.data);
    },

    async getPoolHistory(customerId: string): Promise<{
        customerId: number;
        history: CustomerPoolHistoryEntry[];
        latest: CustomerPoolHistoryEntry | null;
        currentPool: {
            poolState: 'public' | 'internal' | 'private';
            salespersonId: string | null;
            salespersonName?: string | null;
            poolReason: string | null;
            poolUpdatedAt: string | null;
            poolUpdatedBy: string | null;
        };
    }> {
        const response = await api.get<unknown, ApiDataResponse<unknown>>(`/customers/${customerId}/pool-history`);
        return mapPoolHistoryResponse(response.data);
    },

    /**
     * 批量导入客户
     */
    async import(customers: Partial<Customer>[]): Promise<Customer[]> {
        const importData = customers.map(c => {
            const source = toApiRecord(c);
            return {
            name: c.name,
            nameZh: c.nameZh,
            nameEn: c.nameEn,
            nameVi: c.nameVi,
            nameAliases: c.nameAliases,
            contacts: parseContacts(source.contacts || source.contactsJson),
            licenseNumber: 'PENDING',
            creditLimit: c.creditLimit,
            riskLevel: c.riskLevel,
            status: 'active',
            termsDays: c.termsDays,
            ...c
            };
        });

        await api.post<unknown, ApiDataResponse<{ success: number; failed: number }>>('/customers/import', importData);

        return this.getAll();
    },

    async downloadExport(params: Omit<CustomerListParams, 'page' | 'pageSize'> = {}): Promise<void> {
        const query = new URLSearchParams();
        if (params.search?.trim()) query.set('search', params.search.trim());
        if (params.segment) query.set('segment', params.segment);
        if (params.viewMode) query.set('viewMode', params.viewMode);
        const suffix = query.size ? `?${query.toString()}` : '';
        const response = await api.get<unknown, { data: Blob }>(`/customers/export${suffix}`, {
            responseType: 'blob',
        });
        const url = URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = `customers_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }
};
const parseAliasesSafe = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return splitCustomerTextList(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return splitCustomerTextList(parsed);
      }
    } catch {
      return splitCustomerTextList(value);
    }
  }
  return [];
};

