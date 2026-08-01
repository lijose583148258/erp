import { Plus } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { InboundFormErrors, InboundFormState, WarehouseLocationOption } from './warehouseWorkspaceTypes';
import { MaterialMasterCombobox } from '../../components/materials/MaterialMasterCombobox';

const INBOUND_REASON_OPTIONS = [
  { value: '', label: '-- 选择补录原因 --' },
  { value: 'inventory_surplus', label: '盘点盘盈' },
  { value: 'emergency_recovery', label: '应急补录' },
  { value: 'legacy_opening', label: '历史初始补录' },
  { value: 'quality_release', label: '质检释放补录' },
];

interface WarehouseInboundPanelProps {
  allLocations: WarehouseLocationOption[];
  inboundForm: InboundFormState;
  setInboundForm: Dispatch<SetStateAction<InboundFormState>>;
  inboundErrors: InboundFormErrors;
  clearInboundError: (field: keyof InboundFormErrors) => void;
  inboundMsg: string;
  inboundSaving: boolean;
  handleInbound: () => void;
  canWrite: boolean;
}

export function WarehouseInboundPanel({
  allLocations,
  inboundForm,
  setInboundForm,
  inboundErrors,
  clearInboundError,
  inboundMsg,
  inboundSaving,
  handleInbound,
  canWrite,
}: WarehouseInboundPanelProps) {
  const controlClassName = (hasError: boolean) =>
    `w-full bg-white dark:bg-slate-800 border rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all ${
      hasError
        ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/20'
        : 'border-slate-200 dark:border-slate-700'
    }`;
  const inboundMsgClassName = `text-sm font-bold px-4 py-3 rounded-xl border ${
    inboundMsg.startsWith('✓')
      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 border-emerald-200 dark:border-emerald-800'
      : inboundMsg.includes('处理中')
        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 border-blue-200 dark:border-blue-800'
        : 'bg-red-50 dark:bg-red-900/30 text-red-600 border-red-200 dark:border-red-800'
  }`;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[24px] p-8 border border-white/40 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-[14px] flex items-center justify-center shadow-lg">
            <Plus size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-black text-lg text-slate-900 dark:text-white">应急补录 / 盘盈入库</h3>
            <p className="text-xs text-slate-400">仅处理盘盈或临时应急补录，不承接业务来源收货。</p>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
          本入口不能代替采购收货、生产入库、货抵入库；这些业务来源必须回到对应模块生成入库记录。应急补录必须提供来源单号和明确原因，提交后会写入库存流水。
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { title: '主档依赖', text: '先选已存在的仓库 / 库位，不能在补录表单里临时造库位。' },
            { title: '必填证据', text: '来源单号和明确原因用于生成可回查的 warehouse_manual_inbound 流水。' },
            { title: '保存回读', text: '提交成功后刷新库存余额，并预置库存流水筛选条件。' },
          ].map(item => (
            <div key={item.title} className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-900/20">
              <p className="text-[11px] font-black tracking-[0.16em] text-emerald-600 dark:text-emerald-300">{item.title}</p>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-600 dark:text-slate-200">{item.text}</p>
            </div>
          ))}
        </div>

        {!canWrite && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
            当前角色只能查看库存，不能执行应急补录 / 盘盈入库。
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">补录库位 *</label>
            <select
              data-testid="warehouse-inbound-location-select"
              value={inboundForm.locationId}
              onChange={e => {
                clearInboundError('locationId');
                setInboundForm(form => ({ ...form, locationId: Number(e.target.value) }));
              }}
              aria-invalid={Boolean(inboundErrors.locationId)}
              aria-describedby={inboundErrors.locationId ? 'warehouse-inbound-location-error' : undefined}
              className={controlClassName(Boolean(inboundErrors.locationId))}
            >
              <option value={0}>-- 选择补录库位 --</option>
              {allLocations.map(location => (
                <option key={location.id} value={location.id}>{location.warehouseName} / {location.name} ({location.code})</option>
              ))}
            </select>
            {inboundErrors.locationId ? <p id="warehouse-inbound-location-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{inboundErrors.locationId}</p> : null}
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">统一物料 *</label>
            <MaterialMasterCombobox
              dataTestId="warehouse-inbound-product-input"
              value={inboundForm.productName}
              selectedMaterialId={inboundForm.materialId || null}
              error={inboundErrors.materialId || inboundErrors.productName}
              onTextChange={(value) => {
                clearInboundError('materialId');
                clearInboundError('productName');
                setInboundForm(form => ({ ...form, materialId: 0, productName: value }));
              }}
              onClearSelection={() => setInboundForm(form => ({ ...form, materialId: 0 }))}
              onSelect={(material) => {
                clearInboundError('materialId');
                clearInboundError('productName');
                setInboundForm(form => ({
                  ...form,
                  materialId: material.id,
                  productName: material.nameZh,
                  unit: material.baseUnit,
                }));
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">批次号 *</label>
            <input data-testid="warehouse-inbound-batch-input" type="text" placeholder="如：BATCH-2026-001" value={inboundForm.batchNo}
              onChange={e => {
                clearInboundError('batchNo');
                setInboundForm(form => ({ ...form, batchNo: e.target.value }));
              }}
              aria-invalid={Boolean(inboundErrors.batchNo)}
              aria-describedby={inboundErrors.batchNo ? 'warehouse-inbound-batch-error' : undefined}
              className={controlClassName(Boolean(inboundErrors.batchNo))} />
            {inboundErrors.batchNo ? <p id="warehouse-inbound-batch-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{inboundErrors.batchNo}</p> : null}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">补录数量 *</label>
              <input data-testid="warehouse-inbound-quantity-input" type="number" min={0} step={0.01} value={inboundForm.quantity || ''}
                onChange={e => {
                  clearInboundError('quantity');
                  setInboundForm(form => ({ ...form, quantity: Number(e.target.value) }));
                }}
                aria-invalid={Boolean(inboundErrors.quantity)}
                aria-describedby={inboundErrors.quantity ? 'warehouse-inbound-quantity-error' : undefined}
                className={controlClassName(Boolean(inboundErrors.quantity))} />
              {inboundErrors.quantity ? <p id="warehouse-inbound-quantity-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{inboundErrors.quantity}</p> : null}
            </div>
            <div className="w-24">
              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">单位</label>
              <select data-testid="warehouse-inbound-unit-select" value={inboundForm.unit} onChange={e => setInboundForm(form => ({ ...form, unit: e.target.value }))}
                disabled={Boolean(inboundForm.materialId)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all">
                {['kg', 'L', '桶', '瓶', '个', '吨'].map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">来源单号 *</label>
            <input
              data-testid="warehouse-inbound-source-ref-input"
              type="text"
              placeholder="如：COUNT-2026-04-001"
              value={inboundForm.sourceRef}
              onChange={e => {
                clearInboundError('sourceRef');
                setInboundForm(form => ({ ...form, sourceRef: e.target.value }));
              }}
              aria-invalid={Boolean(inboundErrors.sourceRef)}
              aria-describedby={inboundErrors.sourceRef ? 'warehouse-inbound-source-ref-error' : undefined}
              className={controlClassName(Boolean(inboundErrors.sourceRef))}
            />
            {inboundErrors.sourceRef ? <p id="warehouse-inbound-source-ref-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{inboundErrors.sourceRef}</p> : null}
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">明确原因 *</label>
            <select
              data-testid="warehouse-inbound-reason-select"
              value={inboundForm.reason}
              onChange={e => {
                clearInboundError('reason');
                setInboundForm(form => ({ ...form, reason: e.target.value }));
              }}
              aria-invalid={Boolean(inboundErrors.reason)}
              aria-describedby={inboundErrors.reason ? 'warehouse-inbound-reason-error' : undefined}
              className={controlClassName(Boolean(inboundErrors.reason))}
            >
              {INBOUND_REASON_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {inboundErrors.reason ? <p id="warehouse-inbound-reason-error" className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{inboundErrors.reason}</p> : null}
          </div>
        </div>

        <div>
          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">备注</label>
          <textarea
            data-testid="warehouse-inbound-note-input"
            rows={3}
            placeholder="记录盘点人、审批口径或应急背景，便于后续追溯"
            value={inboundForm.note}
            onChange={e => setInboundForm(form => ({ ...form, note: e.target.value }))}
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
          />
        </div>

        {inboundMsg && (
          <div data-testid="warehouse-inbound-message" className={inboundMsgClassName}>
            {inboundMsg}
          </div>
        )}

        <button data-testid="warehouse-inbound-confirm-button" onClick={handleInbound} disabled={inboundSaving || !canWrite}
          className={`w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-emerald-500/30 hover:shadow-xl active:scale-[0.98] transition-all ${inboundSaving ? 'opacity-70 cursor-not-allowed' : ''}`}>
          {inboundSaving ? '应急补录 / 盘盈入库处理中...' : '确认应急补录 / 盘盈入库'}
        </button>
      </div>
    </div>
  );
}
