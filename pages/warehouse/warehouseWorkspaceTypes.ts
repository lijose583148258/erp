import type { WarehouseLocation } from '../../services/warehouse.service';

export type TabKey = 'overview' | 'inventory' | 'ledger' | 'inbound';

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
  sourceRef: string;
  reason: string;
  note: string;
};

export type InboundFormErrors = Partial<Record<'locationId' | 'productName' | 'batchNo' | 'quantity' | 'sourceRef' | 'reason', string>>;

export type TransferFormState = {
  toLocationId: number;
  quantity: number;
  note: string;
};

export type TransferFormErrors = Partial<Record<'toLocationId' | 'quantity', string>>;

export type WarehouseCreateErrors = Partial<Record<'code' | 'name', string>>;

export type LocationCreateErrors = Partial<Record<'code' | 'name' | 'warehouse', string>>;

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
