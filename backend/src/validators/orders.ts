import { z } from 'zod';

const promiseStatusSchema = z.enum(['kept', 'missed', 'cancelled']);
const disputeStatusSchema = z.enum(['reviewing', 'resolved', 'rejected', 'withdrawn']);
const paymentMethodSchema = z.enum([
  'bank_transfer',
  'cash',
  'check',
  'alipay_wechat',
  'wire_transfer',
  'Bank Transfer',
  'Cash',
  'Check',
  'Alipay/WeChat',
]).transform(method => {
  switch (method) {
    case 'Bank Transfer': return 'bank_transfer';
    case 'Cash': return 'cash';
    case 'Check': return 'check';
    case 'Alipay/WeChat': return 'alipay_wechat';
    default: return method;
  }
});

const orderItemSchema = z.object({
  materialId: z.coerce.number().int().positive().optional().nullable(),
  productName: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  unit: z.string().trim().max(20).optional(),
  specification: z.string().trim().max(120).optional(),
  packagingSpec: z.string().trim().max(120).optional(),
  itemType: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
}).passthrough();

export const createOrderSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  items: z.array(orderItemSchema).min(1),
  paymentTerms: z.coerce.number().int().min(1).max(365).optional(),
  discountAmount: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().max(1000).optional(),
  contractId: z.coerce.number().int().positive().optional().nullable(),
  currency: z.string().trim().optional(),
  status: z.string().trim().optional(),
}).passthrough();

export const importOrdersSchema = z.object({
  orders: z.array(z.object({
    customerId: z.coerce.number().int().positive(),
    paymentTerms: z.coerce.number().int().min(1).max(365).optional(),
    items: z.array(orderItemSchema.strip()).min(1).max(100),
  }).strict()).min(1).max(500),
}).strict();

export const updateOrderSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  items: z.array(orderItemSchema).min(1).optional(),
  paymentTerms: z.coerce.number().int().min(1).max(365).optional(),
  contractId: z.coerce.number().int().positive().optional().nullable(),
}).passthrough().refine(
  value => Object.keys(value).length > 0,
  { message: '至少提供一个可更新字段' }
);

export const orderQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
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
  method: paymentMethodSchema,
  payerName: z.string().trim().optional(),
  note: z.string().trim().optional(),
  isProxy: z.coerce.boolean().optional(),
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
