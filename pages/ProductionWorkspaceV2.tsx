import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../app/AppContext';
import { assetService, ProductBatch } from '../services/asset.service';
import { adjustmentService, AdjustmentRecord } from '../services/adjustment.service';
import { productionService, ProductionBom, ProductionSummary, ProductionWorkOrder, ProductionWorkOrderStatus, ProductionStep } from '../services/production.service';
import { isCanceledApiError } from '../utils/api';
import { ProductionBomSection } from './production/ProductionBomSection';
import { ProductionWorkOrderSection } from './production/ProductionWorkOrderSection';
import { ProductionBatchAdjustmentSection } from './production/ProductionBatchAdjustmentSection';
import { ProductionWorkspaceModals } from './production/ProductionWorkspaceModals';
import {
  getJsonSummary,
  newStep,
  type AdjustmentStatusFilter,
  type BatchStatusFilter,
  type ProductionDeskTab,
  type WorkOrderFilter,
} from './production/productionWorkspaceConfig';
import {
  useProductionAdjustmentForm,
  useProductionBomForm,
  useProductionQualityForm,
  useProductionWorkOrderForm,
} from './production/useProductionWorkspaceForms';
import {
  buildBatchTrace,
  buildEffectiveBomItemsPayload,
  buildProductionDeskItems,
  buildProductionStats,
  buildWorkOrderStepsPayload,
  filterProductionBoms,
} from './production/ProductionWorkspaceDerived';
import { useProductionUnsavedFormGuards } from './production/useProductionUnsavedFormGuards';
import { ProductionWorkspaceShellHeader } from './production/ProductionWorkspaceShellHeader';

type BomFormErrors = Partial<Record<'productName' | 'outputUnit' | 'standardBatchSize' | 'percentage' | 'items', string>>;
type WorkOrderFormErrors = Partial<Record<'productName' | 'targetQuantity', string>>;
type QualityFormErrors = Partial<Record<'defectRate' | 'checkedBy', string>>;
type AdjustmentFormErrors = Partial<Record<'batch' | 'quantity' | 'reason', string>>;

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
  const [workOrderSaveVersion, setWorkOrderSaveVersion] = useState(0);
  const [qualitySaveVersion, setQualitySaveVersion] = useState(0);
  const [adjustmentSaveVersion, setAdjustmentSaveVersion] = useState(0);
  const [bomFormErrors, setBomFormErrors] = useState<BomFormErrors>({});
  const [workOrderFormErrors, setWorkOrderFormErrors] = useState<WorkOrderFormErrors>({});
  const [qualityFormErrors, setQualityFormErrors] = useState<QualityFormErrors>({});
  const [adjustmentFormErrors, setAdjustmentFormErrors] = useState<AdjustmentFormErrors>({});
  const [bomSaving, setBomSaving] = useState(false);
  const [workOrderSaving, setWorkOrderSaving] = useState(false);
  const [qualitySaving, setQualitySaving] = useState(false);
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);

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
  const selectedBom = useMemo(() => boms.find(item => item.id === selectedBomId) || null, [boms, selectedBomId]);
  const selectedWorkOrder = useMemo(() => workOrders.find(item => item.id === selectedWorkOrderId) || null, [workOrders, selectedWorkOrderId]);
  const completingWorkOrder = useMemo(
    () => workOrders.find(item => item.id === completingWorkOrderId) || null,
    [workOrders, completingWorkOrderId],
  );
  const selectedBatch = useMemo(() => batches.find(item => item.id === selectedBatchId) || null, [batches, selectedBatchId]);
  const autoFilledWorkOrderProduct = selectedBom?.productName || selectedBatch?.productName || '';
  useProductionUnsavedFormGuards({
    bomForm,
    workOrderForm,
    qualityForm,
    adjustmentForm,
    bomSaveVersion,
    workOrderSaveVersion,
    qualitySaveVersion,
    adjustmentSaveVersion,
    autoFilledWorkOrderProduct,
  });

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

  const displayedBoms = useMemo(() => filterProductionBoms(boms, bomKeyword), [boms, bomKeyword]);
  const stats = useMemo(() => buildProductionStats(summary, boms, workOrders, batches), [summary, boms, workOrders, batches]);
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

  const batchTrace = useMemo(() => buildBatchTrace(selectedBatch, workOrders), [selectedBatch, workOrders]);

  const handleCreateBom = async () => {
    if (bomSaving) return;
    const nextErrors: BomFormErrors = {};
    if (!bomProductName.trim()) nextErrors.productName = '请填写产品名称';
    if (!bomOutputUnit.trim()) nextErrors.outputUnit = '请填写输出单位';

    const standardBatchSize = Number(bomStandardBatchSize || 0);
    if (bomFormulationMode === 'percentage' && standardBatchSize <= 0) {
      nextErrors.standardBatchSize = '百分比配方请填写大于 0 的标准批量';
    }
    if (bomFormulationMode === 'percentage' && bomPercentageSummary > 0 && Math.abs(bomPercentageSummary - 100) > 0.01) {
      nextErrors.percentage = `当前配方百分比合计为 ${bomPercentageSummary.toFixed(2)}%，请校正为 100%`;
    }

    const items = buildEffectiveBomItemsPayload(bomItems);

    if (!items.length) {
      nextErrors.items = '请至少添加 1 个有效物料，且单耗必须大于 0；保密原料可以只填代号/编码';
    }
    if (bomType === 'chemical_formula' && items.length < 10) {
      nextErrors.items = '化工配方建议至少填写 10 种原料；保密原料可以只填代号/编码';
    }
    if (Object.keys(nextErrors).length) {
      setBomFormErrors(nextErrors);
      notify('warning', Object.values(nextErrors)[0] || '请补齐配方信息');
      return;
    }

    setBomFormErrors({});
    setBomSaving(true);
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
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建 BOM 失败');
    } finally {
      setBomSaving(false);
    }
  };

  const handleCreateWorkOrder = async () => {
    if (workOrderSaving) return;
    const nextErrors: WorkOrderFormErrors = {};
    if (!woProductName.trim()) nextErrors.productName = '请填写工单产品';
    const targetQuantity = Number(woTargetQuantity || 0);
    if (!woTargetQuantity.trim() || !Number.isFinite(targetQuantity) || targetQuantity <= 0) {
      nextErrors.targetQuantity = '目标数量必须大于 0';
    }
    if (Object.keys(nextErrors).length) {
      setWorkOrderFormErrors(nextErrors);
      notify('warning', Object.values(nextErrors)[0] || '请补齐工单信息');
      return;
    }

    const steps = buildWorkOrderStepsPayload(woSteps);
    const resolvedProductName = woProductName.trim();
    const resolvedBom = boms.find(item => item.productName === resolvedProductName) || selectedBom;
    const resolvedBatch = selectedBatch?.productName === resolvedProductName ? selectedBatch : null;

    setWorkOrderFormErrors({});
    setWorkOrderSaving(true);
    try {
      await productionService.createWorkOrder({
        bomId: resolvedBom?.id ?? selectedBomId ?? undefined,
        batchId: resolvedBatch?.id ?? selectedBatchId ?? undefined,
        productName: resolvedProductName,
        targetQuantity,
        producedQuantity: Number(woProducedQuantity || 0),
        lossQuantity: Number(woLossQuantity || 0),
        plannedStartAt: woPlannedStartAt || null,
        plannedEndAt: woPlannedEndAt || null,
        note: woNote.trim() || null,
        steps,
      });
      notify('success', '工单已创建');
      resetWoForm();
      setWorkOrderSaveVersion(version => version + 1);
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建工单失败');
    } finally {
      setWorkOrderSaving(false);
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
    if (qualitySaving) return;
    if (!selectedWorkOrder) return notify('warning', '请先选择工单');
    const nextErrors: QualityFormErrors = {};
    const defectRateValue = qcDefectRate.trim() ? Number(qcDefectRate) : null;
    if (defectRateValue !== null && (!Number.isFinite(defectRateValue) || defectRateValue < 0 || defectRateValue > 100)) {
      nextErrors.defectRate = '缺陷率必须在 0 到 100 之间';
    }
    if (qcResult === 'fail' && !qcCheckedBy.trim()) {
      nextErrors.checkedBy = '不合格记录请填写质检人';
    }
    if (Object.keys(nextErrors).length) {
      setQualityFormErrors(nextErrors);
      notify('warning', Object.values(nextErrors)[0] || '请补齐质检信息');
      return;
    }

    setQualityFormErrors({});
    setQualitySaving(true);
    try {
      await productionService.createQualityCheck(selectedWorkOrder.id, {
        result: qcResult,
        defectRate: defectRateValue,
        note: qcNote.trim() || null,
        checkedBy: qcCheckedBy.trim() || null,
      });
      notify('success', '质检记录已保存');
      resetQualityForm();
      setQualitySaveVersion(version => version + 1);
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '保存质检记录失败');
    } finally {
      setQualitySaving(false);
    }
  };

  const handleCreateAdjustment = async () => {
    if (adjustmentSaving) return;
    const nextErrors: AdjustmentFormErrors = {};
    if (!selectedBatch) nextErrors.batch = '请先选择批次';
    const value = Number(adjustmentQuantity);
    if (!Number.isFinite(value) || value <= 0) nextErrors.quantity = '请填写大于 0 的有效数量';
    if (!adjustmentReason.trim()) nextErrors.reason = '请填写调整原因';
    if (Object.keys(nextErrors).length) {
      setAdjustmentFormErrors(nextErrors);
      notify('warning', Object.values(nextErrors)[0] || '请补齐批次调整信息');
      return;
    }

    setAdjustmentFormErrors({});
    setAdjustmentSaving(true);
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
      setAdjustmentSaveVersion(version => version + 1);
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '登记生产调账失败');
    } finally {
      setAdjustmentSaving(false);
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
    () => buildProductionDeskItems(boms.length, workOrders.length, batches.length),
    [batches.length, boms.length, workOrders.length],
  );

  return (
    <div className="space-y-10 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <ProductionWorkspaceShellHeader
        language={language}
        stats={stats}
        isInitialLoading={isInitialLoading}
        onRefresh={() => void loadData()}
        items={productionDeskItems}
        activeTab={activeDeskTab}
        onTabChange={setActiveDeskTab}
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
            bomSaving={bomSaving}
            bomFormErrors={bomFormErrors}
            clearBomFormError={field => setBomFormErrors(errors => ({ ...errors, [field]: undefined }))}
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
            workOrderSaving={workOrderSaving}
            workOrderFormErrors={workOrderFormErrors}
            clearWorkOrderFormError={field => setWorkOrderFormErrors(errors => ({ ...errors, [field]: undefined }))}
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
            qualitySaving={qualitySaving}
            qualityFormErrors={qualityFormErrors}
            clearQualityFormError={field => setQualityFormErrors(errors => ({ ...errors, [field]: undefined }))}
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
            adjustmentSaving={adjustmentSaving}
            adjustmentFormErrors={adjustmentFormErrors}
            clearAdjustmentFormError={field => setAdjustmentFormErrors(errors => ({ ...errors, [field]: undefined }))}
            handleCreateAdjustment={handleCreateAdjustment}
            adjustments={adjustments}
            adjustmentStatus={adjustmentStatus}
            setAdjustmentStatus={setAdjustmentStatus}
            handleReverseAdjustment={handleReverseAdjustment}
          />
        ) : null}
      </div>
      <ProductionWorkspaceModals
        showCompleteModal={showCompleteModal}
        completingWorkOrder={completingWorkOrder}
        reverseAdjustment={reverseAdjustment}
        reverseSubmitting={reverseSubmitting}
        onCloseComplete={() => {
          setShowCompleteModal(false);
          setCompletingWorkOrderId(null);
        }}
        onConfirmComplete={handleCompleteWorkOrder}
        onCancelReverse={() => setReverseAdjustment(null)}
        onConfirmReverse={confirmReverseAdjustment}
      />
    </div>
  );
};

export default ProductionWorkspaceV2;

