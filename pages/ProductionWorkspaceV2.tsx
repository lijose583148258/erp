import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../app/AppContext';
import { adjustmentService, AdjustmentRecord } from '../services/adjustment.service';
import { productionService, ProductionBom, ProductionSummary, ProductionWorkOrder, ProductionWorkOrderStatus, ProductionStep } from '../services/production.service';
import { ProductionBomSection } from './production/ProductionBomSection';
import { ProductionWorkOrderSection } from './production/ProductionWorkOrderSection';
import { ProductionBatchAdjustmentSection } from './production/ProductionBatchAdjustmentSection';
import { ProductionWorkspaceModals } from './production/ProductionWorkspaceModals';
import {
  createInitialWorkOrderSteps,
  type ProductionDeskTab,
} from './production/productionWorkspaceConfig';
import {
  useProductionAdjustmentForm,
  useProductionBomForm,
  useProductionQualityForm,
  useProductionWorkOrderForm,
} from './production/useProductionWorkspaceForms';
import {
  buildExpectedBomDraftSummary,
  buildEffectiveBomItemsPayload,
  buildWorkOrderStepsPayload,
  compareBomReadbackAgainstSummary,
} from './production/ProductionWorkspaceDerived';
import { useProductionUnsavedFormGuards } from './production/useProductionUnsavedFormGuards';
import { ProductionWorkspaceShellHeader } from './production/ProductionWorkspaceShellHeader';
import { useProductionWorkspaceDerivedState } from './production/useProductionWorkspaceDerivedState';
import { useProductionWorkspaceData } from './production/useProductionWorkspaceData';
import {
  validateAdjustmentForm,
  validateBomForm,
  validateQualityForm,
  validateWorkOrderForm,
  withSaveTimeout,
  type AdjustmentFormErrors,
  type BomFormErrors,
  type QualityFormErrors,
  type WorkOrderFormErrors,
} from './production/productionWorkspaceSave';

const ProductionWorkspaceV2 = () => {
  const { notify, language } = useAppContext();
  const {
    summary, boms, workOrders, batches, adjustments, loading,
    bomKeyword, setBomKeyword,
    workOrderKeyword, setWorkOrderKeyword, workOrderFilter, setWorkOrderFilter,
    batchKeyword, setBatchKeyword, batchStatus, setBatchStatus,
    adjustmentStatus, setAdjustmentStatus,
    selectedBomId, setSelectedBomId, selectedBom,
    selectedWorkOrderId, setSelectedWorkOrderId, selectedWorkOrder,
    selectedBatchId, setSelectedBatchId, selectedBatch,
    loadData,
  } = useProductionWorkspaceData(notify);

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingWorkOrderId, setCompletingWorkOrderId] = useState<number | null>(null);
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

  const bomForm = useProductionBomForm();
  const workOrderForm = useProductionWorkOrderForm(createInitialWorkOrderSteps);
  const qualityForm = useProductionQualityForm();
  const adjustmentForm = useProductionAdjustmentForm();
  const { bomProductName, setBomProductName, bomVersion, setBomVersion, bomType, setBomType, bomStatus, setBomStatus, bomFormulationMode, setBomFormulationMode, bomOutputUnit, setBomOutputUnit, bomShelfLifeDays, setBomShelfLifeDays, bomStandardBatchSize, setBomStandardBatchSize, bomBatchSizeUnit, setBomBatchSizeUnit, bomDensity, setBomDensity, bomSolidContent, setBomSolidContent, bomEffectiveFrom, setBomEffectiveFrom, bomEffectiveTo, setBomEffectiveTo, bomProcessText, setBomProcessText, bomQualitySpecText, setBomQualitySpecText, bomNotes, setBomNotes, bomItems, setBomItems, resetBomForm } = bomForm;
  const { woProductName, setWoProductName, setWoProductNameSilently, woTargetQuantity, setWoTargetQuantity, woProducedQuantity, setWoProducedQuantity, woLossQuantity, setWoLossQuantity, woPlannedStartAt, setWoPlannedStartAt, woPlannedEndAt, setWoPlannedEndAt, woNote, setWoNote, woSteps, setWoSteps, resetWoForm } = workOrderForm;
  const { qcResult, setQcResult, qcDefectRate, setQcDefectRate, qcNote, setQcNote, qcCheckedBy, setQcCheckedBy, resetQualityForm } = qualityForm;
  const { selectedTemplate, templateId, setTemplateId, adjustmentQuantity, setAdjustmentQuantity, adjustmentReason, setAdjustmentReason, adjustmentNote, setAdjustmentNote } = adjustmentForm;
  const completingWorkOrder = useMemo(
    () => workOrders.find(item => item.id === completingWorkOrderId) || null,
    [workOrders, completingWorkOrderId],
  );
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
    activeDeskTab,
    hasSelectedWorkOrder: Boolean(selectedWorkOrder),
  });

  useEffect(() => { if (selectedBom && !woProductName.trim()) setWoProductNameSilently(selectedBom.productName); }, [selectedBom, setWoProductNameSilently, woProductName]);
  useEffect(() => { if (selectedBatch && !woProductName.trim()) setWoProductNameSilently(selectedBatch.productName); }, [selectedBatch, setWoProductNameSilently, woProductName]);

  const derived = useProductionWorkspaceDerivedState({
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
  });

  const handleCreateBom = async () => {
    if (bomSaving) return;
    const { items, rejectedRows } = buildEffectiveBomItemsPayload(bomItems);
    const expectedDraftSummary = buildExpectedBomDraftSummary(items);
    const { errors: nextErrors, shelfLifeDays, standardBatchSize } = validateBomForm({
      productName: bomProductName,
      outputUnit: bomOutputUnit,
      formulationMode: bomFormulationMode,
      shelfLifeDaysInput: bomShelfLifeDays,
      standardBatchSizeInput: bomStandardBatchSize,
      percentageSummary: derived.bomPercentageSummary,
      effectiveItemCount: items.length,
      bomType,
    });
    if (Object.keys(nextErrors).length) {
      setBomFormErrors(nextErrors);
      notify('warning', Object.values(nextErrors)[0] || '请补齐配方信息');
      return;
    }
    if (rejectedRows.length) {
      notify('warning', `有 ${rejectedRows.length} 行不会保存，保存前请先确认右侧预览`);
    }

    setBomFormErrors({});
    setBomSaving(true);
    try {
      const createdBom = await withSaveTimeout(() => productionService.createBom({
        productName: bomProductName.trim(),
        version: bomVersion.trim() || 'v1',
        bomType,
        status: bomStatus,
        formulationMode: bomFormulationMode,
        outputUnit: bomOutputUnit.trim(),
        shelfLifeDays,
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
      }));
      let readbackBom: ProductionBom | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const latestBoms = await withSaveTimeout(() => productionService.getBoms());
        readbackBom = latestBoms.find(item => item.id === createdBom.id) || null;
        if (readbackBom) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      if (!readbackBom) {
        notify('error', '保存后回读不一致，请不要继续使用该 BOM');
        return;
      }
      if (readbackBom.shelfLifeDays !== shelfLifeDays) {
        notify('error', `保存后保质期回读不一致：期望 ${shelfLifeDays} 天，实际 ${readbackBom.shelfLifeDays ?? '未配置'}`);
        return;
      }

      const readbackComparison = compareBomReadbackAgainstSummary(expectedDraftSummary, readbackBom);
      if (!readbackComparison.ok) {
        notify('error', readbackComparison.reason || '保存后回读不一致，请不要继续使用该 BOM');
        return;
      }

      notify('success', 'BOM 已创建，回读核对通过');
      resetBomForm();
      setBomSaveVersion(version => version + 1);
      bomForm.clearTouched();
      await loadData();
      setSelectedBomId(createdBom.id);
      setWoProductNameSilently(createdBom.productName);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建 BOM 失败');
    } finally {
      setBomSaving(false);
    }
  };

  const handleCreateWorkOrder = async () => {
    if (workOrderSaving) return;
    const { errors: nextErrors, targetQuantity } = validateWorkOrderForm({
      productName: woProductName,
      targetQuantityInput: woTargetQuantity,
    });
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
      const createdWorkOrder = await withSaveTimeout(() => productionService.createWorkOrder({
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
      }));
      notify('success', '工单已创建');
      resetWoForm();
      setWorkOrderSaveVersion(version => version + 1);
      workOrderForm.clearTouched();
      await loadData();
      setSelectedWorkOrderId(createdWorkOrder.id);
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
    const { errors: nextErrors, defectRateValue } = validateQualityForm({
      result: qcResult,
      defectRateInput: qcDefectRate,
      checkedBy: qcCheckedBy,
    });
    if (Object.keys(nextErrors).length) {
      setQualityFormErrors(nextErrors);
      notify('warning', Object.values(nextErrors)[0] || '请补齐质检信息');
      return;
    }

    setQualityFormErrors({});
    setQualitySaving(true);
    try {
      await withSaveTimeout(() => productionService.createQualityCheck(selectedWorkOrder.id, {
        result: qcResult,
        defectRate: defectRateValue,
        note: qcNote.trim() || null,
        checkedBy: qcCheckedBy.trim() || null,
      }));
      notify('success', '质检记录已保存');
      resetQualityForm();
      setQualitySaveVersion(version => version + 1);
      qualityForm.clearTouched();
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '保存质检记录失败');
    } finally {
      setQualitySaving(false);
    }
  };

  const handleCreateAdjustment = async () => {
    if (adjustmentSaving) return;
    const batch = selectedBatch;
    const { errors: nextErrors, quantity: value } = validateAdjustmentForm({
      hasBatch: Boolean(batch),
      quantityInput: adjustmentQuantity,
      reason: adjustmentReason,
    });
    if (Object.keys(nextErrors).length) {
      setAdjustmentFormErrors(nextErrors);
      notify('warning', Object.values(nextErrors)[0] || '请补齐批次调整信息');
      return;
    }

    setAdjustmentFormErrors({});
    setAdjustmentSaving(true);
    try {
      await withSaveTimeout(() => adjustmentService.create({
        domain: 'production',
        targetType: 'productBatch',
        batchId: batch?.id ?? 0,
        targetId: batch?.id ?? 0,
        targetRef: batch?.batchNo ?? '',
        quantityDelta: value * selectedTemplate.sign,
        reason: adjustmentReason.trim(),
        reasonCategory: selectedTemplate.reasonCategory,
        lossType: selectedTemplate.lossType,
        note: adjustmentNote.trim() || null,
        status: 'posted',
      }));
        notify('success', '生产调账已登记');
      setAdjustmentQuantity('');
      setAdjustmentNote('');
      setAdjustmentSaveVersion(version => version + 1);
      adjustmentForm.clearTouched();
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

  return (
    <div className="space-y-10 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <ProductionWorkspaceShellHeader
        language={language}
        stats={derived.stats}
        isInitialLoading={derived.isInitialLoading}
        onRefresh={() => void loadData()}
        items={derived.productionDeskItems}
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
            bomShelfLifeDays={bomShelfLifeDays}
            setBomShelfLifeDays={setBomShelfLifeDays}
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
            bomPercentageSummary={derived.bomPercentageSummary}
            numericStandardBatchSize={derived.numericStandardBatchSize}
            bomItems={bomItems}
            setBomItems={setBomItems}
            loading={loading}
            bomSaving={bomSaving}
            bomFormErrors={bomFormErrors}
            bomDraftWarning={derived.bomDraftWarning}
            clearBomFormError={field => setBomFormErrors(errors => ({ ...errors, [field]: undefined }))}
            handleCreateBom={handleCreateBom}
            displayedBoms={derived.displayedBoms}
            selectedBomId={selectedBomId}
            setSelectedBomId={setSelectedBomId}
            setWoProductName={setWoProductNameSilently}
            selectedBom={selectedBom}
            selectedBomPercentageSummary={derived.selectedBomPercentageSummary}
            selectedBomProcessSummary={derived.selectedBomProcessSummary}
            selectedBomQualitySummary={derived.selectedBomQualitySummary}
            onFormTouched={bomForm.markTouched}
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
            selectedChecks={derived.selectedChecks}
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
            batchTrace={derived.batchTrace}
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

