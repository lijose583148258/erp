import React from 'react';
import { CornerDownLeft, CornerUpRight } from 'lucide-react';
import type { AdjustmentRecord } from '../../services/adjustment.service';
import { adjustmentDomainMeta, adjustmentStatusMeta } from './adjustment.constants';

interface AdjustmentDetailProps {
  t: any;
  selected: AdjustmentRecord | null;
  reverseNote: string;
  onReverseNoteChange: (value: string) => void;
  onApply: (id: number) => void;
  onReverse: (id: number) => void;
  formatPrice: (value: number) => string;
}

const getAdjustmentLabel = (record: AdjustmentRecord) =>
  record.customerDisplayName ||
  record.customerNameZh ||
  record.customerNameEn ||
  record.customerNameVi ||
  record.customerName ||
  record.productName ||
  record.targetRef ||
  '未命名';

const AdjustmentDetail = ({
  t,
  selected,
  reverseNote,
  onReverseNoteChange,
  onApply,
  onReverse,
  formatPrice,
}: AdjustmentDetailProps) => {
  if (!selected) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-[36px] border border-slate-100 dark:border-slate-800 shadow-sm p-6 lg:p-7 text-slate-400 font-bold text-sm">
        {t.adjustmentSelectRecord || '请选择一张调账单查看详情'}
      </div>
    );
  }

  return (
    <div data-testid="adjustment-detail" className="bg-white dark:bg-slate-900 rounded-[36px] border border-slate-100 dark:border-slate-800 shadow-sm p-6 lg:p-7 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-black italic uppercase tracking-tighter text-slate-900 dark:text-white">
            {t.adjustmentDetailTitle || '单据详情'}
          </h3>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400 mt-2">
            {selected.adjustmentNo}
          </p>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${adjustmentStatusMeta[selected.status].className}`}
        >
          {adjustmentStatusMeta[selected.status].label}
        </span>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">{t.adjustmentDomainLabel || '业务域'}</span>
          <span className="font-black text-slate-900 dark:text-white">{adjustmentDomainMeta[selected.domain].label}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">{t.adjustmentTargetLabel || '对象'}</span>
          <span className="font-black text-slate-900 dark:text-white">{getAdjustmentLabel(selected)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">{t.adjustmentTargetNoLabel || '对象编号'}</span>
          <span className="font-black text-slate-900 dark:text-white">
            {selected.targetRef || selected.orderNo || selected.batchNo || '-'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">{t.adjustmentDeltaLabel || '变动'}</span>
          <span className="font-black text-slate-900 dark:text-white">
            {selected.domain === 'finance'
              ? formatPrice(Math.abs(Number(selected.amountDelta || 0)))
              : `${Number(selected.quantityDelta || 0)}`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">{t.adjustmentReasonLabel || '原因'}</span>
          <span className="font-black text-slate-900 dark:text-white text-right max-w-[180px]">
            {selected.reason}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">{t.adjustmentCategoryLabel || '分类'}</span>
          <span className="font-black text-slate-900 dark:text-white">{selected.reasonCategory || '-'}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          data-testid="adjustment-apply-button"
          onClick={() => onApply(selected.id)}
          disabled={selected.status === 'posted' || selected.status === 'reversed'}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase tracking-[0.25em] disabled:opacity-40"
        >
          <CornerDownLeft size={14} />
          {t.adjustmentApplyButton || '生效'}
        </button>
        <button
          data-testid="adjustment-reverse-button"
          onClick={() => onReverse(selected.id)}
          disabled={selected.status === 'reversed'}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-rose-600 text-white text-xs font-black uppercase tracking-[0.25em] disabled:opacity-40"
        >
          <CornerUpRight size={14} />
          {t.adjustmentReverseButton || '冲销'}
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-black uppercase tracking-widest text-slate-400">{t.adjustmentReverseNoteLabel || '冲销备注'}</label>
        <input
          data-testid="adjustment-reverse-note"
          value={reverseNote}
          onChange={e => onReverseNoteChange(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-xs font-bold border border-slate-100 dark:border-slate-700"
          placeholder={t.adjustmentReverseNotePlaceholder || '人工冲销'}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">{t.adjustmentSnapshotTitle || '前后快照'}</span>
          <span className="text-xs font-black uppercase tracking-widest text-slate-300">{t.adjustmentAuditTrail || '审计留痕'}</span>
        </div>
        <div className="rounded-[24px] bg-slate-50 dark:bg-slate-800/60 p-4">
          <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">{t.adjustmentBefore || 'Before'}</p>
          <pre className="text-[11px] leading-6 text-slate-600 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(selected.beforeSnapshot || {}, null, 2)}
          </pre>
        </div>
        <div className="rounded-[24px] bg-slate-50 dark:bg-slate-800/60 p-4">
          <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">{t.adjustmentAfter || 'After'}</p>
          <pre className="text-[11px] leading-6 text-slate-600 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(selected.afterSnapshot || {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default AdjustmentDetail;
