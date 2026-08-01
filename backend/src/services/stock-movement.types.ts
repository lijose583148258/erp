import prisma from '../config/database';

export type TransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type StockSourceType =
  | 'warehouse_initial'
  | 'warehouse_manual_inbound'
  | 'warehouse_adjustment'
  | 'warehouse_transfer'
  | 'production_consumption'
  | 'production_output'
  | 'procurement_receipt'
  | 'shipping_issue'
  | 'barter_receipt'
  | 'barter_issue'
  | 'barter_receipt_reversal'
  | 'barter_issue_reversal';

export interface StockMovementLineInput {
  locationId: number;
  materialId?: number | null;
  shelfLifeDays?: number | null;
  productName: string;
  batchNo: string;
  quantityDelta: number;
  unit?: string;
  unitCost?: number | null;
  costAmountDelta?: number | null;
  /** Required by absolute-balance adjustments to prevent lost updates. */
  expectedQuantityBefore?: number | null;
}

export interface PostStockEntryInput {
  sourceType: StockSourceType;
  sourceRef?: string | null;
  reason?: string | null;
  note?: string | null;
  createdBy?: number | null;
  lines: StockMovementLineInput[];
}

export interface StockEntryResult {
  entry: Record<string, unknown>;
  movements: Record<string, unknown>[];
  balances: Record<string, unknown>[];
}

export interface StockEntryListFilters {
  sourceType?: string;
  sourceRef?: string;
  productName?: string;
  batchNo?: string;
  locationId?: number;
  warehouseId?: number;
}
