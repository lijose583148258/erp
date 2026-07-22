import api from '../utils/api';

/** 仓库实体 */
export interface Warehouse {
  id: number;
  code: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  locations: WarehouseLocation[];
  _summary: { totalItems: number; totalQuantity: number };
}

/** 库位实体 */
export interface WarehouseLocation {
  id: number;
  warehouseId: number;
  code: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  stockBalances: StockBalanceRecord[];
}

/** 库存余额实体 */
export interface StockBalanceRecord {
  id: number;
  locationId: number;
  productName: string;
  batchNo: string;
  quantity: number;
  unit: string;
  lastMoveAt: string | null;
  createdAt: string;
  updatedAt: string;
  warehouseName?: string;
  warehouseCode?: string;
  locationName?: string;
  locationCode?: string;
}

export interface StockMovementRecord {
  id: number;
  entryId: number;
  stockBalanceId: number;
  locationId: number;
  productName: string;
  batchNo: string;
  unit: string;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  createdAt: string;
  warehouseName?: string;
  warehouseCode?: string;
  locationName?: string;
  locationCode?: string;
}

export interface StockEntryRecord {
  id: number;
  entryNo: string;
  sourceType: string;
  sourceRef: string | null;
  direction: string;
  status: string;
  reason: string | null;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  postedAt: string | null;
  warehouseId: number | null;
  locationId: number | null;
  warehouseName?: string;
  warehouseCode?: string;
  locationName?: string;
  locationCode?: string;
  movementCount: number;
  netQuantityDelta: number;
  movements: StockMovementRecord[];
}

export const normalizeWarehouseLocation = (location: WarehouseLocation): WarehouseLocation => ({
  ...location,
  stockBalances: Array.isArray(location.stockBalances) ? location.stockBalances : [],
});

export const normalizeWarehouseRecord = (warehouse: Warehouse): Warehouse => ({
  ...warehouse,
  locations: Array.isArray(warehouse.locations) ? warehouse.locations.map(normalizeWarehouseLocation) : [],
  _summary: warehouse._summary || { totalItems: 0, totalQuantity: 0 },
});

export const warehouseService = {
  /** 获取全部仓库（含库位和库存汇总） */
  async listWarehouses(): Promise<Warehouse[]> {
    const response = await api.get<any, { success: boolean; data: Warehouse[] }>('/warehouses');
    return (response.data || []).map(normalizeWarehouseRecord);
  },

  /** 创建仓库 */
  async createWarehouse(data: { code: string; name: string; type?: string }): Promise<Warehouse> {
    const response = await api.post<any, { success: boolean; data: Warehouse }>('/warehouses', data);
    return normalizeWarehouseRecord(response.data);
  },

  /** 创建库位 */
  async createLocation(warehouseId: number, data: { code: string; name: string; type?: string }): Promise<WarehouseLocation> {
    const response = await api.post<any, { success: boolean; data: WarehouseLocation }>(`/warehouses/${warehouseId}/locations`, data);
    return normalizeWarehouseLocation(response.data);
  },

  /** 查询全局库存台账 */
  async listStockBalances(params?: {
    productName?: string;
    batchNo?: string;
    warehouseId?: number;
    locationId?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: StockBalanceRecord[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const response = await api.get<any, { success: boolean; data: StockBalanceRecord[]; meta: any }>('/warehouses/stock-balances', { params });
    return { data: response.data || [], meta: response.meta || { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
  },

  /** 查询库存凭证/流水 */
  async listStockEntries(params?: {
    limit?: number;
    sourceType?: string;
    sourceRef?: string;
    productName?: string;
    batchNo?: string;
    warehouseId?: number;
    locationId?: number;
  }): Promise<StockEntryRecord[]> {
    const response = await api.get<any, { success: boolean; data: StockEntryRecord[] }>('/warehouses/stock-entries', { params });
    return Array.isArray(response.data) ? response.data : [];
  },

  /** 手动录入库存 */
  async createStockBalance(data: {
    locationId: number;
    productName: string;
    batchNo: string;
    quantity: number;
    unit?: string;
    sourceRef: string;
    reason: string;
    note?: string;
  }): Promise<StockBalanceRecord> {
    const response = await api.post<any, { success: boolean; data: StockBalanceRecord }>('/warehouses/stock-balances', data);
    return response.data;
  },

  /** 调整指定库存记录的数量 */
  async updateStockBalance(id: number, data: {
    quantity: number;
    expectedQuantity: number;
    requestId: string;
    note?: string;
  }): Promise<StockBalanceRecord> {
    const response = await api.patch<any, { success: boolean; data: StockBalanceRecord }>(`/warehouses/stock-balances/${id}`, data);
    return response.data;
  },

  /** 调拨指定库存记录到另一个库位 */
  async transferStockBalance(id: number, data: {
    toLocationId: number;
    quantity: number;
    note?: string;
    requestId: string;
  }): Promise<{
    sourceRef: string;
    fromLocationId: number;
    toLocationId: number;
    productName: string;
    batchNo: string;
    quantity: number;
    unit: string;
    stockEntry: Record<string, unknown>;
    movements: Record<string, unknown>[];
    balances: StockBalanceRecord[];
  }> {
    const response = await api.post<any, { success: boolean; data: any }>(`/warehouses/stock-balances/${id}/transfer`, data);
    return response.data;
  },
};
