
import { z } from 'zod';

export { createCustomerSchema, customerContactSchema, updateCustomerPoolSchema, updateCustomerSchema } from './customer';
export { createAdjustmentSchema, createProductionBomSchema, createProductionQualityCheckSchema, createProductionWorkOrderSchema, updateProductionStepSchema, updateProductionWorkOrderStatusSchema } from './production';

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
const customerSegmentSchema = z.enum(['direct', 'channel', 'mixed']);
const poolStateSchema = z.enum(['public', 'internal', 'private']);
const orderStatusSchema = z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);
const purchaseStatusSchema = z.enum(['pending', 'approved', 'in_transit', 'received', 'cancelled', 'confirmed', 'shipped', 'delivered']);
const shipmentStatusSchema = z.enum(['pending', 'in_transit', 'delivered', 'exception']);
const rmaStatusSchema = z.enum(['approved', 'rejected']);
const receiptDiscrepancyStatusSchema = z.enum(['pending', 'in_review', 'resolved', 'cancelled']);
const receiptDiscrepancyTypeSchema = z.enum([
  'short_shipped',
  'quality_rejected',
  'damaged',
  'wrong_item',
  'over_received',
  'late_delivery',
  'document_mismatch',
  'customer_short_signed',
  'customer_damaged',
  'other',
]);
const receiptToleranceActionSchema = z.enum(['allow', 'warn', 'block', 'manual_review']);
const receiptDiscrepancyActionTypeSchema = z.enum([
  'quality_check',
  'customer_rma',
  'supplier_return',
  'replacement_shipment',
  'credit_or_deduction',
  'stock_adjustment',
  'accept_with_concession',
  'close_no_action',
]);
const receiptDiscrepancyActionStatusSchema = z.enum(['pending', 'approved', 'posted', 'cancelled']);
const receiptToleranceSourceTypeSchema = z.enum(['all', 'purchase_receipt', 'shipment_receipt']);
const receiptToleranceCounterpartyTypeSchema = z.enum(['all', 'supplier', 'customer']);
const receiptToleranceDiscrepancyTypeSchema = z.enum([
  'all',
  'short_shipped',
  'quality_rejected',
  'damaged',
  'wrong_item',
  'over_received',
  'late_delivery',
  'document_mismatch',
  'customer_short_signed',
  'customer_damaged',
  'other',
]);
const promiseStatusSchema = z.enum(['kept', 'missed', 'cancelled']);
const disputeStatusSchema = z.enum(['reviewing', 'resolved', 'rejected', 'withdrawn']);
const barterCounterpartyTypeSchema = z.enum(['customer', 'supplier', 'other']);
const barterSettlementModeSchema = z.enum(['barter', 'mixed', 'cash_top_up', 'cash_refund']);
const barterStatusSchema = z.enum(['draft', 'quoted', 'approved', 'posted', 'reversed', 'closed']);
const barterAgreementStatusSchema = z.enum(['draft', 'active', 'partial', 'completed', 'closed', 'terminated']);
const barterSideSchema = z.enum(['our', 'counterparty']);

const orderItemSchema = z.object({
  productName: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  unit: z.string().trim().optional(),
  specification: z.string().trim().optional(),
  itemType: z.string().trim().optional(),
  notes: z.string().trim().optional(),
}).passthrough();

const barterItemSchema = z.object({
  side: barterSideSchema,
  itemName: z.string().trim().min(1),
  specification: z.string().trim().optional(),
  unit: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  qualityFactor: z.coerce.number().positive().optional(),
  lossFactor: z.coerce.number().positive().optional(),
  marketValue: z.coerce.number().nonnegative().optional(),
  valuationMethod: z.string().trim().optional(),
  sourceDocument: z.string().trim().optional(),
  note: z.string().trim().optional(),
}).passthrough();

export const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(1000).optional(),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  riskLevel: riskLevelSchema.optional(),
  segment: customerSegmentSchema.optional(),
  poolState: poolStateSchema.optional(),
  salespersonId: z.coerce.number().int().positive().optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  viewMode: z.enum(['my', 'public']).optional(),
}).passthrough();

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const salesOrderIdParamSchema = z.object({
  salesOrderId: z.coerce.number().int().positive(),
});

export const orderPaymentVerifyParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  paymentId: z.coerce.number().int().positive(),
});

export const statusUpdateSchema = z.object({
  status: orderStatusSchema,
}).passthrough();

export const purchaseStatusUpdateSchema = z.object({
  status: purchaseStatusSchema,
}).passthrough();

export const createShipmentSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  orderId: z.preprocess(
    value => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().positive().optional().nullable()
  ),
  productName: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().optional(),
  packageType: z.string().trim().optional(),
  carrier: z.string().trim().optional(),
  trackingNo: z.string().trim().optional(),
  isColdChain: z.coerce.boolean().optional(),
  temperature: z.coerce.number().optional().nullable(),
  batchNo: z.string().trim().optional(),
  notes: z.string().trim().optional(),
}).passthrough();

export const updateShipmentStatusSchema = z.object({
  status: shipmentStatusSchema.exclude(['delivered']),
  trackingNo: z.string().trim().max(120).optional(),
}).strict();

export const uploadShipmentReceiptSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  dataUrl: z.string().trim().min(32).max(7_200_000),
}).strict();

export const createShipmentReceiptEventSchema = z.object({
  quantity: z.coerce.number().positive(),
  acceptedQuantity: z.coerce.number().nonnegative().optional(),
  rejectedQuantity: z.coerce.number().nonnegative().optional(),
  discrepancyType: receiptDiscrepancyTypeSchema.optional(),
  note: z.string().trim().optional(),
  discrepancyReason: z.string().trim().optional(),
  fileName: z.string().trim().min(1).max(160).optional(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']).optional(),
  dataUrl: z.string().trim().min(32).max(7_200_000).optional(),
}).strict().superRefine((value, ctx) => {
  const accepted = value.acceptedQuantity ?? value.quantity;
  const rejected = value.rejectedQuantity ?? 0;
  if (Math.abs((accepted + rejected) - value.quantity) > 0.000001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'acceptedQuantity + rejectedQuantity must equal quantity',
    });
  }

  const fileFields = [value.fileName, value.mimeType, value.dataUrl].filter(Boolean).length;
  if (fileFields > 0 && fileFields < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dataUrl'],
      message: 'fileName, mimeType and dataUrl must be provided together',
    });
  }
});

export const resolveReceiptDiscrepancySchema = z.object({
  status: receiptDiscrepancyStatusSchema,
  resolution: z.string().trim().optional(),
  actionRef: z.string().trim().optional(),
  note: z.string().trim().optional(),
}).strict();

export const createReceiptToleranceRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sourceType: receiptToleranceSourceTypeSchema.optional(),
  discrepancyType: receiptToleranceDiscrepancyTypeSchema.optional(),
  counterpartyType: receiptToleranceCounterpartyTypeSchema.optional(),
  counterpartyId: z.coerce.number().int().positive().optional().nullable(),
  productName: z.string().trim().min(1).max(200).optional().nullable(),
  quantityTolerancePercent: z.coerce.number().min(0).max(1000).optional().nullable(),
  quantityToleranceAbs: z.coerce.number().min(0).optional().nullable(),
  actionWithinTolerance: receiptToleranceActionSchema.optional(),
  actionOutsideTolerance: receiptToleranceActionSchema.optional(),
  severityWithinTolerance: z.string().trim().max(40).optional().nullable(),
  severityOutsideTolerance: z.string().trim().max(40).optional().nullable(),
  requiresQualityCheck: z.coerce.boolean().optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
  priority: z.coerce.number().int().min(1).max(9999).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
}).strict();

export const createReceiptDiscrepancyActionSchema = z.object({
  actionType: receiptDiscrepancyActionTypeSchema,
  status: receiptDiscrepancyActionStatusSchema.optional().nullable(),
  quantity: z.coerce.number().positive().optional().nullable(),
  unit: z.string().trim().min(1).max(40).optional().nullable(),
  amount: z.coerce.number().optional().nullable(),
  currency: z.string().trim().min(3).max(8).optional().nullable(),
  reasonCode: z.string().trim().max(80).optional().nullable(),
  dispositionCode: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(800).optional().nullable(),
}).strict();

export const createRmaSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  productName: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().optional(),
  reason: z.string().trim().min(1),
  type: z.string().trim().optional(),
  notes: z.string().trim().optional(),
}).passthrough();

export const resolveRmaSchema = z.object({
  status: rmaStatusSchema,
  resolution: z.string().trim().optional(),
  refundAmount: z.coerce.number().nonnegative().optional(),
}).passthrough();

export const createOrderSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  items: z.array(orderItemSchema).min(1),
  paymentTerms: z.coerce.number().int().positive().optional(),
  discountAmount: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().optional(),
  contractId: z.coerce.number().int().positive().optional().nullable(),
  currency: z.string().trim().optional(),
  status: z.string().trim().optional(),
}).passthrough();

export const updateOrderSchema = z.object({
  notes: z.string().trim().optional(),
  paymentTerms: z.coerce.number().int().positive().optional(),
  contractId: z.coerce.number().int().positive().optional().nullable(),
}).passthrough().refine(
  value => Object.keys(value).length > 0,
  { message: '至少提供一个可更新字段' }
);

const assetTransactionActionSchema = z.enum(['inbound', 'outbound']);

export const createAssetTransactionSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  assetType: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  quantity: z.coerce.number().int().positive(),
  action: assetTransactionActionSchema,
  note: z.string().trim().optional(),
}).strict().refine(
  value => Boolean(value.assetType || value.type),
  { message: 'assetType 或 type 至少提供一个' }
);

export const createProductBatchSchema = z.object({
  batchNo: z.string().trim().min(1).optional(),
  productName: z.string().trim().min(1),
  productionDate: z.string().trim().min(1),
  expiryDate: z.string().trim().min(1),
  storageTemp: z.string().trim().optional(),
  isColdChain: z.coerce.boolean().optional(),
  stockQuantity: z.coerce.number().nonnegative(),
  unit: z.string().trim().min(1),
  notes: z.string().trim().optional(),
}).strict().superRefine((value, ctx) => {
  const productionDate = new Date(value.productionDate);
  const expiryDate = new Date(value.expiryDate);
  if (Number.isNaN(productionDate.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productionDate'], message: '生产日期无效' });
  }
  if (Number.isNaN(expiryDate.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryDate'], message: '到期日期无效' });
  }
  if (!Number.isNaN(productionDate.getTime()) && !Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() < productionDate.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryDate'], message: '到期日期不能早于生产日期' });
  }
});

export const updateProductBatchSchema = z.object({
  productName: z.string().trim().min(1).optional(),
  productionDate: z.string().trim().min(1).optional(),
  expiryDate: z.string().trim().min(1).optional(),
  storageTemp: z.string().trim().optional(),
  isColdChain: z.coerce.boolean().optional(),
  stockQuantity: z.coerce.number().nonnegative().optional(),
  unit: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '至少提供一个可更新字段' });
  }
  if (value.productionDate !== undefined) {
    const productionDate = new Date(value.productionDate);
    if (Number.isNaN(productionDate.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productionDate'], message: '生产日期无效' });
    }
  }
  if (value.expiryDate !== undefined) {
    const expiryDate = new Date(value.expiryDate);
    if (Number.isNaN(expiryDate.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryDate'], message: '到期日期无效' });
    }
  }
  if (value.productionDate !== undefined && value.expiryDate !== undefined) {
    const productionDate = new Date(value.productionDate);
    const expiryDate = new Date(value.expiryDate);
    if (!Number.isNaN(productionDate.getTime()) && !Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() < productionDate.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiryDate'], message: '到期日期不能早于生产日期' });
    }
  }
});

// LEGACY DISCONNECTED: kept only for historical imports. `/api/timber/*` returns 410 Gone.
export const calculateTimberVolumeSchema = z.object({
  length: z.coerce.number().positive(),
  width: z.coerce.number().positive(),
  thickness: z.coerce.number().positive(),
  pieces: z.coerce.number().int().positive().optional(),
  species: z.string().trim().optional(),
}).strict();

// LEGACY DISCONNECTED: kept only for historical imports. Use barter settlement APIs instead.
export const convertTimberToPurchaseSchema = z.object({
  orderItemId: z.coerce.number().int().positive(),
  supplierId: z.coerce.number().int().positive(),
}).strict();

export const currencyConvertSchema = z.object({
  amount: z.coerce.number().positive(),
  from: z.enum(['CNY', 'USD', 'VND', 'EUR', 'HKD']),
  to: z.enum(['CNY', 'USD', 'VND', 'EUR', 'HKD']),
}).strict();

export const refreshTokenSchema = z.object({
  refreshToken: z.string().trim().min(1),
}).strict();

export const appendContractItemsSchema = z.object({
  items: z.array(z.unknown()).optional(),
  note: z.string().trim().optional(),
}).strict().refine(
  value => (Array.isArray(value.items) && value.items.length > 0) || Boolean(value.note),
  { message: '至少提供 items 或 note 其中之一' }
);

export const orderQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(1000).optional(),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
}).passthrough();

export const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.string().trim().min(1),
  payerName: z.string().trim().optional(),
  note: z.string().trim().optional(),
  isProxy: z.coerce.boolean().optional(),
}).passthrough();

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1),
  nameZh: z.string().trim().optional(),
  nameEn: z.string().trim().optional(),
  nameVi: z.string().trim().optional(),
  nameAliases: z.union([z.string(), z.array(z.string())]).optional(),
  contacts: z.union([z.string(), z.array(z.record(z.string(), z.any()))]).optional(),
  addresses: z.union([z.string(), z.array(z.record(z.string(), z.any()))]).optional(),
  category: z.string().trim().min(1),
  rating: z.coerce.number().positive().max(5).optional(),
  leadTimeDays: z.coerce.number().int().positive().optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  contact: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).passthrough();

const contractMilestoneInputSchema = z.object({
  title: z.string().trim().min(1),
  percentage: z.coerce.number().positive(),
}).strict();

export const createContractSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1),
  type: z.enum(['sales', 'purchase']).optional().default('sales'),
  totalAmount: z.coerce.number().nonnegative(),
  currency: z.string().trim().optional().default('CNY'),
  signedAt: z.string().trim().optional().nullable(),
  expiredAt: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  fileUrl: z.string().trim().optional().nullable(),
  ocrMetadata: z.union([z.record(z.string(), z.any()), z.string()]).optional().nullable(),
  milestones: z.array(contractMilestoneInputSchema).optional(),
}).strict();

export const updateContractSchema = z.object({
  title: z.string().trim().optional(),
  type: z.enum(['sales', 'purchase']).optional(),
  totalAmount: z.coerce.number().nonnegative().optional(),
  currency: z.string().trim().optional(),
  signedAt: z.string().trim().optional().nullable(),
  expiredAt: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  fileUrl: z.string().trim().optional().nullable(),
  ocrMetadata: z.union([z.record(z.string(), z.any()), z.string()]).optional().nullable(),
  status: z.string().trim().optional(),
}).passthrough().refine(
  value => Object.keys(value).length > 0,
  { message: '至少提供一个可更新字段' }
);

export const createPurchaseOrderSchema = z.object({
  supplierId: z.coerce.number().int().positive(),
  item: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  currency: z.string().trim().min(1).max(8).optional(),
  exchangeRate: z.coerce.number().positive().optional(),
  taxRate: z.coerce.number().nonnegative().optional(),
  taxAmount: z.coerce.number().nonnegative().optional(),
  freightCost: z.coerce.number().nonnegative().optional(),
  dutyCost: z.coerce.number().nonnegative().optional(),
  insuranceCost: z.coerce.number().nonnegative().optional(),
  otherCost: z.coerce.number().nonnegative().optional(),
  eta: z.string().trim().min(1),
  status: purchaseStatusSchema.optional(),
  salesOrderRef: z.string().trim().optional(),
  salesOrderId: z.coerce.number().int().positive().optional().nullable(),
  isB2B: z.coerce.boolean().optional(),
}).passthrough();

export const createPurchaseReceiptSchema = z.object({
  quantity: z.coerce.number().positive(),
  acceptedQuantity: z.coerce.number().nonnegative().optional(),
  rejectedQuantity: z.coerce.number().nonnegative().optional(),
  discrepancyType: receiptDiscrepancyTypeSchema.optional(),
  batchNo: z.string().trim().optional(),
  receivedAt: z.string().trim().optional(),
  note: z.string().trim().optional(),
  discrepancyReason: z.string().trim().optional(),
}).strict().superRefine((value, ctx) => {
  const accepted = value.acceptedQuantity ?? value.quantity;
  const rejected = value.rejectedQuantity ?? 0;
  if (Math.abs((accepted + rejected) - value.quantity) > 0.000001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'acceptedQuantity + rejectedQuantity must equal quantity',
    });
  }

  if (value.receivedAt) {
    const receivedAt = new Date(value.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receivedAt'],
        message: 'receivedAt must be a valid date',
      });
    }
  }
});

export const createBarterSettlementSchema = z.object({
  counterpartyType: barterCounterpartyTypeSchema,
  counterpartyName: z.string().trim().min(1),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  orderId: z.coerce.number().int().positive().optional().nullable(),
  settlementMode: barterSettlementModeSchema.optional(),
  currency: z.string().trim().optional(),
  valuationDate: z.string().trim().optional().nullable(),
  note: z.string().trim().optional(),
  items: z.array(barterItemSchema).min(1),
}).passthrough();

export const barterPreviewSchema = createBarterSettlementSchema;

export const createBarterAgreementSchema = z.object({
  counterpartyType: barterCounterpartyTypeSchema,
  counterpartyName: z.string().trim().min(1),
  customerId: z.coerce.number().int().positive().optional().nullable(),
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  orderId: z.coerce.number().int().positive().optional().nullable(),
  settlementMode: barterSettlementModeSchema.optional(),
  currency: z.string().trim().optional(),
  agreementDate: z.string().trim().optional().nullable(),
  valuationDate: z.string().trim().optional().nullable(),
  note: z.string().trim().optional(),
  items: z.array(barterItemSchema).min(1),
}).passthrough();

export const createBarterBatchSchema = z.object({
  orderId: z.coerce.number().int().positive().optional().nullable(),
  valuationDate: z.string().trim().optional().nullable(),
  note: z.string().trim().optional(),
  items: z.array(barterItemSchema).min(1),
}).passthrough();

export const barterAgreementListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().optional(),
  status: barterAgreementStatusSchema.optional(),
  counterpartyType: barterCounterpartyTypeSchema.optional(),
}).passthrough();

export const barterListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().optional(),
  status: barterStatusSchema.optional(),
  counterpartyType: barterCounterpartyTypeSchema.optional(),
}).passthrough();

export const barterApproveSchema = z.object({
  note: z.string().trim().optional(),
}).passthrough();

export const barterPostSchema = z.object({
  orderId: z.coerce.number().int().positive().optional().nullable(),
  postingAmount: z.coerce.number().positive().optional(),
  offsetType: z.string().trim().optional(),
  note: z.string().trim().optional(),
}).passthrough();

export const barterReverseSchema = z.object({
  reason: z.string().trim().min(1),
}).passthrough();

export const batchReminderSchema = z.object({
  orderIds: z.array(z.coerce.number().int().positive()).min(1),
}).passthrough();

export const createPromiseSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  orderId: z.coerce.number().int().positive(),
  promisedAmount: z.coerce.number().positive(),
  promisedAt: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  contactName: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  note: z.string().trim().optional(),
}).passthrough();

export const updatePromiseStatusSchema = z.object({
  status: promiseStatusSchema,
}).passthrough();

export const createDisputeSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  orderId: z.coerce.number().int().positive(),
  disputedAmount: z.coerce.number().nonnegative().optional().nullable(),
  reasonCategory: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  evidenceJson: z.string().trim().optional().nullable(),
  note: z.string().trim().optional(),
}).passthrough();

export const updateDisputeStatusSchema = z.object({
  status: disputeStatusSchema,
}).passthrough();

export const customerHoldSchema = z.object({
  type: z.enum(['credit', 'shipment']),
  reason: z.string().trim().min(1),
  source: z.string().trim().optional(),
}).passthrough();

export const customerHoldReleaseSchema = z.object({
  type: z.enum(['credit', 'shipment']),
  reason: z.string().trim().optional(),
}).passthrough();

export const orderHoldSchema = z.object({
  reason: z.string().trim().min(1),
  source: z.string().trim().optional(),
}).passthrough();
