import { useMemo } from 'react';
import type { ProductBatch } from '../../services/asset.service';
import type { ProductionBom, ProductionSummary, ProductionWorkOrder } from '../../services/production.service';
import type { BomItemDraft } from './productionBomLineModel';
import {
  buildBatchTrace,
  buildBomDraftPreviewSummary,
  buildProductionDeskItems,
  buildProductionStats,
  filterProductionBoms,
  formatBomDraftPreviewWarnings,
} from './ProductionWorkspaceDerived';
import { getJsonSummary } from './productionWorkspaceConfig';

export const useProductionWorkspaceDerivedState = ({
  summary,
  boms,
  workOrders,
  batches,
  loading,
  selectedBom,
  selectedWorkOrder,
  selectedBatch,
  bomKeyword,
  bomItems,
  bomStandardBatchSize,
}: {
  summary: ProductionSummary | null;
  boms: ProductionBom[];
  workOrders: ProductionWorkOrder[];
  batches: ProductBatch[];
  loading: boolean;
  selectedBom: ProductionBom | null;
  selectedWorkOrder: ProductionWorkOrder | null;
  selectedBatch: ProductBatch | null;
  bomKeyword: string;
  bomItems: BomItemDraft[];
  bomStandardBatchSize: string;
}) => {
  const displayedBoms = useMemo(() => filterProductionBoms(boms, bomKeyword), [boms, bomKeyword]);
  const stats = useMemo(() => buildProductionStats(summary, boms, workOrders, batches), [summary, boms, workOrders, batches]);
  const bomPercentageSummary = useMemo(
    () => bomItems.reduce((sum, item) => sum + Number(item.percentage || 0), 0),
    [bomItems],
  );
  const numericStandardBatchSize = useMemo(() => Number(bomStandardBatchSize || 0), [bomStandardBatchSize]);
  const selectedBomPercentageSummary = useMemo(
    () => (selectedBom?.items || []).reduce((sum, item) => sum + Number(item.percentage || 0), 0),
    [selectedBom],
  );
  const selectedBomProcessSummary = useMemo(() => getJsonSummary(selectedBom?.processJson), [selectedBom]);
  const selectedBomQualitySummary = useMemo(() => getJsonSummary(selectedBom?.qualitySpecJson), [selectedBom]);
  const bomDraftPreviewSummary = useMemo(
    () => buildBomDraftPreviewSummary(bomItems, numericStandardBatchSize),
    [bomItems, numericStandardBatchSize],
  );
  const bomDraftWarning = useMemo(
    () => formatBomDraftPreviewWarnings(bomDraftPreviewSummary.rejectedRows),
    [bomDraftPreviewSummary],
  );
  const batchTrace = useMemo(() => buildBatchTrace(selectedBatch, workOrders), [selectedBatch, workOrders]);
  const productionDeskItems = useMemo(
    () => buildProductionDeskItems(boms.length, workOrders.length, batches.length),
    [batches.length, boms.length, workOrders.length],
  );

  return {
    displayedBoms,
    stats,
    isInitialLoading: loading && !summary,
    bomPercentageSummary,
    numericStandardBatchSize,
    selectedBomPercentageSummary,
    selectedBomProcessSummary,
    selectedBomQualitySummary,
    bomDraftWarning,
    batchTrace,
    selectedChecks: selectedWorkOrder?.qualityChecks || [],
    productionDeskItems,
  };
};
