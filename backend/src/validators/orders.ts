import { z } from 'zod';

const promiseStatusSchema = z.enum(['kept', 'missed', 'cancelled']);
const disputeStatusSchema = z.enum(['reviewing', 'resolved', 'rejected', 'withdrawn']);

const orderItemSchema = z.object({
  productName: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  unit: z.string().trim().optional(),
  specification: z.string().trim().optional(),
  itemType: z.string().trim().optional(),
  notes: z.string().trim().optional(),
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
