export type BomFormErrors = Partial<Record<'productName' | 'outputUnit' | 'standardBatchSize' | 'percentage' | 'items', string>>;
export type WorkOrderFormErrors = Partial<Record<'productName' | 'targetQuantity', string>>;
export type QualityFormErrors = Partial<Record<'defectRate' | 'checkedBy', string>>;
export type AdjustmentFormErrors = Partial<Record<'batch' | 'quantity' | 'reason', string>>;

const SAVE_TIMEOUT_MS = 10000;
const SAVE_TIMEOUT_MESSAGE = '服务器响应超时，请检查后端服务';

export const withSaveTimeout = async <T,>(operation: () => Promise<T>): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(SAVE_TIMEOUT_MESSAGE)), SAVE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const validateBomForm = ({
  productName,
  outputUnit,
  formulationMode,
  standardBatchSizeInput,
  percentageSummary,
  effectiveItemCount,
  bomType,
}: {
  productName: string;
  outputUnit: string;
  formulationMode: string;
  standardBatchSizeInput: string;
  percentageSummary: number;
  effectiveItemCount: number;
  bomType: string;
}) => {
  const errors: BomFormErrors = {};
  if (!productName.trim()) errors.productName = '请填写产品名称';
  if (!outputUnit.trim()) errors.outputUnit = '请填写输出单位';

  const standardBatchSize = Number(standardBatchSizeInput || 0);
  if (formulationMode === 'percentage' && standardBatchSize <= 0) {
    errors.standardBatchSize = '百分比配方请填写大于 0 的标准批量';
  }
  if (formulationMode === 'percentage' && percentageSummary > 0 && Math.abs(percentageSummary - 100) > 0.01) {
    errors.percentage = `当前配方百分比合计为 ${percentageSummary.toFixed(2)}%，请校正为 100%`;
  }
  if (!effectiveItemCount) {
    errors.items = '请至少添加 1 个有效物料，且单耗必须大于 0；保密原料可以只填代号/编码';
  }
  if (bomType === 'chemical_formula' && effectiveItemCount < 10) {
    errors.items = '化工配方建议至少填写 10 种原料；保密原料可以只填代号/编码';
  }

  return { errors, standardBatchSize };
};

export const validateWorkOrderForm = ({
  productName,
  targetQuantityInput,
}: {
  productName: string;
  targetQuantityInput: string;
}) => {
  const errors: WorkOrderFormErrors = {};
  if (!productName.trim()) errors.productName = '请填写工单产品';
  const targetQuantity = Number(targetQuantityInput || 0);
  if (!targetQuantityInput.trim() || !Number.isFinite(targetQuantity) || targetQuantity <= 0) {
    errors.targetQuantity = '目标数量必须大于 0';
  }
  return { errors, targetQuantity };
};

export const validateQualityForm = ({
  result,
  defectRateInput,
  checkedBy,
}: {
  result: string;
  defectRateInput: string;
  checkedBy: string;
}) => {
  const errors: QualityFormErrors = {};
  const defectRateValue = defectRateInput.trim() ? Number(defectRateInput) : null;
  if (defectRateValue !== null && (!Number.isFinite(defectRateValue) || defectRateValue < 0 || defectRateValue > 100)) {
    errors.defectRate = '缺陷率必须在 0 到 100 之间';
  }
  if (result === 'fail' && !checkedBy.trim()) {
    errors.checkedBy = '不合格记录请填写质检人';
  }
  return { errors, defectRateValue };
};

export const validateAdjustmentForm = ({
  hasBatch,
  quantityInput,
  reason,
}: {
  hasBatch: boolean;
  quantityInput: string;
  reason: string;
}) => {
  const errors: AdjustmentFormErrors = {};
  if (!hasBatch) errors.batch = '请先选择批次';
  const quantity = Number(quantityInput);
  if (!Number.isFinite(quantity) || quantity <= 0) errors.quantity = '请填写大于 0 的有效数量';
  if (!reason.trim()) errors.reason = '请填写调整原因';
  return { errors, quantity };
};
