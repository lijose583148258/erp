import type { ProductBatch } from '../../services/asset.service';
import type { ProductionBom, ProductionSummary, ProductionWorkOrder } from '../../services/production.service';
import type { ProductionWorkspaceStats } from './ProductionWorkspaceHeader';
import type { BomItemDraft } from './ProductionBomLineGrid';
import { getEffectiveBomQuantityPerUnit, isEffectiveBomItemDraft } from './ProductionBomLineGrid';
import { PRODUCTION_DESK_TABS, type StepDraft } from './productionWorkspaceConfig';

export type BatchTraceNode = {
  label: string;
  time: Date;
  place: string;
  status: string;
};

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

export const buildEffectiveBomItemsPayload = (bomItems: BomItemDraft[]) =>
  bomItems
    .filter(isEffectiveBomItemDraft)
    .map((item) => ({
      materialName: item.materialName.trim() || item.materialCode.trim(),
      materialCode: item.materialCode.trim() || null,
      ingredientRole: item.ingredientRole || null,
      dosageMode: item.dosageMode || null,
      percentage: item.percentage.trim() ? Number(item.percentage || 0) : null,
      quantityPerUnit: getEffectiveBomQuantityPerUnit(item),
      unit: item.unit.trim() || 'kg',
      lossRate: Number(item.lossRate || 0),
      allowedVarianceRate: item.allowedVarianceRate.trim() ? Number(item.allowedVarianceRate || 0) : null,
      processStage: item.processStage.trim() || null,
      substituteGroup: item.substituteGroup.trim() || null,
      yieldContribution: item.yieldContribution.trim() ? Number(item.yieldContribution || 0) : null,
      notes: item.notes.trim() || null,
    }));

export const buildWorkOrderStepsPayload = (steps: StepDraft[]) =>
  steps
    .filter((step) => step.title.trim())
    .map((step, index) => ({
      stepNo: index + 1,
      title: step.title.trim(),
      operatorName: step.operatorName.trim() || null,
      note: step.note.trim() || null,
    }));
