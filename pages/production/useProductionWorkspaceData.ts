import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppContextType } from '../../types';
import { assetService, type ProductBatch } from '../../services/asset.service';
import { adjustmentService, type AdjustmentRecord } from '../../services/adjustment.service';
import {
  productionService,
  type ProductionBom,
  type ProductionSummary,
  type ProductionWorkOrder,
} from '../../services/production.service';
import { isCanceledApiError } from '../../utils/api';
import type {
  AdjustmentStatusFilter,
  BatchStatusFilter,
  WorkOrderFilter,
} from './productionWorkspaceConfig';

export const useProductionWorkspaceData = (notify: AppContextType['notify']) => {
  const [summary, setSummary] = useState<ProductionSummary | null>(null);
  const [boms, setBoms] = useState<ProductionBom[]>([]);
  const [workOrders, setWorkOrders] = useState<ProductionWorkOrder[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [bomKeyword, setBomKeyword] = useState('');
  const [workOrderKeyword, setWorkOrderKeyword] = useState('');
  const [workOrderFilter, setWorkOrderFilter] = useState<WorkOrderFilter>('all');
  const [batchKeyword, setBatchKeyword] = useState('');
  const [batchStatus, setBatchStatus] = useState<BatchStatusFilter>('all');
  const [adjustmentStatus, setAdjustmentStatus] = useState<AdjustmentStatusFilter>('all');

  const [selectedBomId, setSelectedBomId] = useState<number | null>(null);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<number | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  const selectedBom = useMemo(() => boms.find((item) => item.id === selectedBomId) || null, [boms, selectedBomId]);
  const selectedWorkOrder = useMemo(
    () => workOrders.find((item) => item.id === selectedWorkOrderId) || null,
    [workOrders, selectedWorkOrderId],
  );
  const selectedBatch = useMemo(() => batches.find((item) => item.id === selectedBatchId) || null, [batches, selectedBatchId]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [summaryData, bomData, workOrderData, batchData, adjustmentData] = await Promise.all([
        productionService.getSummary({ signal }),
        productionService.getBoms({ signal }),
        productionService.getWorkOrders({ status: workOrderFilter === 'all' ? undefined : workOrderFilter, keyword: workOrderKeyword.trim() || undefined }, { signal }),
        assetService.getBatches({ status: batchStatus === 'all' ? undefined : batchStatus, keyword: batchKeyword.trim() || undefined }, { signal }),
        adjustmentService.getAll({ page: 1, pageSize: 100, domain: 'production', status: adjustmentStatus === 'all' ? undefined : adjustmentStatus }, { signal }),
      ]);

      if (signal?.aborted) return;
      setSummary(summaryData);
      setBoms(bomData);
      setWorkOrders(workOrderData);
      setBatches(batchData);
      setAdjustments(adjustmentData.data || []);
      setSelectedBomId((previous) => (previous && bomData.some((item) => item.id === previous) ? previous : bomData[0]?.id ?? null));
      setSelectedWorkOrderId((previous) => (previous && workOrderData.some((item) => item.id === previous) ? previous : workOrderData[0]?.id ?? null));
      setSelectedBatchId((previous) => (previous && batchData.some((item) => item.id === previous) ? previous : null));
    } catch (error) {
      if (isCanceledApiError(error)) return;
      notify('error', error instanceof Error ? error.message : '加载生产工作台失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [adjustmentStatus, batchKeyword, batchStatus, notify, workOrderFilter, workOrderKeyword]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  return {
    summary,
    boms,
    workOrders,
    batches,
    adjustments,
    loading,
    bomKeyword,
    setBomKeyword,
    workOrderKeyword,
    setWorkOrderKeyword,
    workOrderFilter,
    setWorkOrderFilter,
    batchKeyword,
    setBatchKeyword,
    batchStatus,
    setBatchStatus,
    adjustmentStatus,
    setAdjustmentStatus,
    selectedBomId,
    setSelectedBomId,
    selectedWorkOrderId,
    setSelectedWorkOrderId,
    selectedBatchId,
    setSelectedBatchId,
    selectedBom,
    selectedWorkOrder,
    selectedBatch,
    loadData,
  };
};
