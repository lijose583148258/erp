import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Factory, Layers3, PackageCheck, Search, Filter, TriangleAlert, ArrowUpRight, RefreshCcw, Undo2, ScanBarcode, Plus, Play, BadgeCheck, Clock3 } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { assetService, ProductBatch } from '../services/asset.service';
import { adjustmentService, AdjustmentRecord } from '../services/adjustment.service';
import { productionService, ProductionBom, ProductionSummary, ProductionWorkOrder, ProductionWorkOrderStatus, ProductionStep } from '../services/production.service';
import { isCanceledApiError } from '../utils/api';
import { ProductionBomLineGrid, type BomItemDraft } from './production/ProductionBomLineGrid';
import { CompleteWorkOrderModal } from './production/CompleteWorkOrderModal';

type BatchStatusFilter = 'all' | 'healthy' | 'expiring' | 'expired';
type AdjustmentStatusFilter = 'all' | 'posted' | 'pending' | 'reversed';
type WorkOrderFilter = 'all' | ProductionWorkOrderStatus;

type Template = { id: string; label: string; sign: 1 | -1; reason: string; reasonCategory: string; lossType: string; hint: string };
type BomType = 'standard' | 'chemical_formula';
type BomLifecycleStatus = 'draft' | 'approved' | 'active' | 'retired';
type StepDraft = { title: string; operatorName: string; note: string };

const BOM_TYPE_OPTIONS: Array<{ value: BomType; label: string }> = [
  { value: 'standard', label: '标准BOM' },
  { value: 'chemical_formula', label: '化工配方' },
];

const FORMULATION_MODE_OPTIONS = [
  { value: 'fixed', label: '固定单耗' },
  { value: 'percentage', label: '百分比配方' },
];

const BOM_TYPE_LABELS: Record<BomType, string> = {
  standard: '标准BOM',
  chemical_formula: '化工配方',
};

const FORMULATION_MODE_LABELS: Record<string, string> = {
  fixed: '固定单耗',
  percentage: '百分比配方',
};

const CHEMICAL_ROLE_LABELS: Record<string, string> = {
  main_resin: '主树脂',
  modifier_resin: '改性树脂',
  tackifier: '增粘剂',
  curing_agent: '固化剂',
  crosslinker: '交联剂',
  solvent: '溶剂',
  diluent: '稀释剂/水',
  pigment: '颜填料',
  surfactant: '润湿/分散剂',
  defoamer: '消泡剂',
  thickener: '增稠/流变剂',
  preservative: '防腐/稳定剂',
  ph_adjuster: 'pH调节剂',
  catalyst: '催化/引发剂',
  additive: '助剂',
  recycled: '回用料',
  package: '包材',
  other: '其他',
};

const DOSAGE_MODE_LABELS: Record<string, string> = {
  fixed: '固定单耗',
  percentage: '按百分比',
};

const TEMPLATES: Template[] = [
  { id: 'production_output', label: '成品入库', sign: 1, reason: '生产完工入库', reasonCategory: 'production_output', lossType: 'inbound', hint: '用于成品入库或补产转入' },
  { id: 'production_loss', label: '损耗报废', sign: -1, reason: '生产损耗、报废或破损', reasonCategory: 'production_loss', lossType: 'scrap', hint: '用于报废、破损、损耗修正' },
  { id: 'production_rework', label: '返工回收', sign: 1, reason: '返工后可用数量回收', reasonCategory: 'production_recovery', lossType: 'rework', hint: '用于返工回收与再入库' },
  { id: 'inventory_shortage', label: '盘点短少', sign: -1, reason: '盘点发现短少差异', reasonCategory: 'inventory_discrepancy', lossType: 'count_difference', hint: '用于盘点短少或差异修正' },
  { id: 'inventory_surplus', label: '盘点盈余', sign: 1, reason: '盘点发现盈余差异', reasonCategory: 'inventory_discrepancy', lossType: 'count_difference', hint: '用于盘点盈余或补录' },
];

const newBomItem = (): BomItemDraft => ({
  materialName: '',
  materialCode: '',
  ingredientRole: 'main_resin',
  dosageMode: 'fixed',
  percentage: '',
  quantityPerUnit: '',
  unit: 'kg',
  lossRate: '0',
  allowedVarianceRate: '',
  processStage: '',
  substituteGroup: '',
  yieldContribution: '',
  notes: '',
});
const newBomItems = (count = 10): BomItemDraft[] =>
  Array.from({ length: count }, () => newBomItem());
const newStep = (title = ''): StepDraft => ({ title, operatorName: '', note: '' });

const WO_LABELS: Record<ProductionWorkOrderStatus, string> = {
  draft: '草稿', planned: '已排产', in_progress: '生产中', qc_pending: '待质检', completed: '已完成', cancelled: '已取消',
};

const STEP_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

const getStepStatusLabel = (status?: string | null) => {
  if (!status) return '待处理';
  const normalized = String(status).trim().toLowerCase().replace(/-/g, '_');
  return STEP_STATUS_LABELS[normalized] || status;
};

const QC_RESULT_LABELS: Record<'pass' | 'fail' | 'pending', string> = {
  pending: '待定',
  pass: '合格',
  fail: '不合格',
};

const formatDate = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDateOnly = (value) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('zh-CN');
};

const BOM_STATUS_OPTIONS: Array<{ value: BomLifecycleStatus; label: string }> = [
  { value: 'draft', label: '草稿' },
  { value: 'approved', label: '已审批' },
  { value: 'active', label: '生效中' },
  { value: 'retired', label: '已停用' },
];

const BOM_STATUS_LABELS: Record<BomLifecycleStatus, string> = {
  draft: '草稿',
  approved: '已审批',
  active: '生效中',
  retired: '已停用',
};

const getJsonSummary = (value?: string | null, key = 'summary') => {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed[key] === 'string') return parsed[key];
  } catch {
    return value;
  }
  return '';
};

const ProductionWorkspaceV2 = () => {
  const { t, notify } = useAppContext();
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

  const [bomProductName, setBomProductName] = useState('');
  const [bomVersion, setBomVersion] = useState('v1');
  const [bomType, setBomType] = useState<BomType>('standard');
  const [bomStatus, setBomStatus] = useState<BomLifecycleStatus>('draft');
  const [bomFormulationMode, setBomFormulationMode] = useState('fixed');
  const [bomOutputUnit, setBomOutputUnit] = useState('kg');
  const [bomStandardBatchSize, setBomStandardBatchSize] = useState('');
  const [bomBatchSizeUnit, setBomBatchSizeUnit] = useState('kg');
  const [bomDensity, setBomDensity] = useState('');
  const [bomSolidContent, setBomSolidContent] = useState('');
  const [bomEffectiveFrom, setBomEffectiveFrom] = useState('');
  const [bomEffectiveTo, setBomEffectiveTo] = useState('');
  const [bomProcessText, setBomProcessText] = useState('');
  const [bomQualitySpecText, setBomQualitySpecText] = useState('');
  const [bomNotes, setBomNotes] = useState('');
  const [bomItems, setBomItems] = useState<BomItemDraft[]>(newBomItems());

  const [woProductName, setWoProductName] = useState('');
  const [woTargetQuantity, setWoTargetQuantity] = useState('');
  const [woProducedQuantity, setWoProducedQuantity] = useState('');
  const [woLossQuantity, setWoLossQuantity] = useState('');
  const [woPlannedStartAt, setWoPlannedStartAt] = useState('');
  const [woPlannedEndAt, setWoPlannedEndAt] = useState('');
  const [woNote, setWoNote] = useState('');
  const [woSteps, setWoSteps] = useState<StepDraft[]>([newStep('备料'), newStep('生产'), newStep('质检')]);

  const [qcResult, setQcResult] = useState<'pass' | 'fail'>('pass');
  const [qcDefectRate, setQcDefectRate] = useState('');
  const [qcNote, setQcNote] = useState('');
  const [qcCheckedBy, setQcCheckedBy] = useState('');

  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState(TEMPLATES[0].reason);
  const [adjustmentNote, setAdjustmentNote] = useState('');

  const selectedTemplate = useMemo(() => TEMPLATES.find(item => item.id === templateId) || TEMPLATES[0], [templateId]);
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
  useEffect(() => { if (selectedBom && !woProductName.trim()) setWoProductName(selectedBom.productName); if (selectedBom) setBomOutputUnit(selectedBom.outputUnit || 'kg'); }, [selectedBom, woProductName]);
  useEffect(() => { if (selectedBatch && !woProductName.trim()) setWoProductName(selectedBatch.productName); }, [selectedBatch, woProductName]);

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

  const resetBomForm = () => {
    setBomProductName('');
    setBomVersion('v1');
    setBomType('standard');
    setBomStatus('draft');
    setBomFormulationMode('fixed');
    setBomOutputUnit('kg');
    setBomStandardBatchSize('');
    setBomBatchSizeUnit('kg');
    setBomDensity('');
    setBomSolidContent('');
    setBomEffectiveFrom('');
    setBomEffectiveTo('');
    setBomProcessText('');
    setBomQualitySpecText('');
    setBomNotes('');
    setBomItems(newBomItems());
  };

  const resetWoForm = () => {
    setWoProductName('');
    setWoTargetQuantity('');
    setWoProducedQuantity('');
    setWoLossQuantity('');
    setWoPlannedStartAt('');
    setWoPlannedEndAt('');
    setWoNote('');
    setWoSteps([newStep('备料'), newStep('生产'), newStep('质检')]);
  };

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
      .filter(item => item.materialName.trim() || item.materialCode.trim())
      .map(item => {
        const safeMaterialName = item.materialName.trim() || item.materialCode.trim();
        return {
        materialName: safeMaterialName,
        materialCode: item.materialCode.trim() || null,
        ingredientRole: item.ingredientRole || null,
        dosageMode: item.dosageMode || null,
        percentage: item.percentage.trim() ? Number(item.percentage || 0) : null,
        quantityPerUnit: Number(
          item.quantityPerUnit
          || (item.dosageMode === 'percentage' && standardBatchSize > 0 && Number(item.percentage || 0) > 0
            ? (standardBatchSize * Number(item.percentage || 0)) / 100
            : 0),
        ),
        unit: item.unit.trim() || 'kg',
        lossRate: Number(item.lossRate || 0),
        allowedVarianceRate: item.allowedVarianceRate.trim() ? Number(item.allowedVarianceRate || 0) : null,
        processStage: item.processStage.trim() || null,
        substituteGroup: item.substituteGroup.trim() || null,
        yieldContribution: item.yieldContribution.trim() ? Number(item.yieldContribution || 0) : null,
        notes: item.notes.trim() || null,
      };
      })
      .filter(item => item.quantityPerUnit > 0);

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
      setQcDefectRate('');
      setQcNote('');
      setQcCheckedBy('');
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
    const note = window.prompt('请输入冲销说明', '生产调账冲销');
    if (note === null) return;
    try {
      await adjustmentService.reverse(record.id, note.trim() || '生产调账冲销');
      notify('success', '已完成冲销');
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '冲销失败');
    }
  };

  const selectedChecks = selectedWorkOrder?.qualityChecks || [];

  return (
    <div className="space-y-10 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tighter italic uppercase bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{t.production || '生产管理'}</h1>
<p className="text-blue-600 dark:text-blue-400 font-black text-[10px] uppercase tracking-[0.3em] mt-3 opacity-70 px-1">{t.productionDesc || '管理 BOM、工单、工序、质检和批次追踪'}</p>
        </div>
        <div className="flex flex-wrap gap-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-2 rounded-[28px] border border-white/50 dark:border-slate-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <button className="flex items-center px-6 py-3 rounded-[22px] text-[10px] font-black uppercase tracking-widest bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30 active-shrink"><Factory size={16} className="mr-2.5" />{t.production || '生产管理'}</button>
          <button onClick={() => void loadData()} className="flex items-center px-6 py-3 rounded-[22px] text-[10px] font-black uppercase tracking-widest text-slate-400"><ScanBarcode size={16} className="mr-2.5" />批次追踪</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-8">
<StatCard title="BOM 数量" value={isInitialLoading ? '加载中...' : stats.totalBoms} color="bg-blue-600" icon={<PackageCheck size={24} />} />
<StatCard title="工单数量" value={isInitialLoading ? '加载中...' : stats.totalWorkOrders} color="bg-emerald-500" icon={<Layers3 size={24} />} />
<StatCard title="活跃工单" value={isInitialLoading ? '加载中...' : stats.activeWorkOrders} color="bg-cyan-500" icon={<Play size={24} />} />
<StatCard title="待质检" value={isInitialLoading ? '加载中...' : stats.qcPendingCount} color="bg-amber-500" icon={<TriangleAlert size={24} />} />
<StatCard title="批次数量" value={isInitialLoading ? '加载中...' : stats.batchCount} color="bg-violet-500" icon={<ScanBarcode size={24} />} />
<StatCard title="库存总量" value={isInitialLoading ? '加载中...' : stats.totalStock} color="bg-slate-700" icon={<ArrowUpRight size={24} />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-5 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-8">
          <SectionHeader title="BOM 管理" subtitle="标准 BOM / 化工配方" />
          <Field label="搜索 BOM" value={bomKeyword} onChange={setBomKeyword} placeholder="搜索产品、编号或版本" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Field label="产品名称" value={bomProductName} onChange={setBomProductName} placeholder="例如：环氧树脂底胶" />
            <Field label="版本" value={bomVersion} onChange={setBomVersion} placeholder="v1" />
            <SelectField label="BOM 类型" value={bomType} onChange={setBomType} options={BOM_TYPE_OPTIONS} />
            <SelectField label="配方状态" value={bomStatus} onChange={setBomStatus} options={BOM_STATUS_OPTIONS} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <SelectField label="配方模式" value={bomFormulationMode} onChange={setBomFormulationMode} options={FORMULATION_MODE_OPTIONS} />
            <Field label="输出单位" value={bomOutputUnit} onChange={setBomOutputUnit} placeholder="kg / 吨" />
            <Field label="标准批量" value={bomStandardBatchSize} onChange={setBomStandardBatchSize} placeholder="例如 1000" />
            <Field label="批量单位" value={bomBatchSizeUnit} onChange={setBomBatchSizeUnit} placeholder="kg" />
            <Field label="密度" value={bomDensity} onChange={setBomDensity} placeholder="例如 1.12" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="固含 %" value={bomSolidContent} onChange={setBomSolidContent} placeholder="例如 55" />
            <TextareaField label="工艺摘要" value={bomProcessText} onChange={setBomProcessText} placeholder="输入搅拌、升温、熟化、过滤等关键工艺参数" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <Field label="生效开始" value={bomEffectiveFrom} onChange={setBomEffectiveFrom} placeholder="2026-04-16" type="date" />
            <Field label="生效结束" value={bomEffectiveTo} onChange={setBomEffectiveTo} placeholder="2026-12-31" type="date" />
            <div className="xl:col-span-2">
              <TextareaField label="质检规范" value={bomQualitySpecText} onChange={setBomQualitySpecText} placeholder="填写固含、粘度、外观、颜色、耐温等放行标准" />
            </div>
          </div>
          <TextareaField label="备注" value={bomNotes} onChange={setBomNotes} placeholder="说明适用产品、产线、颜色体系或客户专配信息" />
          {bomFormulationMode === 'percentage' ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs font-bold text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
              当前配方百分比合计：{bomPercentageSummary.toFixed(2)}%。系统会优先使用“标准批量 x 百分比”换算单耗，财务仍按单耗口径核算。
            </div>
          ) : null}          <div className="space-y-3">
            <ProductionBomLineGrid items={bomItems} setItems={setBomItems} standardBatchSize={numericStandardBatchSize} />
          </div>
          <button onClick={handleCreateBom} disabled={loading} className="px-6 py-4 bg-blue-600 text-white rounded-[24px] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/30 hover:scale-[1.01] transition-all active-shrink disabled:opacity-60">创建 BOM</button>
          <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-lg font-black tracking-tighter uppercase">BOM 列表</h3><div className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">{displayedBoms.length} 条</div></div>
            <div className="overflow-x-auto no-scrollbar"><table className="w-full text-left"><thead><tr className="border-b border-slate-100/50 dark:border-slate-800"><Th>编号</Th><Th>产品</Th><Th>类型</Th><Th>版本</Th><Th>物料</Th><Th>工单</Th><Th>操作</Th></tr></thead><tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">{displayedBoms.map(bom => (<tr key={bom.id} className={`transition-all ${selectedBomId === bom.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-blue-50/20 dark:hover:bg-blue-900/5'}`}><Td mono>{bom.bomNo}</Td><Td><div className="font-bold text-slate-900 dark:text-white text-sm">{bom.productName}</div><div className="text-[11px] text-slate-400 mt-1">{bom.standardBatchSize ? `标准批量 ${bom.standardBatchSize} ${bom.batchSizeUnit || bom.outputUnit}` : `输出单位 ${bom.outputUnit}`}</div></Td><Td>{BOM_TYPE_LABELS[(bom.bomType as BomType) || 'standard'] || '标准BOM'}</Td><Td><div className="font-bold text-slate-700 dark:text-slate-200">{bom.version}</div><div className="text-[11px] text-slate-400 mt-1">{FORMULATION_MODE_LABELS[bom.formulationMode || 'fixed'] || ''}</div></Td><Td>{bom.items?.length || 0}</Td><Td>{bom.workOrders?.length || 0}</Td><Td><button onClick={() => { setSelectedBomId(bom.id); setWoProductName(bom.productName); }} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">选中</button></Td></tr>))}</tbody></table></div>
            {selectedBom ? (
              <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">已选 BOM</div>
                    <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{selectedBom.productName}</div>
                    <div className="mt-1 text-xs text-slate-400">{selectedBom.bomNo} / {selectedBom.version}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MiniTag label={BOM_STATUS_LABELS[(selectedBom.status as BomLifecycleStatus) || 'draft'] || '草稿'} />
                    <MiniTag label={BOM_TYPE_LABELS[(selectedBom.bomType as BomType) || 'standard'] || '标准BOM'} />
                    <MiniTag label={FORMULATION_MODE_LABELS[selectedBom.formulationMode || 'fixed'] || ''} />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                  <SummaryChip label="配方状态" value={BOM_STATUS_LABELS[(selectedBom.status as BomLifecycleStatus) || 'draft'] || '草稿'} />
                  <SummaryChip label="输出单位" value={selectedBom.outputUnit || '--'} />
                  <SummaryChip label="标准批量" value={selectedBom.standardBatchSize ? `${selectedBom.standardBatchSize} ${selectedBom.batchSizeUnit || selectedBom.outputUnit}` : '--'} />
                  <SummaryChip label="密度" value={selectedBom.density ? String(selectedBom.density) : '--'} />
                  <SummaryChip label="固含" value={selectedBom.solidContent !== undefined && selectedBom.solidContent !== null ? `${selectedBom.solidContent}%` : '--'} />
                  <SummaryChip label="百分比合计" value={selectedBomPercentageSummary > 0 ? `${selectedBomPercentageSummary.toFixed(2)}%` : '--'} />
                  <SummaryChip label="生效开始" value={formatDateOnly(selectedBom.effectiveFrom)} />
                  <SummaryChip label="生效结束" value={formatDateOnly(selectedBom.effectiveTo)} />
                </div>
                {selectedBomProcessSummary ? (
                  <div className="rounded-[22px] bg-white/80 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-700 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">工艺摘要</div>
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{selectedBomProcessSummary}</div>
                  </div>
                ) : null}
                {selectedBomQualitySummary ? (
                  <div className="rounded-[22px] bg-white/80 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-700 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">质检规范</div>
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{selectedBomQualitySummary}</div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">配方明细快览</div>
                  <div className="space-y-2">
                    {selectedBom.items?.map(item => {
                      const displayName = item.materialName || item.materialCode || '保密原料';
                      const isCodeOnly = item.materialCode && item.materialName === item.materialCode;
                      return (
                      <div key={item.id || displayName} className="rounded-[20px] bg-white/80 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-700 px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-sm font-black text-slate-900 dark:text-white">{displayName}</div>
                          <div className="text-[11px] text-slate-400 mt-1">{isCodeOnly ? '仅代号' : (item.materialCode || '未填代号')} / {CHEMICAL_ROLE_LABELS[item.ingredientRole || 'other'] || '其他'} / {item.processStage || '未分阶段'}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <MiniTag label={DOSAGE_MODE_LABELS[item.dosageMode || 'fixed'] || ''} />
                          {item.percentage !== undefined && item.percentage !== null ? <MiniTag label={`${item.percentage}%`} /> : null}
                          <MiniTag label={`${item.quantityPerUnit} ${item.unit}`} />
                          {item.lossRate !== undefined && item.lossRate !== null ? <MiniTag label={`损耗 ${item.lossRate}%`} /> : null}
                          {item.allowedVarianceRate !== undefined && item.allowedVarianceRate !== null ? <MiniTag label={`允许偏差 ${item.allowedVarianceRate}%`} /> : null}
                        </div>
                      </div>
                    );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="xl:col-span-7 space-y-8">
          <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-8">
            <SectionHeader title="工单工作台" subtitle="排产 / 工序 / 质检 / 完工" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <Field label="产品名称" value={woProductName} onChange={setWoProductName} placeholder="从 BOM 或批次带入" />
              <Field label="目标数量" value={woTargetQuantity} onChange={setWoTargetQuantity} placeholder="0" />
              <Field label="已产数量" value={woProducedQuantity} onChange={setWoProducedQuantity} placeholder="0" />
              <Field label="损耗数量" value={woLossQuantity} onChange={setWoLossQuantity} placeholder="0" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><Field label="计划开始" value={woPlannedStartAt} onChange={setWoPlannedStartAt} placeholder="2026-04-08T09:00" type="datetime-local" /><Field label="计划结束" value={woPlannedEndAt} onChange={setWoPlannedEndAt} placeholder="2026-04-08T18:00" type="datetime-local" /></div>
            <TextareaField label="工单备注" value={woNote} onChange={setWoNote} placeholder="工单说明、特殊工艺、异常提醒" />
            <div className="space-y-3">
              <div className="flex items-center justify-between"><div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">工序步骤</div><button onClick={() => setWoSteps(prev => [...prev, newStep(`工序 ${prev.length + 1}`)])} className="text-[10px] font-black uppercase tracking-widest text-blue-600 flex items-center gap-1"><Plus size={12} /> 添加步骤</button></div>
              {woSteps.map((step, index) => (<div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-[24px] border border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-3"><Field label="步骤" value={step.title} onChange={value => setWoSteps(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, title: value } : row))} placeholder="备料 / 生产 / 质检" /><Field label="负责人" value={step.operatorName} onChange={value => setWoSteps(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, operatorName: value } : row))} placeholder="操作员" /><Field label="备注" value={step.note} onChange={value => setWoSteps(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, note: value } : row))} placeholder="工序说明" /><div className="flex items-end justify-between gap-2"><div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">序号 {index + 1}</div>{woSteps.length > 1 && <button onClick={() => setWoSteps(prev => prev.filter((_, rowIndex) => rowIndex !== index))} className="text-[10px] font-black uppercase tracking-widest text-rose-500">删除</button>}</div></div>))}
            </div>
            <div className="flex flex-wrap gap-3"><button onClick={handleCreateWorkOrder} disabled={loading} className="px-6 py-4 bg-blue-600 text-white rounded-[24px] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/30 hover:scale-[1.01] transition-all active-shrink disabled:opacity-60">创建工单</button><button onClick={() => void loadData()} className="px-6 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 rounded-[24px] font-black text-xs uppercase tracking-widest active-shrink flex items-center gap-2"><RefreshCcw size={14} />刷新</button></div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
            <div className="xl:col-span-3 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
                <div className="flex items-center justify-between mb-6"><h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center"><div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />工单列表</h2><div className="flex items-center gap-3"><div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full"><Search size={14} className="text-slate-400" /><input value={workOrderKeyword} onChange={e => setWorkOrderKeyword(e.target.value)} placeholder="搜索工单" className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200 w-32" /></div><div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full"><Filter size={14} className="text-slate-400" /><select value={workOrderFilter} onChange={e => setWorkOrderFilter(e.target.value as WorkOrderFilter)} className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200"><option value="all">全部</option><option value="draft">草稿</option><option value="planned">已排产</option><option value="in_progress">生产中</option><option value="qc_pending">待质检</option><option value="completed">已完工</option><option value="cancelled">已取消</option></select></div></div></div>
                <div className="overflow-x-auto no-scrollbar"><table className="w-full text-left"><thead><tr className="border-b border-slate-100/50 dark:border-slate-800"><Th>工单号</Th><Th>产品</Th><Th>数量</Th><Th>状态</Th><Th>工序</Th><Th>操作</Th></tr></thead><tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">{workOrders.map(order => (<tr key={order.id} onClick={() => setSelectedWorkOrderId(order.id)} className={`cursor-pointer transition-all ${selectedWorkOrderId === order.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-blue-50/20 dark:hover:bg-blue-900/5'}`}><Td mono>{order.workOrderNo}</Td><Td><div className="font-bold text-slate-900 dark:text-white text-sm">{order.productName}</div><div className="text-[11px] text-slate-400 mt-1">{order.bom?.bomNo || '未绑定BOM'}</div></Td><Td>{Number(order.targetQuantity || 0).toLocaleString()}</Td><Td><StatusBadge status={order.status} /></Td><Td>{order.steps?.length || 0}</Td><Td><div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}><OrderActionButtons workOrderId={order.id} status={order.status} onAction={handleWorkOrderStatus} /></div></Td></tr>))}</tbody></table></div>
            </div>

            <div className="xl:col-span-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
              <SectionHeader title="工单详情" subtitle="工序 / 质检 / 完工控制" />
              {selectedWorkOrder ? (
                <>
                  <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">工单信息</div>
                    <div className="text-lg font-black text-slate-900 dark:text-white">{selectedWorkOrder.productName}</div>
                    <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{selectedWorkOrder.workOrderNo}</div>
                    <div className="text-xs text-slate-400">
                      目标 {selectedWorkOrder.targetQuantity} · 已产 {selectedWorkOrder.producedQuantity} · 损耗 {selectedWorkOrder.lossQuantity}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={selectedWorkOrder.status} />
                      {selectedWorkOrder.productBatch && <MiniTag label={`批次 ${selectedWorkOrder.productBatch.batchNo}`} />}
                    </div>
                  </div>

                  <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">工序步骤</div>
                      <div className="text-[11px] font-black text-slate-500">{selectedWorkOrder.steps?.length || 0} 步</div>
                    </div>
                    <div className="space-y-3">
                      {selectedWorkOrder.steps?.map(step => (
                        <div key={step.id} className="rounded-[22px] border border-slate-100 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-black text-slate-900 dark:text-white">{step.stepNo}. {step.title}</div>
                              <div className="text-[11px] text-slate-400 mt-1">{step.operatorName || '未分配负责人'}</div>
                            </div>
                            <MiniTag label={getStepStatusLabel(step.status)} />
                          </div>
                          <div className="text-[11px] text-slate-400 flex flex-wrap gap-3">
                            <span className="inline-flex items-center gap-1"><Clock3 size={12} /> 开始 {formatDate(step.startedAt)}</span>
                            <span className="inline-flex items-center gap-1"><BadgeCheck size={12} /> 完成 {formatDate(step.completedAt)}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {step.status !== 'in_progress' && (
                              <button onClick={() => void handleStepAction(step, 'in_progress')} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest">开始</button>
                            )}
                            {step.status !== 'completed' && (
                              <button onClick={() => void handleStepAction(step, 'completed')} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">完成</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">质检登记</div>
                    <div className="grid grid-cols-2 gap-3">
                      <select value={qcResult} onChange={e => setQcResult(e.target.value as 'pass' | 'fail')} className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-slate-900/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700">
                        <option value="pass">{QC_RESULT_LABELS.pass}</option>
                        <option value="fail">{QC_RESULT_LABELS.fail}</option>
                      </select>
                      <input value={qcDefectRate} onChange={e => setQcDefectRate(e.target.value)} placeholder="缺陷率 %" className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-slate-900/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700" />
                    </div>
                    <input value={qcCheckedBy} onChange={e => setQcCheckedBy(e.target.value)} placeholder="质检人" className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-slate-900/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700" />
                    <TextareaField label="" value={qcNote} onChange={setQcNote} placeholder="质检备注" />
                    <div className="flex flex-wrap gap-3">
                      <button onClick={handleCreateQc} className="px-5 py-3 rounded-2xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest">保存质检</button>
                      <button onClick={() => void handleWorkOrderStatus('qc_pending')} className="px-5 py-3 rounded-2xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">标记待质检</button>
                      <button onClick={() => void handleWorkOrderStatus('completed')} className="px-5 py-3 rounded-2xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest">直接完工</button>
                    </div>
                  </div>

                  <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-3">最近质检</div>
                    <div className="space-y-3">
                      {selectedChecks.length === 0 && <div className="text-sm font-bold text-slate-400">暂无质检记录</div>}
                      {selectedChecks.map(check => (
                        <div key={check.id} className="flex items-center justify-between rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-700 px-4 py-3">
                          <div>
                            <div className="text-sm font-black text-slate-900 dark:text-white">{check.checkNo}</div>
                            <div className="text-[11px] text-slate-400 mt-1">{check.checkedBy || ''} · {formatDate(check.checkedAt)}</div>
                          </div>
                          <MiniTag label={QC_RESULT_LABELS[check.result] || check.result} />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-slate-400 font-bold">暂无可查看工单</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
            <div className="xl:col-span-3 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center">
                  <div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />
                  批次列表
                </h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">
                    <Search size={14} className="text-slate-400" />
                    <input value={batchKeyword} onChange={e => setBatchKeyword(e.target.value)} placeholder="搜索批次" className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200 w-32" />
                  </div>
                  <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">
                    <Filter size={14} className="text-slate-400" />
                    <select value={batchStatus} onChange={e => setBatchStatus(e.target.value as BatchStatusFilter)} className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200">
                      <option value="all">全部</option>
                      <option value="healthy">正常</option>
                      <option value="expiring">临期</option>
                      <option value="expired">已过期</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto no-scrollbar">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100/50 dark:border-slate-800">
                      <Th>批次号</Th>
                      <Th>产品</Th>
                      <Th>日期</Th>
                      <Th>库存</Th>
                      <Th>状态</Th>
                      <Th>操作</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                    {batches.map(batch => (
                      <tr key={batch.id} onClick={() => setSelectedBatchId(batch.id)} className={`cursor-pointer transition-all ${selectedBatchId === batch.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-blue-50/20 dark:hover:bg-blue-900/5'}`}>
                        <Td mono>{batch.batchNo}</Td>
                        <Td strong>{batch.productName}</Td>
                        <Td>{formatDateOnly(batch.productionDate)} / {formatDateOnly(batch.expiryDate)}</Td>
                        <Td>{batch.stockQuantity} {batch.unit}</Td>
                        <Td><BatchBadge status={batch.status} /></Td>
                        <Td><button onClick={e => { e.stopPropagation(); setSelectedBatchId(batch.id); }} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">选中</button></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="xl:col-span-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
              <SectionHeader title="批次追踪" subtitle="入库 / 效期 / 温控 / 盘点" />
              {selectedBatch ? (
                <>
                  <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">批次信息</div>
                    <div className="text-lg font-black text-slate-900 dark:text-white">{selectedBatch.batchNo}</div>
                    <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{selectedBatch.productName}</div>
                    <div className="text-xs text-slate-400">库存 {selectedBatch.stockQuantity} {selectedBatch.unit} · 冷链 {selectedBatch.isColdChain ? '是' : '否'}</div>
                  </div>
                  <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5">
                    <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-4">追踪节点</div>
                    <div className="space-y-3">
                      {batchTrace.map(node => (
                        <div key={node.label} className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-black text-slate-900 dark:text-white">{node.label}</div>
                            <div className="text-[11px] text-slate-400 mt-1">{node.place}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-slate-500">{node.status}</div>
                            <div className="text-[11px] text-slate-400 mt-1">{formatDateOnly(node.time.toISOString())}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">生产调账模板</div>
                      <div className="text-[11px] font-black text-slate-500">{selectedTemplate.label}</div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {TEMPLATES.map(template => (
                        <button key={template.id} onClick={() => { setTemplateId(template.id); setAdjustmentReason(template.reason); }} className={`text-left p-4 rounded-[24px] border transition-all duration-300 ${templateId === template.id ? 'bg-blue-600 text-white border-blue-500 shadow-xl shadow-blue-500/20' : 'bg-white/80 dark:bg-slate-900/80 border-white/60 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-200 dark:hover:border-blue-900'}`}>
                          <div className="text-[10px] font-black uppercase tracking-widest">{template.label}</div>
                          <div className="mt-2 text-[11px] opacity-75">{template.hint}</div>
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="数量" value={adjustmentQuantity} onChange={setAdjustmentQuantity} placeholder="例如 12" />
                      <Field label="方向" value={selectedTemplate.sign > 0 ? '入库增加' : '库存减少'} onChange={() => undefined} placeholder="" readOnly />
                    </div>
                    <Field label="原因" value={adjustmentReason} onChange={setAdjustmentReason} placeholder="调账原因" />
                    <TextareaField label="备注" value={adjustmentNote} onChange={setAdjustmentNote} placeholder="可填损耗原因、工艺说明或盘点备注" />
                    <button onClick={handleCreateAdjustment} className="px-5 py-3 rounded-2xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest">登记生产调账</button>
                  </div>
                </>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-slate-400 font-bold">暂无可查看批次</div>
              )}
            </div>
          </div>

          <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center">
                <div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />
                调账历史
              </h2>
              <div className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full tracking-widest uppercase">{adjustments.length} 条</div>
            </div>
            <div className="mb-6 flex flex-wrap gap-2">
              {(['all', 'posted', 'pending', 'reversed'] as AdjustmentStatusFilter[]).map(status => (
                <button key={status} onClick={() => setAdjustmentStatus(status)} className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${adjustmentStatus === status ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20' : 'bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300'}`}>
                  {status === 'all' ? '全部' : status === 'posted' ? '已生效' : status === 'pending' ? '待处理' : '已冲销'}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100/50 dark:border-slate-800">
                    <Th>单号</Th>
                    <Th>批次</Th>
                    <Th>变化</Th>
                    <Th>原因</Th>
                    <Th>状态</Th>
                    <Th>时间</Th>
                    <Th>操作</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                  {adjustments.map(record => (
                    <tr key={record.id} className="hover:bg-blue-50/20 dark:hover:bg-blue-900/5 transition-all">
                      <Td mono>{record.adjustmentNo}</Td>
                      <Td>
                        <div className="font-bold text-slate-900 dark:text-white text-sm">{record.batchNo || ''}</div>
                        <div className="text-[11px] text-slate-400 mt-1">{record.productName || ''}</div>
                      </Td>
                      <Td>
                        <span className={`inline-flex items-center px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${Number(record.quantityDelta || 0) >= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800' : 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-900/20 dark:border-rose-800'}`}>
                          {Number(record.quantityDelta || 0) >= 0 ? <ArrowUpRight size={12} className="mr-1" /> : <ArrowUpRight size={12} className="mr-1 rotate-180" />}
                          {Number(record.quantityDelta || 0) >= 0 ? '+' : ''}
                          {record.quantityDelta || 0}
                        </span>
                      </Td>
                      <Td>
                        <div className="text-sm font-bold text-slate-900 dark:text-white">{record.reason}</div>
                        <div className="text-[11px] text-slate-400 mt-1">{record.reasonCategory || ''} · {record.lossType || ''}</div>
                      </Td>
                      <Td><AdjustmentBadge status={record.status} /></Td>
                      <Td className="text-xs text-slate-400 font-black uppercase tracking-tight">{formatDate(record.createdAt)}</Td>
                      <Td>
                        <button onClick={() => handleReverseAdjustment(record)} disabled={record.status !== 'posted'} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"><Undo2 size={12} className="inline mr-1" />冲销</button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
      </section>
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
    </div>
      </div>
      );
};

const SectionHeader = ({ title, subtitle }: { title: string; subtitle: string }) => <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center"><div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{title}</h2><div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{subtitle}</div></div>;
const StatCard = ({ title, value, color, icon }: { title: string; value: number | string; color: string; icon: React.ReactNode }) => <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[40px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]"><div className={`p-4 ${color} text-white rounded-[22px] shadow-xl shadow-current/20 w-fit mb-8`}>{icon}</div><p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</p><p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{value}</p></div>;
const SummaryChip = ({ label, value }: { label: string; value: string }) => <div className="rounded-[20px] border border-slate-100 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 px-4 py-3"><div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div><div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{value}</div></div>;
const Field = ({ label, value, onChange, placeholder, type = 'text', readOnly = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string; readOnly?: boolean; }) => <label className="block"><span className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span><input value={value} readOnly={readOnly} onChange={readOnly ? undefined : e => onChange(e.target.value)} placeholder={placeholder} type={type} className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700" /></label>;
const SelectField = ({ label, value, onChange, options }: { label: string; value: string; onChange: (value: any) => void; options: Array<{ value: string; label: string }>; }) => <label className="block"><span className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span><select value={value} onChange={e => onChange(e.target.value)} className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700">{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
const TextareaField = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; }) => <label className="block">{label ? <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span> : null}<textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full min-h-24 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700" /></label>;
const Th = ({ children }: { children: React.ReactNode }) => <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.25em]">{children}</th>;
const Td = ({ children, mono, strong, className = '' }: { children: React.ReactNode; mono?: boolean; strong?: boolean; className?: string }) => <td className={`px-4 py-5 text-sm ${mono ? 'font-mono text-xs font-bold text-slate-600 dark:text-slate-300' : strong ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'} ${className}`}>{children}</td>;
const MiniTag = ({ label }: { label: string }) => <span className="inline-flex items-center px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200">{label}</span>;
const BatchBadge = ({ status }: { status?: ProductBatch['status'] }) => <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${status === 'expired' ? 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-900/20 dark:border-rose-800' : status === 'expiring' ? 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800' : 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800'}`}>{status === 'expired' ? '已过期' : status === 'expiring' ? '临期' : '正常'}</span>;
const AdjustmentBadge = ({ status }: { status: AdjustmentRecord['status'] }) => <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${status === 'posted' ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800' : status === 'reversed' ? 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:border-slate-700' : 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800'}`}>{status === 'posted' ? '已生效' : status === 'reversed' ? '已冲销' : '待处理'}</span>;
const StatusBadge = ({ status }: { status: ProductionWorkOrderStatus }) => <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${status === 'completed' ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800' : status === 'qc_pending' ? 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800' : status === 'in_progress' ? 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/20 dark:border-blue-800' : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}>{WO_LABELS[status]}</span>;
  const OrderActionButtons = ({
    workOrderId,
    status,
    onAction,
  }: {
    workOrderId: number;
    status: ProductionWorkOrderStatus;
    onAction: (workOrderId: number, status: ProductionWorkOrderStatus) => Promise<void>;
  }) => {
    if (status === 'completed' || status === 'cancelled') {
      return <MiniTag label={WO_LABELS[status]} />;
    }

    if (status === 'qc_pending') {
      return (
        <>
          <button
            onClick={() => void onAction(workOrderId, 'completed')}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest"
          >
            完工
          </button>
          <button
            onClick={() => void onAction(workOrderId, 'cancelled')}
            className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200"
          >
            取消
          </button>
        </>
      );
    }

    if (status === 'in_progress') {
      return (
        <>
          <button
            onClick={() => void onAction(workOrderId, 'qc_pending')}
            className="px-3 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest"
          >
            送检
          </button>
          <button
            onClick={() => void onAction(workOrderId, 'cancelled')}
            className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200"
          >
            取消
          </button>
        </>
      );
    }

    return (
      <>
        <button
          onClick={() => void onAction(workOrderId, 'in_progress')}
          className="px-3 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest"
        >
          开工
        </button>
        <button
          onClick={() => void onAction(workOrderId, 'cancelled')}
          className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200"
        >
          取消
        </button>
      </>
    );
  };

export default ProductionWorkspaceV2;
















