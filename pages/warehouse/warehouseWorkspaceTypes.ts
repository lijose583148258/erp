import type { WarehouseLocation } from '../../services/warehouse.service';

export type TabKey = 'overview' | 'inventory' | 'inbound';

export type StockBalanceQueryOverrides = {
  keyword?: string;
  warehouseId?: string;
  locationId?: string;
};

export type InventoryFilterValues = Required<StockBalanceQueryOverrides>;

export type StockMeta = {
  page: number;
  total: number;
  totalPages: number;
};

export type WarehouseLocationOption = WarehouseLocation & {
  warehouseName: string;
  warehouseCode: string;
};

export type InboundFormState = {
  locationId: number;
  productName: string;
  batchNo: string;
  quantity: number;
  unit: string;
};

export type WarehouseDraft = {
  code: string;
  name: string;
  type: string;
};

export type LocationDraft = {
  code: string;
  name: string;
  type: string;
};
