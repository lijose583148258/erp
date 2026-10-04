import { PACKAGING_PERCENTAGE_V1 } from '../domain/production-packaging-basis';
import { MASS_PERCENTAGE_V1 } from '../domain/production-mass-basis';
import { DENSITY_PERCENTAGE_V1 } from '../domain/production-density-basis';
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

export const createProductionDispositionSchema = z.object({
  type: z.enum(['scrap', 'rework_return']),
  quantity: z.coerce.number().positive(),
  reason: z.string().trim().min(1).max(500),
  note: z.string().trim().max(2000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(120),
  // The production UI sends null for a field irrelevant to the selected
  // disposition type. The type-specific checks below still require the
  // physical facts that actually apply.
  stockBalanceId: z.coerce.number().int().positive().optional().nullable(),
  sourceDispositionId: z.coerce.number().int().positive().optional().nullable(),
  destinationLocationId: z.coerce.number().int().positive().optional().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.type === 'scrap' && !value.stockBalanceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stockBalanceId'], message: '报废必须选择实际库存余额' });
  }
  if (value.type === 'rework_return' && !value.sourceDispositionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceDispositionId'], message: '返工回收必须关联已过账报废记录' });
  }
  if (value.type === 'rework_return' && !value.destinationLocationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destinationLocationId'], message: '返工回收必须选择实际入库库位' });
  }
});

const productionBomItemSchema = z.object({
  materialId: z.coerce.number().int().positive().optional().nullable(),
  materialName: z.string().trim().optional().nullable(),
  materialCode: z.string().trim().optional().nullable(),
  ingredientRole: z.string().trim().optional().nullable(),
  dosageMode: z.enum(['fixed', 'percentage', MASS_PERCENTAGE_V1, PACKAGING_PERCENTAGE_V1, DENSITY_PERCENTAGE_V1]).optional().nullable(),
  densityRevisionId: z.coerce.number().int().positive().optional().nullable(),
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

  if (value.dosageMode === 'percentage' || value.dosageMode === MASS_PERCENTAGE_V1 || value.dosageMode === PACKAGING_PERCENTAGE_V1 || value.dosageMode === DENSITY_PERCENTAGE_V1) {
    if (value.percentage === undefined || value.percentage === null || value.percentage <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percentage'],
        message: '按百分比的配方行必须提供大于 0 的百分比',
      });
    }
  }
  if (value.dosageMode === DENSITY_PERCENTAGE_V1 && !value.densityRevisionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['densityRevisionId'], message: '密度换算行必须选择已批准的真实批次密度依据' });
  }
  if (value.dosageMode !== DENSITY_PERCENTAGE_V1 && value.densityRevisionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['densityRevisionId'], message: '仅密度换算 v1 行可以引用密度依据' });
  }
});

const densityConsumptionSchema = z.object({
  densityRevisionId: z.coerce.number().int().positive(),
  temperatureC: z.string().trim().min(1).max(24),
  pressureKpaAbs: z.string().trim().min(1).max(24),
  compositionReference: z.string().trim().min(1).max(240),
}).strict();

const productionStepInputSchema = z.object({
  stepNo: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(1),
  operatorName: z.string().trim().optional().nullable(),
  note: z.string().trim().optional().nullable(),
}).strict();

export const createProductionBomSchema = z.object({
  packagingRevisionId: z.coerce.number().int().positive().optional().nullable(),
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

    const percentageItems = (value.items || []).filter(item => item.dosageMode === 'percentage' || item.dosageMode === MASS_PERCENTAGE_V1 || item.dosageMode === PACKAGING_PERCENTAGE_V1 || item.dosageMode === DENSITY_PERCENTAGE_V1);
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
    densityUse: densityConsumptionSchema.optional(),
  }).strict()).optional(),
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
