import { z } from 'zod';

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
