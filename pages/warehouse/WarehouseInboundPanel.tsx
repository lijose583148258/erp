import { Plus } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { InboundFormState, WarehouseLocationOption } from './warehouseWorkspaceTypes';

interface WarehouseInboundPanelProps {
  allLocations: WarehouseLocationOption[];
  inboundForm: InboundFormState;
  setInboundForm: Dispatch<SetStateAction<InboundFormState>>;
  inboundMsg: string;
  inboundSaving: boolean;
  handleInbound: () => void;
}

export function WarehouseInboundPanel({
  allLocations,
  inboundForm,
  setInboundForm,
  inboundMsg,
  inboundSaving,
  handleInbound,
}: WarehouseInboundPanelProps) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-[24px] p-8 border border-white/40 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-[14px] flex items-center justify-center shadow-lg">
            <Plus size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-black text-lg text-slate-900 dark:text-white">手动入库</h3>
            <p className="text-xs text-slate-400">将原料或成品录入指定库位</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">入库库位 *</label>
            <select data-testid="warehouse-inbound-location-select" value={inboundForm.locationId} onChange={e => setInboundForm(form => ({ ...form, locationId: Number(e.target.value) }))}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all">
              <option value={0}>-- 选择库位 --</option>
              {allLocations.map(location => (
                <option key={location.id} value={location.id}>{location.warehouseName} / {location.name} ({location.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">产品名称 *</label>
            <input data-testid="warehouse-inbound-product-input" type="text" placeholder="如: 丁酮 (MEK)" value={inboundForm.productName}
              onChange={e => setInboundForm(form => ({ ...form, productName: e.target.value }))}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">批次号 *</label>
            <input data-testid="warehouse-inbound-batch-input" type="text" placeholder="如: BATCH-2026-001" value={inboundForm.batchNo}
              onChange={e => setInboundForm(form => ({ ...form, batchNo: e.target.value }))}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">数量 *</label>
              <input data-testid="warehouse-inbound-quantity-input" type="number" min={0} step={0.01} value={inboundForm.quantity || ''}
                onChange={e => setInboundForm(form => ({ ...form, quantity: Number(e.target.value) }))}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
            </div>
            <div className="w-24">
              <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">单位</label>
              <select data-testid="warehouse-inbound-unit-select" value={inboundForm.unit} onChange={e => setInboundForm(form => ({ ...form, unit: e.target.value }))}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all">
                {['kg', 'L', '桶', '瓶', '个', '吨'].map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
          </div>
        </div>

        {inboundMsg && (
          <div data-testid="warehouse-inbound-message" className={`text-sm font-bold px-4 py-3 rounded-xl border ${inboundMsg.startsWith('✅') ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 border-emerald-200 dark:border-emerald-800' : inboundMsg.includes('处理中') ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 border-blue-200 dark:border-blue-800' : 'bg-red-50 dark:bg-red-900/30 text-red-600 border-red-200 dark:border-red-800'}`}>
            {inboundMsg}
          </div>
        )}

        <button data-testid="warehouse-inbound-confirm-button" onClick={handleInbound} disabled={inboundSaving}
          className={`w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-emerald-500/30 hover:shadow-xl active:scale-[0.98] transition-all ${inboundSaving ? 'opacity-70 cursor-not-allowed' : ''}`}>
          {inboundSaving ? '入库处理中...' : '确认入库'}
        </button>
      </div>
    </div>
  );
}
