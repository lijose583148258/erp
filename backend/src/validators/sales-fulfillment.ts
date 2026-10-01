import { z } from 'zod';

const requestKey = z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9:_-]+$/);
// Other fulfillment options remain explicit non-goals. Never accept a label
// that the write and closeout paths cannot actually prove.
export const createSalesFulfillmentPlanSchema = z.object({
  idempotencyKey: requestKey,
  orderItemId: z.coerce.number().int().positive(),
  fulfillmentOption: z.literal('linked_purchase'),
  sourceDocumentId: z.coerce.number().int().positive(),
  plannedQuantity: z.coerce.number().positive().max(1_000_000_000),
  expectedFulfillmentAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().min(3).max(1000),
}).strict();

export const approveSalesFulfillmentPlanSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const closeSalesFulfillmentPlanSchema = z.object({
  idempotencyKey: requestKey,
  reason: z.string().trim().min(3).max(1000),
}).strict();
