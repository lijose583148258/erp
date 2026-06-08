import React from 'react';
import { AlertTriangle, Layers3, PencilLine, Sparkles } from 'lucide-react';
import type { AdjustmentFormState, AdjustmentTemplate } from './adjustment.constants';
import type {
  AdjustmentDomain,
  AdjustmentStatus,
  AdjustmentTargetType,
} from '../../services/adjustment.service';

interface AdjustmentFormProps {
  form: AdjustmentFormState;
  setForm: React.Dispatch<React.SetStateAction<AdjustmentFormState>>;
  templates: readonly AdjustmentTemplate[];
  onCreate: () => void;
  onReset: () => void;
}

const AdjustmentFormClean = ({ form, setForm, templates, onCreate, onReset }: AdjustmentFormProps) => {
  return (
    <div data-testid="adjustment-create-form" className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">
            新建异常调账
          </h3>
          <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            跨域补偿、冲销、历史修正
          </p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-500 dark:bg-slate-800">
          <PencilLine size={18} />
        </div>
      </div>

      <div className="mt-5 rounded-[26px] border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="text-xs font-black tracking-[0.16em]">先判断入口，再登记</div>
            <p className="mt-2 text-xs font-bold leading-6">
              日常回款核销去“回款中心”，生产完工扣料去“生产工单”，仓库正常入库去“仓储/采购/生产来源单”。本页只做已确认异常、跨域补偿和可冲销审计记录。
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {templates.map((tpl) => {
          const Icon = tpl.icon;
          return (
            <button
              key={tpl.id}
              onClick={() => setForm((prev) => ({ ...prev, ...tpl.patch }))}
              className="rounded-[18px] border border-slate-100 bg-slate-50 p-3 text-left hover:border-blue-200 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-blue-800"
            >
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <Icon size={12} />
                {tpl.label}
              </div>
              <div className="mt-2 text-[10px] leading-5 text-slate-400">{tpl.helperText}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <select
          data-testid="adjustment-domain"
          value={form.domain}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              domain: e.target.value as AdjustmentDomain,
              targetType: e.target.value === 'finance' ? 'order' : 'productBatch',
            }))
          }
          className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="finance">财务</option>
          <option value="production">生产</option>
          <option value="inventory">库存</option>
        </select>
        <select
          data-testid="adjustment-status"
          value={form.status}
          onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as AdjustmentStatus }))}
          className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="posted">直接生效（仅授权）</option>
          <option value="pending">先登记（推荐）</option>
        </select>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <select
          data-testid="adjustment-target-type"
          value={form.targetType}
          onChange={(e) => setForm((prev) => ({ ...prev, targetType: e.target.value as AdjustmentTargetType }))}
          className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="order">订单</option>
          <option value="productBatch">批次</option>
          <option value="manual">手工</option>
        </select>
        <input
          data-testid="adjustment-target-ref"
          value={form.targetRef}
          onChange={(e) => setForm((prev) => ({ ...prev, targetRef: e.target.value }))}
          placeholder="对象参考号"
          className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          data-testid="adjustment-order-id"
          value={form.orderId}
          onChange={(e) => setForm((prev) => ({ ...prev, orderId: e.target.value }))}
          placeholder="订单ID"
          className={`rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800 ${
            form.domain !== 'finance' ? 'opacity-60' : ''
          }`}
        />
        <input
          data-testid="adjustment-batch-id"
          value={form.batchId}
          onChange={(e) => setForm((prev) => ({ ...prev, batchId: e.target.value }))}
          placeholder="批次ID"
          className={`rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800 ${
            form.domain === 'finance' ? 'opacity-60' : ''
          }`}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          data-testid="adjustment-amount-delta"
          value={form.amountDelta}
          onChange={(e) => setForm((prev) => ({ ...prev, amountDelta: e.target.value }))}
          placeholder="金额变动"
          className={`rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800 ${
            form.domain !== 'finance' ? 'opacity-60' : ''
          }`}
        />
        <input
          data-testid="adjustment-quantity-delta"
          value={form.quantityDelta}
          onChange={(e) => setForm((prev) => ({ ...prev, quantityDelta: e.target.value }))}
          placeholder="数量变动"
          className={`rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800 ${
            form.domain === 'finance' ? 'opacity-60' : ''
          }`}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          data-testid="adjustment-reason-category"
          value={form.reasonCategory}
          onChange={(e) => setForm((prev) => ({ ...prev, reasonCategory: e.target.value }))}
          placeholder="原因分类"
          className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
        />
        <input
          data-testid="adjustment-loss-type"
          value={form.lossType}
          onChange={(e) => setForm((prev) => ({ ...prev, lossType: e.target.value }))}
          placeholder="损耗类型"
          className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <textarea
        data-testid="adjustment-reason"
        value={form.reason}
        onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
        placeholder="调账原因"
        rows={3}
        className="mt-2 w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
      />
      <textarea
        data-testid="adjustment-note"
        value={form.note}
        onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
        placeholder="备注"
        rows={2}
        className="mt-2 w-full resize-none rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          data-testid="adjustment-create-submit"
          onClick={onCreate}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-white"
        >
          <Sparkles size={14} />
          创建单据
        </button>
        <button
          data-testid="adjustment-create-reset"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-[0.25em] text-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <Layers3 size={14} />
          重置
        </button>
      </div>
    </div>
  );
};

export default AdjustmentFormClean;
