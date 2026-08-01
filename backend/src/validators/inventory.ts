import { z } from 'zod';

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
  materialId: z.coerce.number().int().positive(),
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
