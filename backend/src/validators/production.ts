import { z } from 'zod';

const adjustmentDomainSchema = z.enum(['finance', 'production', 'inventory']);
const adjustmentTargetTypeSchema = z.enum(['order', 'productBatch', 'manual']);
const productionWorkOrderStatusSchema = z.enum(['draft', 'planned', 'in_progress', 'qc_pending', 'completed', 'cancelled']);
const productionQualityResultSchema = z.enum(['pending', 'pass', 'fail']);

export const createAdjustmentSchema = z.object({
  domain: adjustmentDomainSchema,
  targetType: adjustmentTargetTypeSchema,
  targetId: z.coerce.number().int().positive().optional(),
  orderId: z.coerce.number().int().positive().optional(),
  batchId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  targetRef: z.string().trim().optional(),
  quantityDelta: z.coerce.number().optional(),
  amountDelta: z.coerce.number().optional(),
  reason: z.string().trim().min(1),
  reasonCategory: z.string().trim().optional(),
  lossType: z.string().trim().optional(),
  note: z.string().trim().optional(),
  status: z.enum(['pending', 'posted', 'reversed', 'rejected']).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.domain === 'finance') {
    if (!value.orderId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orderId'], message: '财务调整必须提供 orderId' });
    }
    if (value.amountDelta === undefined || value.amountDelta === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amountDelta'], message: '财务调整必须提供非零 amountDelta' });
    }
  }

  if (value.domain === 'production' || value.domain === 'inventory') {
    if (!value.batchId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['batchId'], message: '生产或库存调整必须提供 batchId' });
    }
    if (value.quantityDelta === undefined || value.quantityDelta === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantityDelta'], message: '生产或库存调整必须提供非零 quantityDelta' });
    }
  }
});

const productionBomItemSchema = z.object({
  materialName: z.string().trim().optional().nullable(),
  materialCode: z.string().trim().optional().nullable(),
  ingredientRole: z.string().trim().optional().nullable(),
  dosageMode: z.string().trim().optional().nullable(),
  percentage: z.coerce.number().nonnegative().max(100).optional().nullable(),
  quantityPerUnit: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  lossRate: z.coerce.number().nonnegative().optional().nullable(),
  allowedVarianceRate: z.coerce.number().nonnegative().max(100).optional().nullable(),
  processStage: z.string().trim().optional().nullable(),
  substituteGroup: z.string().trim().optional().nullable(),
  yieldContribution: z.coerce.number().nonnegative().max(100).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
}).strict().superRefine((value, ctx) => {
  if (!value.materialName && !value.materialCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['materialCode'],
      message: '物料名称或保密代号/编码至少填写一个',
    });
  }

  if (value.dosageMode === 'percentage') {
    if (value.percentage === undefined || value.percentage === null || value.percentage <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percentage'],
        message: '按百分比的配方行必须提供大于 0 的百分比',
      });
    }
  }
});

const productionStepInputSchema = z.object({
  stepNo: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(1),
  operatorName: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
}).strict();

export const createProductionBomSchema = z.object({
  productName: z.string().trim().min(1),
  version: z.string().trim().optional().nullable(),
  bomType: z.string().trim().optional().nullable(),
  status: z.string().trim().optional().nullable(),
  formulationMode: z.string().trim().optional().nullable(),
  outputUnit: z.string().trim().min(1),
  standardBatchSize: z.coerce.number().positive().optional().nullable(),
  batchSizeUnit: z.string().trim().optional().nullable(),
  density: z.coerce.number().positive().optional().nullable(),
  solidContent: z.coerce.number().nonnegative().max(100).optional().nullable(),
  effectiveFrom: z.string().trim().optional().nullable(),
  effectiveTo: z.string().trim().optional().nullable(),
  processJson: z.string().trim().optional().nullable(),
  qualitySpecJson: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  items: z.array(productionBomItemSchema).optional(),
}).strict().superRefine((value, ctx) => {
  if (!Array.isArray(value.items) || value.items.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'BOM 至少需要 1 条物料明细',
    });
  }

  if (value.processJson) {
    try {
      JSON.parse(value.processJson);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['processJson'],
        message: '工艺摘要必须是有效 JSON',
      });
    }
  }

  if (value.qualitySpecJson) {
    try {
      JSON.parse(value.qualitySpecJson);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['qualitySpecJson'],
        message: '质检规范必须是有效 JSON',
      });
    }
  }

  if (value.bomType === 'chemical_formula' && !value.formulationMode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['formulationMode'],
      message: '化工配方必须指定配方模式',
    });
  }

  if (value.standardBatchSize !== undefined && value.standardBatchSize !== null && !value.batchSizeUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['batchSizeUnit'],
      message: '填写标准批量时必须同时提供批量单位',
    });
  }

  const allowedStatuses = ['draft', 'approved', 'active', 'retired'];
  if (value.status && !allowedStatuses.includes(value.status)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: `配方状态必须是 ${allowedStatuses.join(' / ')} 之一`,
    });
  }

  let effectiveFrom: Date | null = null;
  let effectiveTo: Date | null = null;
  if (value.effectiveFrom) {
    effectiveFrom = new Date(value.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveFrom'],
        message: '生效开始日期格式不正确',
      });
      effectiveFrom = null;
    }
  }

  if (value.effectiveTo) {
    effectiveTo = new Date(value.effectiveTo);
    if (Number.isNaN(effectiveTo.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: '生效结束日期格式不正确',
      });
      effectiveTo = null;
    }
  }

  if (effectiveFrom && effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effectiveTo'],
      message: '生效结束日期不能早于生效开始日期',
    });
  }

  if (value.formulationMode === 'percentage') {
    if (value.standardBatchSize === undefined || value.standardBatchSize === null || value.standardBatchSize <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['standardBatchSize'],
        message: '百分比配方必须提供标准批量',
      });
    }

    const percentageItems = (value.items || []).filter(item => item.dosageMode === 'percentage');
    if (percentageItems.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: '百分比配方至少需要 1 条按百分比计量的物料',
      });
    }

    const percentageTotal = percentageItems.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
    if (percentageItems.length > 0 && Math.abs(percentageTotal - 100) > 0.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: `百分比配方合计必须接近 100%，当前为 ${percentageTotal.toFixed(2)}%`,
      });
    }
  }
});

export const createProductionWorkOrderSchema = z.object({
  bomId: z.coerce.number().int().positive().optional().nullable(),
  batchId: z.coerce.number().int().positive().optional().nullable(),
  productName: z.string().trim().min(1),
  targetQuantity: z.coerce.number().positive(),
  producedQuantity: z.coerce.number().nonnegative().optional().nullable(),
  lossQuantity: z.coerce.number().nonnegative().optional().nullable(),
  plannedStartAt: z.string().trim().optional().nullable(),
  plannedEndAt: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
  steps: z.array(productionStepInputSchema).optional(),
}).strict();

export const updateProductionWorkOrderStatusSchema = z.object({
  status: productionWorkOrderStatusSchema,
  consumptionRecords: z.array(z.object({
    stockBalanceId: z.number().int().positive(),
    quantity: z.number().positive(),
  })).optional(),
}).strict();

export const updateProductionStepSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  operatorName: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
}).strict().refine(value => Object.keys(value).length > 0, { message: '至少提供一个可更新字段' });

export const createProductionQualityCheckSchema = z.object({
  result: productionQualityResultSchema,
  defectRate: z.coerce.number().nonnegative().optional().nullable(),
  note: z.string().trim().optional().nullable(),
  checkedBy: z.string().trim().optional().nullable(),
}).strict();
