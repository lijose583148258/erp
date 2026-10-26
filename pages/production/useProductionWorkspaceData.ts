import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppContextType } from '../../types';
import { assetService, type ProductBatch } from '../../services/asset.service';
import { adjustmentService, type AdjustmentRecord } from '../../services/adjustment.service';
import {
  productionService,
  type ProductionBom,
  type ProductionBatchSelection,
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
  const { currentUser } = useAppContext();
  const canReadBatches = can(currentUser, 'assets.read');
  const canReadAdjustments = can(currentUser, 'adjustments.read');
  const actorId = currentUser.id;
  const actorIdRef = useRef(actorId);
  actorIdRef.current = actorId;
  const loadSequence = useRef(0);
  const [loadedActorId, setLoadedActorId] = useState<string | null>(null);
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
  const [assetBatchId, setAssetBatchId] = useState<number | null>(null);
  const [workOrderBatchSelection, setWorkOrderBatchSelection] = useState<{
    actorId: string; workOrderId: number; batchId: number;
  } | null>(null);
  const currentWorkOrders = useMemo(() => loadedActorId === actorId ? workOrders : [], [actorId, loadedActorId, workOrders]);
  const currentBatches = useMemo(() => loadedActorId === actorId && canReadBatches ? batches : [], [actorId, batches, canReadBatches, loadedActorId]);

  const selectedBom = useMemo(() => boms.find((item) => item.id === selectedBomId) || null, [boms, selectedBomId]);
  const selectedWorkOrder = useMemo(
    () => currentWorkOrders.find((item) => item.id === selectedWorkOrderId) || null,
    [currentWorkOrders, selectedWorkOrderId],
  );
  const selectedBatchWorkOrder = useMemo(() => {
    if (!workOrderBatchSelection || workOrderBatchSelection.actorId !== actorId) return null;
    const { workOrderId, batchId } = workOrderBatchSelection;
    return currentWorkOrders.find(item => item.id === workOrderId && item.id === selectedWorkOrderId
      && item.batchId === batchId && item.productBatch?.id === batchId) || null;
  }, [actorId, selectedWorkOrderId, workOrderBatchSelection, currentWorkOrders]);
  const selectedBatch: ProductionBatchSelection | null = workOrderBatchSelection
    ? selectedBatchWorkOrder?.productBatch ?? null
    : currentBatches.find(item => item.id === assetBatchId) || null;

  const selectWorkOrderBatch = (workOrderId: number, batchId: number) => {
    const order = currentWorkOrders.find(item => item.id === workOrderId && item.batchId === batchId && item.productBatch?.id === batchId);
    if (!order) return false;
    setSelectedWorkOrderId(workOrderId);
    setAssetBatchId(null);
    setWorkOrderBatchSelection({ actorId, workOrderId, batchId });
    return true;
  };
  const setSelectedBatchId = (batchId: number) => {
    if (!canReadBatches) return;
    setWorkOrderBatchSelection(null);
    setAssetBatchId(batchId);
  };
  const selectWorkOrder = (workOrderId: number) => {
    setSelectedWorkOrderId(workOrderId);
    setWorkOrderBatchSelection(previous => previous?.workOrderId === workOrderId ? previous : null);
  };

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    const isCurrent = () => !signal?.aborted && actorIdRef.current === actorId && loadSequence.current === sequence;
    setLoading(true);
    try {
      const [summaryData, bomData, workOrderData, batchData, adjustmentData] = await Promise.all([
        productionService.getSummary({ signal }),
        productionService.getBoms({ signal }),
        productionService.getWorkOrders({ status: workOrderFilter === 'all' ? undefined : workOrderFilter, keyword: workOrderKeyword.trim() || undefined }, { signal }),
        canReadBatches ? assetService.getBatches({ status: batchStatus === 'all' ? undefined : batchStatus, keyword: batchKeyword.trim() || undefined }, { signal }) : [],
        canReadAdjustments ? adjustmentService.getAll({ page: 1, pageSize: 100, domain: 'production', status: adjustmentStatus === 'all' ? undefined : adjustmentStatus }, { signal }) : { data: [] },
      ]);

      if (!isCurrent()) return;
      setLoadedActorId(actorId);
      setSummary(summaryData);
      setBoms(bomData);
      setWorkOrders(workOrderData);
      setBatches(batchData);
      setAdjustments(adjustmentData.data || []);
      setSelectedBomId((previous) => (previous && bomData.some((item) => item.id === previous) ? previous : bomData[0]?.id ?? null));
      setSelectedWorkOrderId((previous) => (previous && workOrderData.some((item) => item.id === previous) ? previous : workOrderData[0]?.id ?? null));
      setAssetBatchId((previous) => (previous && batchData.some((item) => item.id === previous) ? previous : null));
      setWorkOrderBatchSelection(previous => previous?.actorId === actorId && workOrderData.some(item => item.id === previous.workOrderId
        && item.batchId === previous.batchId && item.productBatch?.id === previous.batchId) ? previous : null);
    } catch (error) {
      if (isCanceledApiError(error) || !isCurrent()) return;
      notify('error', error instanceof Error ? error.message : '加载生产工作台失败');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [actorId, adjustmentStatus, batchKeyword, batchStatus, canReadAdjustments, canReadBatches, notify, workOrderFilter, workOrderKeyword]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  return {
    summary,
    boms,
    workOrders: currentWorkOrders,
    batches: currentBatches,
    canReadBatches,
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
    setSelectedWorkOrderId: selectWorkOrder,
    selectedBatchId: selectedBatch?.id ?? null,
    setSelectedBatchId,
    selectWorkOrderBatch,
    selectedBatchWorkOrder,
    selectedBom,
    selectedWorkOrder,
    selectedBatch,
    loadData,
  };
};
