import api, { ApiRequestOptions } from '../utils/api';
import { Customer, CustomerPoolHistoryEntry } from '../types';
import { splitCustomerTextList } from '../utils/customerAlias';
import { getCustomerPoolState, isCustomerInPublicPool } from '../utils/customerPool';
import { normalizeCustomerAddresses } from '../utils/customerAddressV2';
import { ApiDataResponse, toApiRecord, toNumberValue, toOptionalString, toStringValue, toUnknownArray } from '../utils/apiMapping';

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

const isKnownPoolState = (value: unknown): value is Customer['poolState'] =>
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

export const customerService = {
    /**
     * 获取全部客户。
     * 当前为了兼容存量前端逻辑，一次性拉取较大的分页窗口；
     * 后续应改造成真正的前端分页。
     */
    async getAll(options: ApiRequestOptions = {}): Promise<Customer[]> {
        // 当前阶段先覆盖本地单机常见数据量。
        const response = await api.get<unknown, ApiDataResponse<unknown[]>>('/customers?pageSize=1000', { signal: options.signal });

        // 统一成前端当前使用的数据结构。
        return toUnknownArray(response.data).map(mapCustomerResponse);
    },

    /**
     * 创建客户
     */
    async create(customer: Partial<Customer>): Promise<Customer> {
        const response = await api.post<unknown, ApiDataResponse<unknown>>('/customers', customer);
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

    /**
     * 导出客户
     */
    async exportUrl(): Promise<string> {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('未找到登录令牌');
        }
        return `${api.defaults.baseURL}/customers/export?token=${encodeURIComponent(token)}`;
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

