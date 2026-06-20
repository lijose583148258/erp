import { z } from 'zod';

const pageQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const collectionLedgerQuerySchema = pageQuerySchema.extend({
  status: z.string().trim().optional(),
  method: z.string().trim().optional(),
  customerId: z.coerce.number().int().positive().optional(),
}).passthrough();

export const collectionOverdueQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
}).passthrough();
