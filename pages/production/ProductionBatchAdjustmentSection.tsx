import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import { ArrowUpRight, Filter, Search, ShieldAlert, Undo2 } from 'lucide-react';
import { ProductBatch } from '../../services/asset.service';
import { AdjustmentRecord } from '../../services/adjustment.service';
import { ProductionDisposition } from '../../services/production.service';
import { StockBalanceRecord, WarehouseLocation } from '../../services/warehouse.service';
import { ProductionBatchGenealogy } from './ProductionBatchGenealogy';
import {
  TEMPLATES,
  formatDate,
  formatDateOnly,
  type AdjustmentStatusFilter,
  type BatchStatusFilter,
  type ProductionAdjustmentTemplate,
} from './productionWorkspaceConfig';
import {
  AdjustmentBadge,
  BatchBadge,
  Field,
  SectionHeader,
  Td,
  TextareaField,
  Th,
} from './ProductionWorkspacePrimitives';

interface BatchTraceNode {
  label: string;
  time: Date;
  place: string;
  status: string;
}

type AdjustmentFormErrors = Partial<Record<'batch' | 'quantity' | 'reason', string>>;

const QUALITY_STATUS_LABELS: Record<NonNullable<ProductBatch['qualityStatus']>, string> = {
  not_required: '无需质检',
  pending_qc: '待质检',
  hold: '待判定',
  released: '已放行',
  quarantined: '已隔离',
};

interface ProductionBatchAdjustmentSectionProps {
  batches: ProductBatch[];
  batchKeyword: string;
  setBatchKeyword: (value: string) => void;
  batchStatus: BatchStatusFilter;
  setBatchStatus: (value: BatchStatusFilter) => void;
  selectedBatchId: number | null;
  setSelectedBatchId: (value: number) => void;
  selectedBatch: ProductBatch | null;
  batchTrace: BatchTraceNode[];
  selectedTemplate: ProductionAdjustmentTemplate;
  templateId: string;
  setTemplateId: (value: string) => void;
  setAdjustmentReason: (value: string) => void;
  adjustmentQuantity: string;
  setAdjustmentQuantity: (value: string) => void;
  adjustmentReason: string;
  adjustmentNote: string;
  setAdjustmentNote: (value: string) => void;
  adjustmentSaving: boolean;
  completedWorkOrderNo: string | null;
  stockBalances: StockBalanceRecord[];
  selectedStockBalanceId: number | null;
  setSelectedStockBalanceId: (value: number | null) => void;
  dispositions: ProductionDisposition[];
  sourceDispositionId: number | null;
  setSourceDispositionId: (value: number | null) => void;
  destinationLocations: WarehouseLocation[];
  destinationLocationId: number | null;
  setDestinationLocationId: (value: number | null) => void;
  adjustmentFormErrors: AdjustmentFormErrors;
  clearAdjustmentFormError: (field: keyof AdjustmentFormErrors) => void;
  handleCreateAdjustment: () => void;
  adjustments: AdjustmentRecord[];
  adjustmentStatus: AdjustmentStatusFilter;
  setAdjustmentStatus: (value: AdjustmentStatusFilter) => void;
  handleReverseAdjustment: (record: AdjustmentRecord) => void;
}

export function ProductionBatchAdjustmentSection({
  batches,
  batchKeyword,
  setBatchKeyword,
  batchStatus,
  setBatchStatus,
  selectedBatchId,
  setSelectedBatchId,
  selectedBatch,
  batchTrace,
  selectedTemplate,
  templateId,
  setTemplateId,
  setAdjustmentReason,
  adjustmentQuantity,
  setAdjustmentQuantity,
  adjustmentReason,
  adjustmentNote,
  setAdjustmentNote,
  adjustmentSaving,
  completedWorkOrderNo,
  stockBalances,
  selectedStockBalanceId,
  setSelectedStockBalanceId,
  dispositions,
  sourceDispositionId,
  setSourceDispositionId,
  destinationLocations,
  destinationLocationId,
  setDestinationLocationId,
  adjustmentFormErrors,
  clearAdjustmentFormError,
  handleCreateAdjustment,
  adjustments,
  adjustmentStatus,
  setAdjustmentStatus,
  handleReverseAdjustment,
}: ProductionBatchAdjustmentSectionProps) {
  const { currentUser } = useAppContext();
  const canExecute = can(currentUser, 'production.execute');
  return (
    <>
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
                <input data-testid="production-batch-search-input" value={batchKeyword} onChange={e => setBatchKeyword(e.target.value)} placeholder="搜索批次" className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200 w-32" />
              </div>
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">
                <Filter size={14} className="text-slate-400" />
                <select data-testid="production-batch-status-filter" value={batchStatus} onChange={e => setBatchStatus(e.target.value as BatchStatusFilter)} className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200">
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
                  <Th>质量状态</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {batches.map(batch => (
                  <tr
                    key={batch.id}
                    data-testid={`production-batch-row-${batch.id}`}
                    onClick={() => setSelectedBatchId(batch.id)}
                    className={`cursor-pointer transition-colors duration-150 motion-reduce:transition-none ${selectedBatchId === batch.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-blue-50/20 dark:hover:bg-blue-900/5'}`}
                  >
                    <Td mono>{batch.batchNo}</Td>
                    <Td strong>{batch.productName}</Td>
                    <Td>{formatDateOnly(batch.productionDate)} / {formatDateOnly(batch.expiryDate)}</Td>
                    <Td>{batch.stockQuantity} {batch.unit}</Td>
                    <Td><BatchBadge status={batch.status} /></Td>
                    <Td>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${batch.qualityStatus === 'released' || batch.qualityStatus === 'not_required' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : batch.qualityStatus === 'quarantined' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-200' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'}`}>
                        {QUALITY_STATUS_LABELS[batch.qualityStatus || 'not_required']}
                      </span>
                    </Td>
                    <Td><button onClick={e => { e.stopPropagation(); setSelectedBatchId(batch.id); }} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest">选中</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:col-span-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
          <SectionHeader title="批次追踪" subtitle="入库 / 效期 / 温控 / 盘点" />
          <div className="rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <p className="text-xs font-bold leading-6">
                批次区只做追踪和已形成库存事实后的异常调整。正常 BOM、工单完工、采购入库不要在这里补录；提交异常后会进入调账台账，后续可审计和冲销。
              </p>
            </div>
          </div>
          {selectedBatch ? (
            <>
              <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-3">
                <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">批次信息</div>
                <div className="text-lg font-black text-slate-900 dark:text-white">{selectedBatch.batchNo}</div>
                <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{selectedBatch.productName}</div>
                <div className="text-xs text-slate-400">库存 {selectedBatch.stockQuantity} {selectedBatch.unit} · 冷链 {selectedBatch.isColdChain ? '是' : '否'}</div>
              </div>
              <ProductionBatchGenealogy key={selectedBatch.id} batchId={selectedBatch.id} />
              <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5">
                <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400 mb-4">追踪节点</div>
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
              {canExecute && <div data-testid="production-disposition-panel" className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">批次异常调整（现场入口）</div>
                  <div className="text-[11px] font-black text-slate-500">{selectedTemplate.label}</div>
                </div>
                <p className="rounded-[18px] bg-blue-50 px-4 py-3 text-xs font-bold leading-6 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
                  已完工工单：{completedWorkOrderNo || '未找到'}。报废和返工只能通过受控处置凭证；历史通用调账不再用于制造损耗。
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {TEMPLATES.map(template => (
                    <button data-testid={`production-disposition-template-${template.id}`} key={template.id} onClick={() => { setTemplateId(template.id); setAdjustmentReason(template.reason); clearAdjustmentFormError('reason'); }} className={`text-left p-4 rounded-[24px] border transition-colors duration-150 motion-reduce:transition-none ${templateId === template.id ? 'bg-blue-600 text-white border-blue-500 shadow-xl shadow-blue-500/20' : 'bg-white/80 dark:bg-slate-900/80 border-white/60 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-200 dark:hover:border-blue-900'}`}>
                      <div className="text-xs font-black uppercase tracking-widest">{template.label}</div>
                      <div className="mt-2 text-[11px] opacity-75">{template.hint}</div>
                    </button>
                  ))}
                </div>
                {adjustmentFormErrors.batch ? (
                  <div data-testid="production-adjustment-batch-error" className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {adjustmentFormErrors.batch}
                  </div>
                ) : null}
                {!completedWorkOrderNo ? (
                  <div data-testid="production-disposition-work-order-error" className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                    此批次没有已完工来源工单，不能登记生产损耗或返工回收。
                  </div>
                ) : null}
                {selectedTemplate.id === 'production_loss' ? (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-black text-slate-600 dark:text-slate-200">实际扣减库位</span>
                    <select data-testid="production-disposition-stock-balance" value={selectedStockBalanceId ?? ''} onChange={event => setSelectedStockBalanceId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800">
                      <option value="">选择实际库存余额</option>
                      {stockBalances.map(stock => <option key={stock.id} value={stock.id}>{stock.warehouseName || '仓库'} / {stock.locationName || stock.locationId} · {stock.quantity} {stock.unit}</option>)}
                    </select>
                  </label>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-black text-slate-600 dark:text-slate-200">来源报废凭证</span>
                      <select data-testid="production-disposition-source-scrap" value={sourceDispositionId ?? ''} onChange={event => setSourceDispositionId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800">
                        <option value="">选择仍可回收的报废记录</option>
                        {dispositions.filter(item => item.dispositionType === 'scrap' && item.quantity - item.reworkedQuantity > 0.000001).map(item => <option key={item.id} value={item.id}>{item.dispositionNo} · 可回收 {item.quantity - item.reworkedQuantity} {item.unit}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-black text-slate-600 dark:text-slate-200">返工入库库位</span>
                      <select data-testid="production-disposition-destination-location" value={destinationLocationId ?? ''} onChange={event => setDestinationLocationId(event.target.value ? Number(event.target.value) : null)} className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800">
                        <option value="">选择实际入库库位</option>
                        {destinationLocations.map(location => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field
                    dataTestId="production-adjustment-quantity-input"
                    label="数量"
                    value={adjustmentQuantity}
                    onChange={value => {
                      clearAdjustmentFormError('quantity');
                      setAdjustmentQuantity(value);
                    }}
                    placeholder="例如 12"
                    error={adjustmentFormErrors.quantity}
                  />
                  <Field dataTestId="production-adjustment-direction-input" label="方向" value={selectedTemplate.sign > 0 ? '入库增加' : '库存减少'} onChange={() => undefined} placeholder="" readOnly />
                </div>
                <Field
                  dataTestId="production-adjustment-reason-input"
                  label="原因"
                  value={adjustmentReason}
                  onChange={value => {
                    clearAdjustmentFormError('reason');
                    setAdjustmentReason(value);
                  }}
                  placeholder="调账原因"
                  error={adjustmentFormErrors.reason}
                />
                <TextareaField dataTestId="production-adjustment-note-input" label="备注" value={adjustmentNote} onChange={setAdjustmentNote} placeholder="可填损耗原因、工艺说明或盘点备注" />
                <button data-testid="production-adjustment-save" onClick={handleCreateAdjustment} disabled={adjustmentSaving || !completedWorkOrderNo} aria-busy={adjustmentSaving} className="px-5 py-3 rounded-2xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest disabled:opacity-60">{adjustmentSaving ? '保存中...' : selectedTemplate.id === 'production_loss' ? '过账报废损耗' : '过账返工回收'}</button>
              </div>}
            </>
          ) : (
            <div className="rounded-[28px] border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-slate-400 font-bold">暂无可查看批次</div>
          )}
        </div>
      </div>

      <div className="mt-8 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center"><div className="w-2 h-8 bg-emerald-600 rounded-full mr-4" />受控损耗 / 返工凭证</h2>
          <div className="text-xs font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full tracking-widest uppercase">{dispositions.length} 条</div>
        </div>
        <div className="overflow-x-auto no-scrollbar"><table className="w-full text-left"><thead><tr className="border-b border-slate-100/50 dark:border-slate-800"><Th>凭证</Th><Th>类型</Th><Th>数量 / 成本</Th><Th>库位 / QA</Th><Th>来源</Th></tr></thead><tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {dispositions.map(record => <tr key={record.id}><Td mono>{record.dispositionNo}</Td><Td strong>{record.dispositionType === 'scrap' ? '报废损耗' : '返工回收'}</Td><Td>{record.quantity} {record.unit}<div className="text-[11px] text-slate-400 mt-1">成本 {record.costAmount}</div></Td><Td>{record.locationCode || record.locationName || '—'}<div className="text-[11px] text-slate-400 mt-1">{record.qualityStatus === 'quarantined' ? '返工待 QA 放行' : '已扣减'}</div></Td><Td>{record.sourceDispositionId ? `来源报废 #${record.sourceDispositionId}` : `已回收 ${record.reworkedQuantity}`}</Td></tr>)}
          {dispositions.length === 0 ? <tr><td colSpan={5} className="px-4 py-5 text-sm text-slate-500">暂无受控损耗或返工凭证</td></tr> : null}
        </tbody></table></div>
      </div>

      <div className="mt-8 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center">
            <div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />
            历史通用调账（与制造损耗分离）
          </h2>
          <div className="text-xs font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full tracking-widest uppercase">{adjustments.length} 条</div>
        </div>
        <div className="mb-6 flex flex-wrap gap-2">
          {(['all', 'posted', 'pending', 'reversed'] as AdjustmentStatusFilter[]).map(status => (
            <button key={status} onClick={() => setAdjustmentStatus(status)} className={`px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest border transition-colors duration-150 motion-reduce:transition-none ${adjustmentStatus === status ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/20' : 'bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300'}`}>
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
                <tr key={record.id} data-testid={`production-adjustment-row-${record.id}`} className="transition-colors duration-150 hover:bg-blue-50/20 motion-reduce:transition-none dark:hover:bg-blue-900/5">
                  <Td mono>{record.adjustmentNo}</Td>
                  <Td>
                    <div className="font-bold text-slate-900 dark:text-white text-sm">{record.batchNo || ''}</div>
                    <div className="text-[11px] text-slate-400 mt-1">{record.productName || ''}</div>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest border ${Number(record.quantityDelta || 0) >= 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800' : 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-900/20 dark:border-rose-800'}`}>
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
                    {can(currentUser, 'adjustments.reverse') && <button data-testid="production-adjustment-reverse-button" onClick={() => handleReverseAdjustment(record)} disabled={record.status !== 'posted'} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"><Undo2 size={12} className="inline mr-1" />冲销</button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
