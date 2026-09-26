import { z } from 'zod';

const barterCounterpartyTypeSchema = z.enum(['customer', 'supplier', 'other']);
const barterSettlementModeSchema = z.enum(['barter', 'mixed', 'cash_top_up', 'cash_refund']);
const barterStatusSchema = z.enum(['draft', 'quoted', 'approved', 'posted', 'reversed', 'closed']);
const barterAgreementStatusSchema = z.enum(['draft', 'active', 'partial', 'completed', 'closed', 'terminated']);
const barterSideSchema = z.enum(['our', 'counterparty']);

const barterItemSchema = z.object({
  side: barterSideSchema,
  materialId: z.coerce.number().int().positive().optional().nullable(),
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
