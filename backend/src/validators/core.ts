import { z } from 'zod';

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
const customerSegmentSchema = z.enum(['direct', 'channel', 'mixed']);
const poolStateSchema = z.enum(['public', 'internal', 'private']);
const orderStatusSchema = z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);
const purchaseStatusSchema = z.enum(['pending', 'approved', 'in_transit', 'received', 'cancelled', 'confirmed', 'shipped', 'delivered']);

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
