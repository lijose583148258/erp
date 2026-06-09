import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../app/AppContext';
import { getModuleDescription, getModuleTitle } from '../components/navigation/moduleRegistry';
import { WorkspaceTaskNavigator, type WorkspaceTaskNavigatorItem } from '../components/ui/WorkspaceTaskNavigator';
import { assetService, ProductBatch } from '../services/asset.service';
import { adjustmentService, AdjustmentRecord } from '../services/adjustment.service';
import { productionService, ProductionBom, ProductionSummary, ProductionWorkOrder, ProductionWorkOrderStatus, ProductionStep } from '../services/production.service';
import { isCanceledApiError } from '../utils/api';
import { ProductionBomSection } from './production/ProductionBomSection';
import { ProductionWorkOrderSection } from './production/ProductionWorkOrderSection';
import { ProductionBatchAdjustmentSection } from './production/ProductionBatchAdjustmentSection';
import { ProductionAdjustmentReverseDialog } from './production/ProductionAdjustmentReverseDialog';
import { CompleteWorkOrderModal } from './production/CompleteWorkOrderModal';
import { getEffectiveBomQuantityPerUnit, isEffectiveBomItemDraft } from './production/ProductionBomLineGrid';
import {
  getJsonSummary,
  newStep,
  type AdjustmentStatusFilter,
  type BatchStatusFilter,
  type WorkOrderFilter,
} from './production/productionWorkspaceConfig';
import {
  ProductionWorkspaceHeader,
} from './production/ProductionWorkspaceHeader';
import {
  useProductionAdjustmentForm,
  useProductionBomForm,
  useProductionQualityForm,
  useProductionWorkOrderForm,
} from './production/useProductionWorkspaceForms';
import { useUnsavedForm } from '../app/useUnsavedForm';

type ProductionDeskTab = 'bom' | 'workOrders' | 'batches';

const PRODUCTION_DESK_TABS: WorkspaceTaskNavigatorItem<ProductionDeskTab>[] = [
  {
    id: 'bom',
    title: '配方主档',
    subtitle: '维护产品配方版本和原料明细',
    purpose: '先定义“做什么、按什么版本做、需要哪些原料”；实际耗用必须到工单完工时确认。',
    testId: 'production-desk-bom',
  },
  {
    id: 'workOrders',
    title: '工单 / 质检',
    subtitle: '排产、工序流转、质检和完工扣料',
    purpose: '把已确认的配方变成可执行工单，并在完工时回写库存。',
    testId: 'production-desk-work-orders',
  },
  {
    id: 'batches',
    title: '批次追踪 / 异常调整',
    subtitle: '批次追踪、现场异常登记和冲销回放',
    purpose: '只处理已经形成库存事实的批次异常；配方维护、工单完工和正常入库必须回到前两个工作区或仓储主入口。',
    testId: 'production-desk-batches',
  },
];

const ProductionWorkspaceV2 = () => {
  const { notify, language } = useAppContext();
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
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingWorkOrderId, setCompletingWorkOrderId] = useState<number | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [activeDeskTab, setActiveDeskTab] = useState<ProductionDeskTab>('bom');
  const [reverseAdjustment, setReverseAdjustment] = useState<AdjustmentRecord | null>(null);
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [bomSaveVersion, setBomSaveVersion] = useState(0);

  const createInitialWorkOrderSteps = useCallback(
    () => [newStep('备料'), newStep('生产'), newStep('质检')],
    [],
  );
  const bomForm = useProductionBomForm();
  const workOrderForm = useProductionWorkOrderForm(createInitialWorkOrderSteps);
  const qualityForm = useProductionQualityForm();
  const adjustmentForm = useProductionAdjustmentForm();
  const { bomProductName, setBomProductName, bomVersion, setBomVersion, bomType, setBomType, bomStatus, setBomStatus, bomFormulationMode, setBomFormulationMode, bomOutputUnit, setBomOutputUnit, bomStandardBatchSize, setBomStandardBatchSize, bomBatchSizeUnit, setBomBatchSizeUnit, bomDensity, setBomDensity, bomSolidContent, setBomSolidContent, bomEffectiveFrom, setBomEffectiveFrom, bomEffectiveTo, setBomEffectiveTo, bomProcessText, setBomProcessText, bomQualitySpecText, setBomQualitySpecText, bomNotes, setBomNotes, bomItems, setBomItems, resetBomForm } = bomForm;
  const { woProductName, setWoProductName, woTargetQuantity, setWoTargetQuantity, woProducedQuantity, setWoProducedQuantity, woLossQuantity, setWoLossQuantity, woPlannedStartAt, setWoPlannedStartAt, woPlannedEndAt, setWoPlannedEndAt, woNote, setWoNote, woSteps, setWoSteps, resetWoForm } = workOrderForm;
  const { qcResult, setQcResult, qcDefectRate, setQcDefectRate, qcNote, setQcNote, qcCheckedBy, setQcCheckedBy, resetQualityForm } = qualityForm;
  const { selectedTemplate, templateId, setTemplateId, adjustmentQuantity, setAdjustmentQuantity, adjustmentReason, setAdjustmentReason, adjustmentNote, setAdjustmentNote } = adjustmentForm;
  useUnsavedForm({
    sourceId: 'production-bom-form',
    label: '生产 BOM 配方',
    open: !loading,
    resetKey: bomSaveVersion,
    value: {
      bomProductName,
      bomVersion,
      bomType,
      bomStatus,
      bomFormulationMode,
      bomOutputUnit,
      bomStandardBatchSize,
      bomBatchSizeUnit,
      bomDensity,
      bomSolidContent,
      bomEffectiveFrom,
      bomEffectiveTo,
      bomProcessText,
      bomQualitySpecText,
      bomNotes,
      bomItems,
    },
  });
  const selectedBom = useMemo(() => boms.find(item => item.id === selectedBomId) || null, [boms, selectedBomId]);
  const selectedWorkOrder = useMemo(() => workOrders.find(item => item.id === selectedWorkOrderId) || null, [workOrders, selectedWorkOrderId]);
  const completingWorkOrder = useMemo(
    () => workOrders.find(item => item.id === completingWorkOrderId) || null,
    [workOrders, completingWorkOrderId],
  );
  const selectedBatch = useMemo(() => batches.find(item => item.id === selectedBatchId) || null, [batches, selectedBatchId]);

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
      setSelectedBomId(prev => (prev && bomData.some(item => item.id === prev) ? prev : bomData[0]?.id ?? null));
      setSelectedWorkOrderId(prev => (prev && workOrderData.some(item => item.id === prev) ? prev : workOrderData[0]?.id ?? null));
      setSelectedBatchId(prev => (prev && batchData.some(item => item.id === prev) ? prev : null));
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
  useEffect(() => { if (selectedBom && !woProductName.trim()) setWoProductName(selectedBom.productName); }, [selectedBom, setWoProductName, woProductName]);
  useEffect(() => { if (selectedBatch && !woProductName.trim()) setWoProductName(selectedBatch.productName); }, [selectedBatch, setWoProductName, woProductName]);

  const displayedBoms = useMemo(() => {
    const keyword = bomKeyword.trim().toLowerCase();
    return keyword ? boms.filter(item => item.productName.toLowerCase().includes(keyword) || item.bomNo.toLowerCase().includes(keyword) || (item.version || '').toLowerCase().includes(keyword)) : boms;
  }, [boms, bomKeyword]);

  const stats = useMemo(() => ({
    totalBoms: summary?.bomCount ?? boms.length,
    totalWorkOrders: summary?.workOrderCount ?? workOrders.length,
    activeWorkOrders: summary?.activeWorkOrders ?? workOrders.filter(item => ['planned', 'in_progress', 'qc_pending'].includes(item.status)).length,
    qcPendingCount: summary?.qcPendingCount ?? workOrders.filter(item => item.status === 'qc_pending').length,
    batchCount: summary?.batchCount ?? batches.length,
    totalStock: batches.reduce((sum, batch) => sum + Number(batch.stockQuantity || 0), 0),
  }), [summary, boms.length, batches, workOrders]);
  const isInitialLoading = loading && !summary;
  const bomPercentageSummary = useMemo(
    () => bomItems.reduce((sum, item) => sum + Number(item.percentage || 0), 0),
    [bomItems],
  );
  const numericStandardBatchSize = useMemo(
    () => Number(bomStandardBatchSize || 0),
    [bomStandardBatchSize],
  );
  const selectedBomPercentageSummary = useMemo(
    () => (selectedBom?.items || []).reduce((sum, item) => sum + Number(item.percentage || 0), 0),
    [selectedBom],
  );
  const selectedBomProcessSummary = useMemo(
    () => getJsonSummary(selectedBom?.processJson),
    [selectedBom],
  );
  const selectedBomQualitySummary = useMemo(
    () => getJsonSummary(selectedBom?.qualitySpecJson),
    [selectedBom],
  );

  const batchTrace = useMemo(() => {
    if (!selectedBatch) return [];
    const productionDate = new Date(selectedBatch.productionDate);
    const expiryDate = new Date(selectedBatch.expiryDate);
    const events = [];
    const linkedWo = workOrders.find(wo => wo.batchId === selectedBatch.id);
    if (linkedWo) {
      events.push({ label: '工单创建', time: new Date(linkedWo.createdAt), place: `工单 ${linkedWo.workOrderNo}`, status: '已创建' });
      if (linkedWo.actualStartAt) events.push({ label: '开始生产', time: new Date(linkedWo.actualStartAt), place: '生产线', status: '已开始' });
      for (const qc of (linkedWo.qualityChecks || [])) {
        events.push({ label: `质检 ${qc.result === 'pass' ? '通过' : qc.result === 'fail' ? '不合格' : '待检'}`, time: new Date(qc.checkedAt || qc.createdAt), place: `质检 ${qc.checkNo}`, status: qc.result === 'pass' ? '已通过' : qc.result === 'fail' ? '不合格' : '待检' });
      }
      if (linkedWo.actualEndAt) events.push({ label: '生产完成', time: new Date(linkedWo.actualEndAt), place: '完工入库', status: '已完成' });
    } else {
      events.push({ label: '生产完成', time: productionDate, place: '生产线', status: '已记录' });
    }
    events.push({ label: '效期管控', time: expiryDate, place: '合规', status: selectedBatch.status === 'expired' ? '已过期' : '待到期' });
    events.sort((a, b) => a.time.getTime() - b.time.getTime());
    return events;
  }, [selectedBatch, workOrders]);

  const handleCreateBom = async () => {
    if (!bomProductName.trim() || !bomOutputUnit.trim()) return notify('warning', '请填写 BOM 产品名称和输出单位');

    const standardBatchSize = Number(bomStandardBatchSize || 0);
    if (bomFormulationMode === 'percentage' && standardBatchSize <= 0) {
      return notify('warning', '百分比配方请填写标准批量，系统才能自动换算单耗');
    }
    if (bomFormulationMode === 'percentage' && bomPercentageSummary > 0 && Math.abs(bomPercentageSummary - 100) > 0.01) {
      return notify('warning', `当前配方百分比合计为 ${bomPercentageSummary.toFixed(2)}%，建议校正为 100%`);
    }

    const items = bomItems
      .filter(isEffectiveBomItemDraft)
      .map(item => {
        const safeMaterialName = item.materialName.trim() || item.materialCode.trim();
        const dosageMode = item.dosageMode || null;
        const percentageValue = item.percentage.trim() ? Number(item.percentage || 0) : null;
        const normalizedQuantityPerUnit = getEffectiveBomQuantityPerUnit(item);
        return {
        materialName: safeMaterialName,
        materialCode: item.materialCode.trim() || null,
        ingredientRole: item.ingredientRole || null,
        dosageMode,
        percentage: percentageValue,
        quantityPerUnit: normalizedQuantityPerUnit,
        unit: item.unit.trim() || 'kg',
        lossRate: Number(item.lossRate || 0),
        allowedVarianceRate: item.allowedVarianceRate.trim() ? Number(item.allowedVarianceRate || 0) : null,
        processStage: item.processStage.trim() || null,
        substituteGroup: item.substituteGroup.trim() || null,
        yieldContribution: item.yieldContribution.trim() ? Number(item.yieldContribution || 0) : null,
        notes: item.notes.trim() || null,
      };
      });

    if (!items.length) return notify('warning', '请至少添加 1 个有效物料，且单耗必须大于 0；保密原料可以只填代号/编码');
    if (bomType === 'chemical_formula' && items.length < 10) {
      return notify('warning', '化工配方建议至少填写 10 种原料；保密原料可以只填代号/编码');
    }

    try {
      const createdBom = await productionService.createBom({
        productName: bomProductName.trim(),
        version: bomVersion.trim() || 'v1',
        bomType,
        status: bomStatus,
        formulationMode: bomFormulationMode,
        outputUnit: bomOutputUnit.trim(),
        standardBatchSize: standardBatchSize > 0 ? standardBatchSize : null,
        batchSizeUnit: bomBatchSizeUnit.trim() || null,
        density: bomDensity.trim() ? Number(bomDensity || 0) : null,
        solidContent: bomSolidContent.trim() ? Number(bomSolidContent || 0) : null,
        effectiveFrom: bomEffectiveFrom || null,
        effectiveTo: bomEffectiveTo || null,
        processJson: bomProcessText.trim() ? JSON.stringify({ summary: bomProcessText.trim() }) : null,
        qualitySpecJson: bomQualitySpecText.trim() ? JSON.stringify({ summary: bomQualitySpecText.trim() }) : null,
        notes: bomNotes.trim() || null,
        items,
      });
      notify('success', 'BOM 已创建');
      resetBomForm();
      setBomSaveVersion(version => version + 1);
      await loadData();
      setSelectedBomId(createdBom.id);
      setWoProductName(createdBom.productName);
      setBomOutputUnit(createdBom.outputUnit || 'kg');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建 BOM 失败');
    }
  };

  const handleCreateWorkOrder = async () => {
    if (!woProductName.trim() || !woTargetQuantity.trim()) return notify('warning', '请填写工单产品和目标数量');

    const steps = woSteps
      .filter(step => step.title.trim())
      .map((step, index) => ({
        stepNo: index + 1,
        title: step.title.trim(),
        operatorName: step.operatorName.trim() || null,
        note: step.note.trim() || null,
      }));
    const resolvedProductName = woProductName.trim();
    const resolvedBom = boms.find(item => item.productName === resolvedProductName) || selectedBom;
    const resolvedBatch = selectedBatch?.productName === resolvedProductName ? selectedBatch : null;

    try {
      await productionService.createWorkOrder({
        bomId: resolvedBom?.id ?? selectedBomId ?? undefined,
        batchId: resolvedBatch?.id ?? selectedBatchId ?? undefined,
        productName: resolvedProductName,
        targetQuantity: Number(woTargetQuantity || 0),
        producedQuantity: Number(woProducedQuantity || 0),
        lossQuantity: Number(woLossQuantity || 0),
        plannedStartAt: woPlannedStartAt || null,
        plannedEndAt: woPlannedEndAt || null,
        note: woNote.trim() || null,
        steps,
      });
      notify('success', '工单已创建');
      resetWoForm();
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建工单失败');
    }
  };

  const handleStepAction = async (step: ProductionStep, status: string) => {
    if (!selectedWorkOrder) return;
    try {
      await productionService.updateStep(selectedWorkOrder.id, step.id, { status, operatorName: step.operatorName || undefined });
      notify('success', '工序状态已更新');
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '更新工序失败');
    }
  };

  const handleWorkOrderStatus = async (
    workOrderIdOrStatus: number | ProductionWorkOrderStatus,
    maybeStatus?: ProductionWorkOrderStatus,
  ) => {
    const workOrderId = typeof workOrderIdOrStatus === 'number' ? workOrderIdOrStatus : selectedWorkOrder?.id;
    const status = typeof workOrderIdOrStatus === 'number'
      ? maybeStatus
      : maybeStatus ?? workOrderIdOrStatus;
    if (!workOrderId || !status) return;
      if (status === 'completed') {
        setCompletingWorkOrderId(workOrderId);
        setShowCompleteModal(true);
        return;
      }
      try {
      setSelectedWorkOrderId(workOrderId);
      await productionService.updateWorkOrderStatus(workOrderId, status);
      notify('success', '工单状态已更新');
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '更新工单状态失败');
    }
  };

  const handleCompleteWorkOrder = async (consumptionRecords: { stockBalanceId: number; quantity: number }[]) => {
    if (!completingWorkOrderId) return;
    try {
      setSelectedWorkOrderId(completingWorkOrderId);
      await productionService.updateWorkOrderStatus(completingWorkOrderId, 'completed', consumptionRecords);
      notify('success', '工单已完成并完成扣料');
      setShowCompleteModal(false);
      setCompletingWorkOrderId(null);
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '工单完工失败');
      throw error;
    }
  };

  const handleCreateQc = async () => {
    if (!selectedWorkOrder) return notify('warning', '请先选择工单');
    try {
      await productionService.createQualityCheck(selectedWorkOrder.id, {
        result: qcResult,
        defectRate: qcDefectRate.trim() ? Number(qcDefectRate) : null,
        note: qcNote.trim() || null,
        checkedBy: qcCheckedBy.trim() || null,
      });
      notify('success', '质检记录已保存');
      resetQualityForm();
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '保存质检记录失败');
    }
  };

  const handleCreateAdjustment = async () => {
    if (!selectedBatch) return notify('warning', '请先选择批次');
    const value = Number(adjustmentQuantity);
    if (!Number.isFinite(value) || value <= 0) return notify('warning', '请填写有效数量');
    if (!adjustmentReason.trim()) return notify('warning', '请填写调整原因');

    try {
      await adjustmentService.create({
        domain: 'production',
        targetType: 'productBatch',
        batchId: selectedBatch.id,
        targetId: selectedBatch.id,
        targetRef: selectedBatch.batchNo,
        quantityDelta: value * selectedTemplate.sign,
        reason: adjustmentReason.trim(),
        reasonCategory: selectedTemplate.reasonCategory,
        lossType: selectedTemplate.lossType,
        note: adjustmentNote.trim() || null,
        status: 'posted',
      });
        notify('success', '生产调账已登记');
      setAdjustmentQuantity('');
      setAdjustmentNote('');
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '登记生产调账失败');
    }
  };

  const handleReverseAdjustment = async (record: AdjustmentRecord) => {
    setReverseAdjustment(record);
  };

  const confirmReverseAdjustment = async (note: string) => {
    if (!reverseAdjustment) return;
    setReverseSubmitting(true);
    try {
      await adjustmentService.reverse(reverseAdjustment.id, note.trim() || '生产调账冲销');
      notify('success', '已完成冲销');
      setReverseAdjustment(null);
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '冲销失败');
    } finally {
      setReverseSubmitting(false);
    }
  };

  const selectedChecks = selectedWorkOrder?.qualityChecks || [];
  const productionDeskItems = useMemo(
    () => PRODUCTION_DESK_TABS.map(tab => ({
      ...tab,
      count: tab.id === 'bom' ? boms.length : tab.id === 'workOrders' ? workOrders.length : batches.length,
    })),
    [batches.length, boms.length, workOrders.length],
  );

  return (
    <div className="space-y-10 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <ProductionWorkspaceHeader
        title={getModuleTitle('production', language)}
        description={getModuleDescription('production', language)}
        stats={stats}
        isInitialLoading={isInitialLoading}
        onRefresh={() => void loadData()}
      />

      <WorkspaceTaskNavigator
        eyebrow="生产职责导航"
        title="先选工作区，再输入数据"
        description="按成熟 ERP 的“对象库 / 执行动作 / 台账回放”拆开：BOM 只管配方，工单只管执行，批次区只做追溯和异常登记，避免同一页面同时承担建档、排产、调账和入库。"
        items={productionDeskItems}
        activeId={activeDeskTab}
        onChange={(id) => {
          if (id === 'bom' || id === 'workOrders' || id === 'batches') {
            setActiveDeskTab(id);
          }
        }}
        variant="blue"
      />

      <div className="space-y-8">
        {activeDeskTab === 'bom' ? (
          <ProductionBomSection
            bomKeyword={bomKeyword}
            setBomKeyword={setBomKeyword}
            bomProductName={bomProductName}
            setBomProductName={setBomProductName}
            bomVersion={bomVersion}
            setBomVersion={setBomVersion}
            bomType={bomType}
            setBomType={setBomType}
            bomStatus={bomStatus}
            setBomStatus={setBomStatus}
            bomFormulationMode={bomFormulationMode}
            setBomFormulationMode={setBomFormulationMode}
            bomOutputUnit={bomOutputUnit}
            setBomOutputUnit={setBomOutputUnit}
            bomStandardBatchSize={bomStandardBatchSize}
            setBomStandardBatchSize={setBomStandardBatchSize}
            bomBatchSizeUnit={bomBatchSizeUnit}
            setBomBatchSizeUnit={setBomBatchSizeUnit}
            bomDensity={bomDensity}
            setBomDensity={setBomDensity}
            bomSolidContent={bomSolidContent}
            setBomSolidContent={setBomSolidContent}
            bomProcessText={bomProcessText}
            setBomProcessText={setBomProcessText}
            bomEffectiveFrom={bomEffectiveFrom}
            setBomEffectiveFrom={setBomEffectiveFrom}
            bomEffectiveTo={bomEffectiveTo}
            setBomEffectiveTo={setBomEffectiveTo}
            bomQualitySpecText={bomQualitySpecText}
            setBomQualitySpecText={setBomQualitySpecText}
            bomNotes={bomNotes}
            setBomNotes={setBomNotes}
            bomPercentageSummary={bomPercentageSummary}
            numericStandardBatchSize={numericStandardBatchSize}
            bomItems={bomItems}
            setBomItems={setBomItems}
            loading={loading}
            handleCreateBom={handleCreateBom}
            displayedBoms={displayedBoms}
            selectedBomId={selectedBomId}
            setSelectedBomId={setSelectedBomId}
            setWoProductName={setWoProductName}
            selectedBom={selectedBom}
            selectedBomPercentageSummary={selectedBomPercentageSummary}
            selectedBomProcessSummary={selectedBomProcessSummary}
            selectedBomQualitySummary={selectedBomQualitySummary}
          />
        ) : null}

        {activeDeskTab === 'workOrders' ? (
          <ProductionWorkOrderSection
            woProductName={woProductName}
            setWoProductName={setWoProductName}
            woTargetQuantity={woTargetQuantity}
            setWoTargetQuantity={setWoTargetQuantity}
            woProducedQuantity={woProducedQuantity}
            setWoProducedQuantity={setWoProducedQuantity}
            woLossQuantity={woLossQuantity}
            setWoLossQuantity={setWoLossQuantity}
            woPlannedStartAt={woPlannedStartAt}
            setWoPlannedStartAt={setWoPlannedStartAt}
            woPlannedEndAt={woPlannedEndAt}
            setWoPlannedEndAt={setWoPlannedEndAt}
            woNote={woNote}
            setWoNote={setWoNote}
            woSteps={woSteps}
            setWoSteps={setWoSteps}
            loading={loading}
            handleCreateWorkOrder={handleCreateWorkOrder}
            loadData={loadData}
            workOrders={workOrders}
            workOrderKeyword={workOrderKeyword}
            setWorkOrderKeyword={setWorkOrderKeyword}
            workOrderFilter={workOrderFilter}
            setWorkOrderFilter={setWorkOrderFilter}
            selectedWorkOrderId={selectedWorkOrderId}
            setSelectedWorkOrderId={setSelectedWorkOrderId}
            handleWorkOrderStatus={handleWorkOrderStatus}
            selectedWorkOrder={selectedWorkOrder}
            selectedChecks={selectedChecks}
            handleStepAction={handleStepAction}
            qcResult={qcResult}
            setQcResult={setQcResult}
            qcDefectRate={qcDefectRate}
            setQcDefectRate={setQcDefectRate}
            qcCheckedBy={qcCheckedBy}
            setQcCheckedBy={setQcCheckedBy}
            qcNote={qcNote}
            setQcNote={setQcNote}
            handleCreateQc={handleCreateQc}
          />
        ) : null}

        {activeDeskTab === 'batches' ? (
          <ProductionBatchAdjustmentSection
            batches={batches}
            batchKeyword={batchKeyword}
            setBatchKeyword={setBatchKeyword}
            batchStatus={batchStatus}
            setBatchStatus={setBatchStatus}
            selectedBatchId={selectedBatchId}
            setSelectedBatchId={setSelectedBatchId}
            selectedBatch={selectedBatch}
            batchTrace={batchTrace}
            selectedTemplate={selectedTemplate}
            templateId={templateId}
            setTemplateId={setTemplateId}
            setAdjustmentReason={setAdjustmentReason}
            adjustmentQuantity={adjustmentQuantity}
            setAdjustmentQuantity={setAdjustmentQuantity}
            adjustmentReason={adjustmentReason}
            adjustmentNote={adjustmentNote}
            setAdjustmentNote={setAdjustmentNote}
            handleCreateAdjustment={handleCreateAdjustment}
            adjustments={adjustments}
            adjustmentStatus={adjustmentStatus}
            setAdjustmentStatus={setAdjustmentStatus}
            handleReverseAdjustment={handleReverseAdjustment}
          />
        ) : null}
      </div>
      {showCompleteModal && completingWorkOrder ? (
        <CompleteWorkOrderModal
          workOrderId={completingWorkOrder.id}
          productName={completingWorkOrder.productName}
          targetQuantity={Number(completingWorkOrder.targetQuantity || 0)}
          onClose={() => {
            setShowCompleteModal(false);
            setCompletingWorkOrderId(null);
          }}
          onConfirm={handleCompleteWorkOrder}
        />
      ) : null}
      <ProductionAdjustmentReverseDialog
        record={reverseAdjustment}
        loading={reverseSubmitting}
        onCancel={() => setReverseAdjustment(null)}
        onConfirm={confirmReverseAdjustment}
      />
    </div>
  );
};

export default ProductionWorkspaceV2;

