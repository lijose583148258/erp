import React, { type Dispatch, type SetStateAction } from 'react';
import { FormField, StatusBadge } from '../../components/ui';
import type { PurchaseOrder, PurchaseReceiptBundle } from '../../services/procurement.service';
import type { PurchaseReceiptForm } from './procurementForms';

type PurchaseReceiptDrawerProps = {
  receiptDrawerOrder: PurchaseOrder;
  receiptBundle: PurchaseReceiptBundle | null;
  receiptForm: PurchaseReceiptForm;
  setReceiptForm: Dispatch<SetStateAction<PurchaseReceiptForm>>;
  isReceiptLoading: boolean;
  submitReceipt: () => void;
  onClose: () => void;
};

export const PurchaseReceiptDrawer = ({
  receiptDrawerOrder,
  receiptBundle,
  receiptForm,
  setReceiptForm,
  isReceiptLoading,
  submitReceipt,
  onClose,
}: PurchaseReceiptDrawerProps) => (
  <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" data-testid="purchase-receipt-drawer">
    <button
      type="button"
      aria-label="关闭收货批次"
      className="flex-1 cursor-default"
      onClick={onClose}
    />
    <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">Receipt Ledger</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">收货批次</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">{receiptDrawerOrder.item} · #{receiptDrawerOrder.id}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
        >
          关闭
        </button>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-3">
        {[
          ['订单量', receiptBundle?.receiptSummary.orderedQuantity ?? receiptDrawerOrder.quantity],
          ['已处理', receiptBundle?.receiptSummary.processedQuantity ?? 0],
          ['合格', receiptBundle?.receiptSummary.acceptedQuantity ?? 0],
          ['剩余', receiptBundle?.receiptSummary.remainingQuantity ?? receiptDrawerOrder.quantity],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
            <p className="mt-2 font-data text-xl font-black text-slate-900 dark:text-white">{String(value)}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">新增收货批次</h4>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700">
            {receiptDrawerOrder.status === 'received' ? '已收满' : '可继续收货'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FormField dataTestId="purchase-receipt-quantity-input" label="本次数量" value={receiptForm.quantity} onChange={(value) => setReceiptForm(prev => ({ ...prev, quantity: value, acceptedQuantity: prev.acceptedQuantity || value }))} disabled={receiptDrawerOrder.status === 'received'} />
          <FormField dataTestId="purchase-receipt-accepted-input" label="合格数量" value={receiptForm.acceptedQuantity} onChange={(value) => setReceiptForm(prev => ({ ...prev, acceptedQuantity: value }))} disabled={receiptDrawerOrder.status === 'received'} />
          <FormField dataTestId="purchase-receipt-rejected-input" label="差异数量" value={receiptForm.rejectedQuantity} onChange={(value) => setReceiptForm(prev => ({ ...prev, rejectedQuantity: value }))} disabled={receiptDrawerOrder.status === 'received'} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <FormField dataTestId="purchase-receipt-batch-input" label="入库批次" value={receiptForm.batchNo} onChange={(value) => setReceiptForm(prev => ({ ...prev, batchNo: value }))} disabled={receiptDrawerOrder.status === 'received'} />
          <FormField label="差异原因" value={receiptForm.discrepancyReason} onChange={(value) => setReceiptForm(prev => ({ ...prev, discrepancyReason: value }))} disabled={receiptDrawerOrder.status === 'received'} />
        </div>
        <FormField className="mt-3" as="textarea" rows={3} label="备注" value={receiptForm.note} onChange={(value) => setReceiptForm(prev => ({ ...prev, note: value }))} disabled={receiptDrawerOrder.status === 'received'} />
        <button
          type="button"
          data-testid="purchase-receipt-save-button"
          onClick={submitReceipt}
          disabled={isReceiptLoading || receiptDrawerOrder.status === 'received'}
          className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isReceiptLoading ? '保存中...' : '保存收货批次'}
        </button>
      </div>

      <div className="mt-6 space-y-3">
        <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">历史批次</h4>
        {(receiptBundle?.receipts || []).length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 p-6 text-center text-xs font-bold text-slate-400 dark:border-slate-800">
            暂无收货批次
          </div>
        ) : (
          receiptBundle?.receipts.map((receipt) => (
            <div key={receipt.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-slate-700 dark:text-slate-100">{receipt.receiptNo}</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">{receipt.batchNo || '-'} · {receipt.receivedAt || receipt.createdAt || '-'}</p>
                </div>
                <StatusBadge status={receipt.rejectedQuantity > 0 ? 'exception' : 'received'} label={receipt.rejectedQuantity > 0 ? '有差异' : '正常'} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-slate-500">
                <span>本次 {receipt.quantity}{receipt.unit}</span>
                <span>合格 {receipt.acceptedQuantity}{receipt.unit}</span>
                <span>差异 {receipt.rejectedQuantity}{receipt.unit}</span>
              </div>
              {receipt.note || receipt.discrepancyReason ? (
                <p className="mt-2 text-xs font-medium text-slate-400">{receipt.discrepancyReason || receipt.note}</p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </aside>
  </div>
);
