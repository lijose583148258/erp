import type { StockSourceType } from './stock-movement.types';

export const IDEMPOTENT_SOURCE_TYPES = new Set<StockSourceType>([
  'production_consumption',
  'production_output',
  'procurement_receipt',
  'shipping_issue',
  'barter_receipt',
  'barter_issue',
  'barter_receipt_reversal',
  'barter_issue_reversal',
]);

export const PRODUCT_BATCH_SYNC_SOURCE_TYPES = new Set<StockSourceType>([
  'warehouse_initial',
  'warehouse_manual_inbound',
  'warehouse_adjustment',
  'procurement_receipt',
]);

export const DEFAULT_BATCH_SHELF_LIFE_MS = 365 * 24 * 60 * 60 * 1000;
