import type { ProductBatch } from '../../services/asset.service';
import type {
  ProductionBom,
  ProductionBomItem,
  ProductionSummary,
  ProductionWorkOrder,
} from '../../services/production.service';
import type { ProductionWorkspaceStats } from './ProductionWorkspaceHeader';
import {
  getEffectiveBomQuantityPerUnit,
  isEffectiveBomItemDraft,
  type BomItemDraft,
} from './productionBomLineModel';
import { PRODUCTION_DESK_TABS, type StepDraft } from './productionWorkspaceConfig';

export type BatchTraceNode = {
  label: string;
  time: Date;
  place: string;
  status: string;
};

export type BomRejectedRow = {
  index: number;
  materialCode: string;
  reason: string;
};

export type ExpectedBomDraftSummary = {
  expectedEffectiveItemCount: number;
  expectedMaterialCodes: string[];
  expectedRoles: string[];
  expectedDosageModes: string[];
  expectedPercentages: string[];
  expectedQuantityPerUnit: string[];
  expectedProcessStages: string[];
};

export type BomReadbackComparison = {
  ok: boolean;
  reason?: string;
};

export type BomDraftPreviewSummary = {
  totalDraftRowCount: number;
  effectiveItemCount: number;
  rejectedRowCount: number;
  expectedSavedItemCount: number;
  percentageTotal: number;
  standardBatchSize: number;
  rejectedRows: BomRejectedRow[];
};

const formatComparableNumber = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  return Number(parsed.toFixed(6)).toString();
};

const normalizeComparableText = (value: unknown) => String(value ?? '').trim();

export const filterProductionBoms = (boms: ProductionBom[], keyword: string): ProductionBom[] => {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return boms;

  return boms.filter((item) =>
    item.productName.toLowerCase().includes(normalizedKeyword)
    || item.bomNo.toLowerCase().includes(normalizedKeyword)
    || (item.version || '').toLowerCase().includes(normalizedKeyword),
  );
};

export const buildProductionStats = (
  summary: ProductionSummary | null,
  boms: ProductionBom[],
  workOrders: ProductionWorkOrder[],
  batches: ProductBatch[],
): ProductionWorkspaceStats => ({
  totalBoms: summary?.bomCount ?? boms.length,
  totalWorkOrders: summary?.workOrderCount ?? workOrders.length,
  activeWorkOrders: summary?.activeWorkOrders ?? workOrders.filter((item) => ['planned', 'in_progress', 'qc_pending'].includes(item.status)).length,
  qcPendingCount: summary?.qcPendingCount ?? workOrders.filter((item) => item.status === 'qc_pending').length,
  batchCount: summary?.batchCount ?? batches.length,
  totalStock: batches.reduce((sum, batch) => sum + Number(batch.stockQuantity || 0), 0),
});

export const buildBatchTrace = (
  selectedBatch: ProductBatch | null,
  workOrders: ProductionWorkOrder[],
): BatchTraceNode[] => {
  if (!selectedBatch) return [];

  const events: BatchTraceNode[] = [];
  const linkedWorkOrder = workOrders.find((workOrder) => workOrder.batchId === selectedBatch.id);

  if (linkedWorkOrder) {
    events.push({
      label: '工单创建',
      time: new Date(linkedWorkOrder.createdAt),
      place: `工单 ${linkedWorkOrder.workOrderNo}`,
      status: '已创建',
    });

    if (linkedWorkOrder.actualStartAt) {
      events.push({
        label: '开始生产',
        time: new Date(linkedWorkOrder.actualStartAt),
        place: '生产线',
        status: '已开始',
      });
    }

    for (const qualityCheck of linkedWorkOrder.qualityChecks || []) {
      const resultLabel = qualityCheck.result === 'pass' ? '通过' : qualityCheck.result === 'fail' ? '不合格' : '待检';
      events.push({
        label: `质检 ${resultLabel}`,
        time: new Date(qualityCheck.checkedAt || qualityCheck.createdAt),
        place: `质检 ${qualityCheck.checkNo}`,
        status: qualityCheck.result === 'pass' ? '已通过' : resultLabel,
      });
    }

    if (linkedWorkOrder.actualEndAt) {
      events.push({
        label: '生产完成',
        time: new Date(linkedWorkOrder.actualEndAt),
        place: '完工入库',
        status: '已完成',
      });
    }
  } else {
    events.push({
      label: '生产完成',
      time: new Date(selectedBatch.productionDate),
      place: '生产线',
      status: '已记录',
    });
  }

  events.push({
    label: '效期管控',
    time: new Date(selectedBatch.expiryDate),
    place: '合规',
    status: selectedBatch.status === 'expired' ? '已过期' : '待到期',
  });

  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
};

export const buildProductionDeskItems = (
  bomCount: number,
  workOrderCount: number,
  batchCount: number,
) => PRODUCTION_DESK_TABS.map((tab) => ({
  ...tab,
  count: tab.id === 'bom' ? bomCount : tab.id === 'workOrders' ? workOrderCount : batchCount,
}));

const buildBomDraftRejectionReason = (item: BomItemDraft) => {
  if (!item.materialName.trim() && !item.materialCode.trim()) {
    return '缺少物料名或保密代号';
  }

  const dosageMode = item.dosageMode || 'fixed';
  const percentageValue = Number(item.percentage || 0);
  const quantityPerUnit = getEffectiveBomQuantityPerUnit(item);
  if (dosageMode === 'percentage') {
    if (!(percentageValue > 0)) return '百分比模式下百分比必须大于 0';
    if (!(quantityPerUnit > 0)) return '百分比模式下单位单耗必须大于 0';
    return '百分比模式行无有效单耗';
  }

  if (!(quantityPerUnit > 0)) {
    return '单位单耗必须大于 0';
  }

  return '无效明细行';
};

export const buildEffectiveBomItemsPayload = (bomItems: BomItemDraft[]) => {
  const rejectedRows: BomRejectedRow[] = [];
  const items: ProductionBomItem[] = [];

  bomItems.forEach((item, index) => {
    const materialName = item.materialName.trim();
    const materialCode = item.materialCode.trim();
    const quantityPerUnit = getEffectiveBomQuantityPerUnit(item);
    const hasIdentity = Boolean(materialName || materialCode);
    if (!hasIdentity || quantityPerUnit <= 0 || !isEffectiveBomItemDraft(item)) {
      rejectedRows.push({
        index: index + 1,
        materialCode: materialCode || materialName,
        reason: buildBomDraftRejectionReason(item),
      });
      return;
    }

    items.push({
      materialName: materialName || materialCode,
      materialCode: materialCode || null,
      ingredientRole: item.ingredientRole || null,
      dosageMode: item.dosageMode || null,
      percentage: item.percentage.trim() ? Number(item.percentage || 0) : null,
      quantityPerUnit,
      unit: item.unit.trim() || 'kg',
      lossRate: Number(item.lossRate || 0),
      allowedVarianceRate: item.allowedVarianceRate.trim() ? Number(item.allowedVarianceRate || 0) : null,
      processStage: item.processStage.trim() || null,
      substituteGroup: item.substituteGroup.trim() || null,
      yieldContribution: item.yieldContribution.trim() ? Number(item.yieldContribution || 0) : null,
      notes: item.notes.trim() || null,
    });
  });

  return { items, rejectedRows };
};

export const buildBomDraftPreviewSummary = (
  bomItems: BomItemDraft[],
  standardBatchSize: number,
): BomDraftPreviewSummary => {
  const { items, rejectedRows } = buildEffectiveBomItemsPayload(bomItems);
  const percentageTotal = items.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
  return {
    totalDraftRowCount: bomItems.length,
    effectiveItemCount: items.length,
    rejectedRowCount: rejectedRows.length,
    expectedSavedItemCount: items.length,
    percentageTotal,
    standardBatchSize,
    rejectedRows,
  };
};

export const formatBomDraftPreviewWarnings = (rejectedRows: BomRejectedRow[]) =>
  rejectedRows.length
    ? rejectedRows.map((row) => `第 ${row.index} 行不会保存：${row.reason}`).join('\n')
    : '';

export const buildExpectedBomDraftSummary = (items: ProductionBomItem[]): ExpectedBomDraftSummary => ({
  expectedEffectiveItemCount: items.length,
  expectedMaterialCodes: items.map((item) => normalizeComparableText(item.materialCode || item.materialName)),
  expectedRoles: items.map((item) => normalizeComparableText(item.ingredientRole)),
  expectedDosageModes: items.map((item) => normalizeComparableText(item.dosageMode)),
  expectedPercentages: items.map((item) => formatComparableNumber(item.percentage)),
  expectedQuantityPerUnit: items.map((item) => formatComparableNumber(item.quantityPerUnit)),
  expectedProcessStages: items.map((item) => normalizeComparableText(item.processStage)),
});

export const compareBomReadbackAgainstSummary = (
  expected: ExpectedBomDraftSummary,
  actualBom: ProductionBom,
): BomReadbackComparison => {
  const actualItems = Array.isArray(actualBom.items) ? actualBom.items : [];
  if (actualItems.length !== expected.expectedEffectiveItemCount) {
    return {
      ok: false,
      reason: `保存后回读明细行数不一致：期望 ${expected.expectedEffectiveItemCount} 行，实际 ${actualItems.length} 行`,
    };
  }

  for (let index = 0; index < actualItems.length; index += 1) {
    const actualItem = actualItems[index];
    const expectedMaterialCode = expected.expectedMaterialCodes[index] || '';
    const actualMaterialCode = normalizeComparableText(actualItem.materialCode || actualItem.materialName);
    if (actualMaterialCode !== expectedMaterialCode) {
      return { ok: false, reason: `第 ${index + 1} 行 materialCode 不一致：期望 ${expectedMaterialCode || '空'}，实际 ${actualMaterialCode || '空'}` };
    }

    const expectedRole = expected.expectedRoles[index] || '';
    const actualRole = normalizeComparableText(actualItem.ingredientRole);
    if (actualRole !== expectedRole) {
      return { ok: false, reason: `第 ${index + 1} 行角色不一致：期望 ${expectedRole || '空'}，实际 ${actualRole || '空'}` };
    }

    const expectedDosageMode = expected.expectedDosageModes[index] || '';
    const actualDosageMode = normalizeComparableText(actualItem.dosageMode);
    if (actualDosageMode !== expectedDosageMode) {
      return { ok: false, reason: `第 ${index + 1} 行剂量模式不一致：期望 ${expectedDosageMode || '空'}，实际 ${actualDosageMode || '空'}` };
    }

    const expectedPercentage = expected.expectedPercentages[index] || '';
    const actualPercentage = formatComparableNumber(actualItem.percentage);
    if (actualPercentage !== expectedPercentage) {
      return { ok: false, reason: `第 ${index + 1} 行 percentage 不一致：期望 ${expectedPercentage || '空'}，实际 ${actualPercentage || '空'}` };
    }

    const expectedQuantityPerUnit = expected.expectedQuantityPerUnit[index] || '';
    const actualQuantityPerUnit = formatComparableNumber(actualItem.quantityPerUnit);
    if (actualQuantityPerUnit !== expectedQuantityPerUnit) {
      return { ok: false, reason: `第 ${index + 1} 行 quantityPerUnit 不一致：期望 ${expectedQuantityPerUnit || '空'}，实际 ${actualQuantityPerUnit || '空'}` };
    }

    const expectedProcessStage = expected.expectedProcessStages[index] || '';
    const actualProcessStage = normalizeComparableText(actualItem.processStage);
    if (actualProcessStage !== expectedProcessStage) {
      return { ok: false, reason: `第 ${index + 1} 行工艺阶段不一致：期望 ${expectedProcessStage || '空'}，实际 ${actualProcessStage || '空'}` };
    }
  }

  return { ok: true };
};

export const buildWorkOrderStepsPayload = (steps: StepDraft[]) =>
  steps
    .filter((step) => step.title.trim())
    .map((step, index) => ({
      stepNo: index + 1,
      title: step.title.trim(),
      operatorName: step.operatorName.trim() || null,
      note: step.note.trim() || null,
    }));
