import { BadgeCheck, Clock3, Filter, Plus, RefreshCcw, Search } from 'lucide-react';
import { Dispatch, SetStateAction } from 'react';
import { ProductionQualityCheck, ProductionStep, ProductionWorkOrder, ProductionWorkOrderStatus } from '../../services/production.service';
import {
  formatDate,
  getStepStatusLabel,
  newStep,
  type StepDraft,
  type WorkOrderFilter,
} from './productionWorkspaceConfig';
import {
  Field,
  MiniTag,
  OrderActionButtons,
  SectionHeader,
  Td,
  TextareaField,
  Th,
  WorkOrderStatusBadge,
} from './ProductionWorkspacePrimitives';
import { ProductionQualityInspectionPanel } from './ProductionQualityInspectionPanel';
import type { QualityFormErrors } from './productionWorkspaceSave';

type WorkOrderFormErrors = Partial<Record<'productName' | 'targetQuantity', string>>;

interface ProductionWorkOrderSectionProps {
  woProductName: string;
  setWoProductName: (value: string) => void;
  woTargetQuantity: string;
  setWoTargetQuantity: (value: string) => void;
  woProducedQuantity: string;
  setWoProducedQuantity: (value: string) => void;
  woLossQuantity: string;
  setWoLossQuantity: (value: string) => void;
  woPlannedStartAt: string;
  setWoPlannedStartAt: (value: string) => void;
  woPlannedEndAt: string;
  setWoPlannedEndAt: (value: string) => void;
  woNote: string;
  setWoNote: (value: string) => void;
  woSteps: StepDraft[];
  setWoSteps: Dispatch<SetStateAction<StepDraft[]>>;
  loading: boolean;
  workOrderSaving: boolean;
  workOrderFormErrors: WorkOrderFormErrors;
  clearWorkOrderFormError: (field: keyof WorkOrderFormErrors) => void;
  handleCreateWorkOrder: () => void;
  loadData: () => Promise<void>;
  workOrders: ProductionWorkOrder[];
  workOrderKeyword: string;
  setWorkOrderKeyword: (value: string) => void;
  workOrderFilter: WorkOrderFilter;
  setWorkOrderFilter: (value: WorkOrderFilter) => void;
  selectedWorkOrderId: number | null;
  setSelectedWorkOrderId: (value: number) => void;
  handleWorkOrderStatus: (workOrderIdOrStatus: number | ProductionWorkOrderStatus, maybeStatus?: ProductionWorkOrderStatus) => Promise<void>;
  selectedWorkOrder: ProductionWorkOrder | null;
  selectedChecks: ProductionQualityCheck[];
  handleStepAction: (step: ProductionStep, status: ProductionStep['status']) => Promise<void>;
  qcSampleNo: string;
  setQcSampleNo: (value: string) => void;
  qcMeasurementValues: Record<number, string>;
  setQcMeasurementValue: (characteristicId: number, value: string) => void;
  qcInstrumentNumbers: Record<number, string>;
  setQcInstrumentNumber: (characteristicId: number, value: string) => void;
  qcNote: string;
  setQcNote: (value: string) => void;
  qcReviewNote: string;
  setQcReviewNote: (value: string) => void;
  qualitySaving: boolean;
  qualityFormErrors: QualityFormErrors;
  clearQualityFormError: (field: keyof QualityFormErrors) => void;
  handleCreateQc: () => void;
  handleReviewQc: (checkId: number, decision: 'release' | 'reject') => void;
}

export function ProductionWorkOrderSection({
  woProductName,
  setWoProductName,
  woTargetQuantity,
  setWoTargetQuantity,
  woProducedQuantity,
  setWoProducedQuantity,
  woLossQuantity,
  setWoLossQuantity,
  woPlannedStartAt,
  setWoPlannedStartAt,
  woPlannedEndAt,
  setWoPlannedEndAt,
  woNote,
  setWoNote,
  woSteps,
  setWoSteps,
  loading,
  workOrderSaving,
  workOrderFormErrors,
  clearWorkOrderFormError,
  handleCreateWorkOrder,
  loadData,
  workOrders,
  workOrderKeyword,
  setWorkOrderKeyword,
  workOrderFilter,
  setWorkOrderFilter,
  selectedWorkOrderId,
  setSelectedWorkOrderId,
  handleWorkOrderStatus,
  selectedWorkOrder,
  selectedChecks,
  handleStepAction,
  qcSampleNo,
  setQcSampleNo,
  qcMeasurementValues,
  setQcMeasurementValue,
  qcInstrumentNumbers,
  setQcInstrumentNumber,
  qcNote,
  setQcNote,
  qcReviewNote,
  setQcReviewNote,
  qualitySaving,
  qualityFormErrors,
  clearQualityFormError,
  handleCreateQc,
  handleReviewQc,
}: ProductionWorkOrderSectionProps) {
  return (
    <>
      <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-8">
        <SectionHeader title="工单工作台" subtitle="排产 / 工序 / 质检 / 完工" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Field
            dataTestId="production-work-order-product-name"
            label="产品名称"
            value={woProductName}
            onChange={value => {
              clearWorkOrderFormError('productName');
              setWoProductName(value);
            }}
            placeholder="从 BOM 或批次带入"
            error={workOrderFormErrors.productName}
          />
          <Field
            dataTestId="production-work-order-target-quantity"
            label="目标数量"
            value={woTargetQuantity}
            onChange={value => {
              clearWorkOrderFormError('targetQuantity');
              setWoTargetQuantity(value);
            }}
            placeholder="0"
            error={workOrderFormErrors.targetQuantity}
          />
          <Field label="已产数量" value={woProducedQuantity} onChange={setWoProducedQuantity} placeholder="0" />
          <Field label="损耗数量" value={woLossQuantity} onChange={setWoLossQuantity} placeholder="0" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="计划开始" value={woPlannedStartAt} onChange={setWoPlannedStartAt} placeholder="2026-04-08T09:00" type="datetime-local" />
          <Field label="计划结束" value={woPlannedEndAt} onChange={setWoPlannedEndAt} placeholder="2026-04-08T18:00" type="datetime-local" />
        </div>
        <TextareaField label="工单备注" value={woNote} onChange={setWoNote} placeholder="工单说明、特殊工艺、异常提醒" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">工序步骤</div>
            <button onClick={() => setWoSteps(prev => [...prev, newStep(`工序 ${prev.length + 1}`)])} className="text-xs font-black uppercase tracking-widest text-blue-600 flex items-center gap-1">
              <Plus size={12} /> 添加步骤
            </button>
          </div>
          {woSteps.map((step, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-[24px] border border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-3">
              <Field label="步骤" value={step.title} onChange={value => setWoSteps(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, title: value } : row))} placeholder="备料 / 生产 / 质检" />
              <Field label="负责人" value={step.operatorName} onChange={value => setWoSteps(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, operatorName: value } : row))} placeholder="操作员" />
              <Field label="备注" value={step.note} onChange={value => setWoSteps(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, note: value } : row))} placeholder="工序说明" />
              <div className="flex items-end justify-between gap-2">
                <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">序号 {index + 1}</div>
                {woSteps.length > 1 && <button onClick={() => setWoSteps(prev => prev.filter((_, rowIndex) => rowIndex !== index))} className="text-xs font-black uppercase tracking-widest text-rose-500">删除</button>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <button data-testid="production-work-order-save" onClick={handleCreateWorkOrder} disabled={loading || workOrderSaving} aria-busy={workOrderSaving} className="rounded-[24px] bg-blue-600 px-6 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-blue-500/30 transition-colors duration-150 hover:bg-blue-700 motion-reduce:transition-none disabled:opacity-60">{workOrderSaving ? '保存中...' : '创建工单'}</button>
 <button onClick={() => void loadData()} className="px-6 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 rounded-[24px] font-black text-xs uppercase tracking-widest flex items-center gap-2"><RefreshCcw size={14} />刷新</button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
        <div className="xl:col-span-3 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center"><div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />工单列表</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">
                <Search size={14} className="text-slate-400" />
                <input value={workOrderKeyword} onChange={e => setWorkOrderKeyword(e.target.value)} placeholder="搜索工单" className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200 w-32" />
              </div>
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">
                <Filter size={14} className="text-slate-400" />
                <select value={workOrderFilter} onChange={e => setWorkOrderFilter(e.target.value as WorkOrderFilter)} className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200">
                  <option value="all">全部</option>
                  <option value="draft">草稿</option>
                  <option value="planned">已排产</option>
                  <option value="in_progress">生产中</option>
                  <option value="qc_pending">待质检</option>
                  <option value="completed">已完工</option>
                  <option value="cancelled">已取消</option>
                </select>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100/50 dark:border-slate-800">
                  <Th>工单号</Th><Th>产品</Th><Th>数量</Th><Th>状态</Th><Th>工序</Th><Th>操作</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {workOrders.map(order => (
                  <tr key={order.id} onClick={() => setSelectedWorkOrderId(order.id)} className={`cursor-pointer transition-colors duration-150 motion-reduce:transition-none ${selectedWorkOrderId === order.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-blue-50/20 dark:hover:bg-blue-900/5'}`}>
                    <Td mono>{order.workOrderNo}</Td>
                    <Td><div className="font-bold text-slate-900 dark:text-white text-sm">{order.productName}</div><div className="text-[11px] text-slate-400 mt-1">{order.bom?.bomNo || '未绑定BOM'}</div></Td>
                    <Td>{Number(order.targetQuantity || 0).toLocaleString()}</Td>
                    <Td><WorkOrderStatusBadge status={order.status} /></Td>
                    <Td>{order.steps?.length || 0}</Td>
                    <Td><div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}><OrderActionButtons workOrderId={order.id} status={order.status} onAction={handleWorkOrderStatus} /></div></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:col-span-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
          <SectionHeader title="工单详情" subtitle="工序 / 质检 / 完工控制" />
          {selectedWorkOrder ? (
            <>
              <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-3">
                <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">工单信息</div>
                <div className="text-lg font-black text-slate-900 dark:text-white">{selectedWorkOrder.productName}</div>
                <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{selectedWorkOrder.workOrderNo}</div>
                <div className="text-xs text-slate-400">
                  目标 {selectedWorkOrder.targetQuantity} · 已产 {selectedWorkOrder.producedQuantity} · 损耗 {selectedWorkOrder.lossQuantity}
                </div>
                <div className="flex flex-wrap gap-2">
                  <WorkOrderStatusBadge status={selectedWorkOrder.status} />
                  {selectedWorkOrder.productBatch && <MiniTag label={`批次 ${selectedWorkOrder.productBatch.batchNo}`} />}
                </div>
              </div>

              <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">工序步骤</div>
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
                          <button onClick={() => void handleStepAction(step, 'in_progress')} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest">开始</button>
                        )}
                        {step.status !== 'completed' && (
                          <button onClick={() => void handleStepAction(step, 'completed')} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest">完成</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <ProductionQualityInspectionPanel
                workOrder={selectedWorkOrder}
                checks={selectedChecks}
                sampleNo={qcSampleNo}
                setSampleNo={value => { clearQualityFormError('sampleNo'); setQcSampleNo(value); }}
                measurementValues={qcMeasurementValues}
                setMeasurementValue={(id, value) => { clearQualityFormError('measurements'); setQcMeasurementValue(id, value); }}
                instrumentNumbers={qcInstrumentNumbers}
                setInstrumentNumber={setQcInstrumentNumber}
                note={qcNote}
                setNote={setQcNote}
                reviewNote={qcReviewNote}
                setReviewNote={setQcReviewNote}
                saving={qualitySaving}
                errors={qualityFormErrors}
                onSubmit={handleCreateQc}
                onReview={handleReviewQc}
                onMarkQcPending={() => void handleWorkOrderStatus('qc_pending')}
                onComplete={() => void handleWorkOrderStatus('completed')}
              />
            </>
          ) : (
            <div className="rounded-[28px] border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-slate-400 font-bold">暂无可查看工单</div>
          )}
        </div>
      </div>
    </>
  );
}
