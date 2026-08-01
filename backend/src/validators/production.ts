import { z } from 'zod';

const adjustmentDomainSchema = z.enum(['finance', 'production', 'inventory']);
const adjustmentTargetTypeSchema = z.enum(['order', 'productBatch', 'manual']);
const productionWorkOrderStatusSchema = z.enum(['draft', 'planned', 'in_progress', 'qc_pending', 'completed', 'cancelled']);
const productionQualityCharacteristicSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  valueType: z.enum(['numeric', 'text']).default('numeric'),
  unit: z.string().trim().max(30).optional().nullable(),
  lowerLimit: z.union([z.string().trim().min(1), z.number()]).optional().nullable(),
  upperLimit: z.union([z.string().trim().min(1), z.number()]).optional().nullable(),
  targetText: z.string().trim().max(200).optional().nullable(),
  testMethod: z.string().trim().max(200).optional().nullable(),
  required: z.boolean().default(true),
  sortOrder: z.coerce.number().int().nonnegative().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.valueType === 'numeric') {
    const lower = value.lowerLimit === null || value.lowerLimit === undefined ? null : Number(value.lowerLimit);
    const upper = value.upperLimit === null || value.upperLimit === undefined ? null : Number(value.upperLimit);
    if (lower !== null && !Number.isFinite(lower)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lowerLimit'], message: '下限必须是有效数字' });
    if (upper !== null && !Number.isFinite(upper)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['upperLimit'], message: '上限必须是有效数字' });
    if (lower !== null && upper !== null && lower > upper) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['upperLimit'], message: '上限不能小于下限' });
    if (lower === null && upper === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lowerLimit'], message: '数值型检验项至少填写一个上下限' });
  } else if (!value.targetText) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetText'], message: '文本型检验项必须填写合格目标' });
  }
});

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
  materialId: z.coerce.number().int().positive().optional().nullable(),
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
  if (!value.materialId && !value.materialName && !value.materialCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['materialCode'],
      message: '请选择统一物料，或至少填写物料名称/保密代号',
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
  materialId: z.coerce.number().int().positive().optional().nullable(),
  productName: z.string().trim().min(1),
  version: z.string().trim().optional().nullable(),
  bomType: z.string().trim().optional().nullable(),
  status: z.string().trim().optional().nullable(),
  formulationMode: z.string().trim().optional().nullable(),
  outputUnit: z.string().trim().min(1),
  shelfLifeDays: z.coerce.number().int().min(1).max(3650),
  standardBatchSize: z.coerce.number().positive().optional().nullable(),
  batchSizeUnit: z.string().trim().optional().nullable(),
  density: z.coerce.number().positive().optional().nullable(),
  solidContent: z.coerce.number().nonnegative().max(100).optional().nullable(),
  effectiveFrom: z.string().trim().optional().nullable(),
  effectiveTo: z.string().trim().optional().nullable(),
  processJson: z.string().trim().optional().nullable(),
  qualitySpecJson: z.string().trim().optional().nullable(),
  qualityCharacteristics: z.array(productionQualityCharacteristicSchema).max(100).optional(),
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

  if (value.bomType === 'chemical_formula' && value.status !== 'draft' && !value.qualityCharacteristics?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qualityCharacteristics'],
      message: '受控化工配方至少需要 1 个结构化质检项目',
    });
  }
  const qualityCodes = (value.qualityCharacteristics || []).map(item => item.code.trim().toUpperCase());
  if (new Set(qualityCodes).size !== qualityCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['qualityCharacteristics'], message: '质检项目编码不能重复' });
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
  sampleNo: z.string().trim().min(1).max(80),
  defectRate: z.coerce.number().nonnegative().optional().nullable(),
  note: z.string().trim().optional().nullable(),
  measurements: z.array(z.object({
    characteristicId: z.coerce.number().int().positive(),
    measuredNumeric: z.union([z.string().trim().min(1), z.number()]).optional().nullable(),
    measuredText: z.string().trim().max(500).optional().nullable(),
    instrumentNo: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
  }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  const ids = value.measurements.map(item => item.characteristicId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measurements'], message: '同一检验项目不能重复提交' });
  }
});

export const reviewProductionQualityCheckSchema = z.object({
  decision: z.enum(['release', 'reject']),
  reviewNote: z.string().trim().min(1).max(1000),
}).strict();
