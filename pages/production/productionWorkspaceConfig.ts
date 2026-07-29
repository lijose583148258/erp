import type { ProductionWorkOrderStatus } from '../../services/production.service';
import type { WorkspaceTaskNavigatorItem } from '../../components/ui/WorkspaceTaskNavigator';
import type { BomItemDraft } from './productionBomLineModel';

export type ProductionDeskTab = 'bom' | 'workOrders' | 'batches';
export type BatchStatusFilter = 'all' | 'healthy' | 'expiring' | 'expired';
export type AdjustmentStatusFilter = 'all' | 'posted' | 'pending' | 'reversed';
export type WorkOrderFilter = 'all' | ProductionWorkOrderStatus;

export type ProductionAdjustmentTemplate = {
  id: string;
  label: string;
  sign: 1 | -1;
  reason: string;
  reasonCategory: string;
  lossType: string;
  hint: string;
};

export type BomType = 'standard' | 'chemical_formula';
export type BomLifecycleStatus = 'draft' | 'approved' | 'active' | 'retired';
export type StepDraft = { title: string; operatorName: string; note: string };

export const PRODUCTION_DESK_TABS: WorkspaceTaskNavigatorItem<ProductionDeskTab>[] = [
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

export const BOM_TYPE_OPTIONS: Array<{ value: BomType; label: string }> = [
  { value: 'standard', label: '标准BOM' },
  { value: 'chemical_formula', label: '化工配方' },
];

export const FORMULATION_MODE_OPTIONS = [
  { value: 'fixed', label: '固定单耗' },
  { value: 'percentage', label: '百分比配方' },
];

export const BOM_TYPE_LABELS: Record<BomType, string> = {
  standard: '标准BOM',
  chemical_formula: '化工配方',
};

export const FORMULATION_MODE_LABELS: Record<string, string> = {
  fixed: '固定单耗',
  percentage: '百分比配方',
};

export const CHEMICAL_ROLE_LABELS: Record<string, string> = {
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

export const DOSAGE_MODE_LABELS: Record<string, string> = {
  fixed: '固定单耗',
  percentage: '按百分比',
};

export const TEMPLATES: ProductionAdjustmentTemplate[] = [
  { id: 'production_output', label: '成品入库', sign: 1, reason: '生产完工入库', reasonCategory: 'production_output', lossType: 'inbound', hint: '用于成品入库或补产转入' },
  { id: 'production_loss', label: '损耗报废', sign: -1, reason: '生产损耗、报废或破损', reasonCategory: 'production_loss', lossType: 'scrap', hint: '用于报废、破损、损耗修正' },
  { id: 'production_rework', label: '返工回收', sign: 1, reason: '返工后可用数量回收', reasonCategory: 'production_recovery', lossType: 'rework', hint: '用于返工回收与再入库' },
  { id: 'inventory_shortage', label: '盘点短少', sign: -1, reason: '盘点发现短少差异', reasonCategory: 'inventory_discrepancy', lossType: 'count_difference', hint: '用于盘点短少或差异修正' },
  { id: 'inventory_surplus', label: '盘点盈余', sign: 1, reason: '盘点发现盈余差异', reasonCategory: 'inventory_discrepancy', lossType: 'count_difference', hint: '用于盘点盈余或补录' },
];

export const newBomItem = (): BomItemDraft => ({
  materialId: null,
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

export const newBomItems = (count = 3): BomItemDraft[] =>
  Array.from({ length: count }, () => newBomItem());

export const newStep = (title = ''): StepDraft => ({ title, operatorName: '', note: '' });
export const createInitialWorkOrderSteps = () => [newStep('备料'), newStep('生产'), newStep('质检')];

export const WO_LABELS: Record<ProductionWorkOrderStatus, string> = {
  draft: '草稿',
  planned: '已排产',
  in_progress: '生产中',
  qc_pending: '待质检',
  completed: '已完成',
  cancelled: '已取消',
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

export const getStepStatusLabel = (status?: string | null) => {
  if (!status) return '待处理';
  const normalized = String(status).trim().toLowerCase().replace(/-/g, '_');
  return STEP_STATUS_LABELS[normalized] || status;
};

export const QC_RESULT_LABELS: Record<'pass' | 'fail' | 'pending', string> = {
  pending: '待定',
  pass: '合格',
  fail: '不合格',
};

export const formatDate = (value?: string | Date | null) => {
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

export const formatDateOnly = (value?: string | Date | null) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('zh-CN');
};

export const BOM_STATUS_OPTIONS: Array<{ value: BomLifecycleStatus; label: string }> = [
  { value: 'draft', label: '草稿' },
  { value: 'approved', label: '已审批' },
  { value: 'active', label: '生效中' },
  { value: 'retired', label: '已停用' },
];

export const BOM_STATUS_LABELS: Record<BomLifecycleStatus, string> = {
  draft: '草稿',
  approved: '已审批',
  active: '生效中',
  retired: '已停用',
};

export const getJsonSummary = (value?: string | null, key = 'summary') => {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed[key] === 'string') return parsed[key];
  } catch {
    return value;
  }
  return '';
};
