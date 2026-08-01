import { z } from 'zod';

const purchaseStatusSchema = z.enum(['pending', 'approved', 'in_transit', 'received', 'cancelled', 'confirmed', 'shipped', 'delivered']);
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
  materialId: z.coerce.number().int().positive().optional().nullable(),
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
