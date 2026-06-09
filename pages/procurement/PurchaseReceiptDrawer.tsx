import React, { type Dispatch, type SetStateAction } from 'react';
import { FormField, StatusBadge } from '../../components/ui';
import type { PurchaseOrder, PurchaseReceiptBundle } from '../../services/procurement.service';
import type { ProcurementFormErrors, PurchaseReceiptForm } from './procurementForms';
import { useUnsavedForm } from '../../app/useUnsavedForm';

type PurchaseReceiptDrawerProps = {
  receiptDrawerOrder: PurchaseOrder;
  receiptBundle: PurchaseReceiptBundle | null;
  receiptForm: PurchaseReceiptForm;
  setReceiptForm: Dispatch<SetStateAction<PurchaseReceiptForm>>;
  receiptErrors: ProcurementFormErrors;
  clearReceiptError: (field: string) => void;
  isReceiptLoading: boolean;
  submitReceipt: () => void;
  onClose: () => void;
  canWrite: boolean;
};

export const PurchaseReceiptDrawer = ({
  receiptDrawerOrder,
  receiptBundle,
  receiptForm,
  setReceiptForm,
  receiptErrors,
  clearReceiptError,
  isReceiptLoading,
  submitReceipt,
  onClose,
  canWrite,
}: PurchaseReceiptDrawerProps) => {
  const { requestClose } = useUnsavedForm({
    sourceId: 'purchase-receipt-drawer',
    label: '采购收货批次',
    open: true,
    resetKey: receiptBundle?.receipts.length ?? 0,
    value: receiptForm,
  });
  const handleClose = () => requestClose(onClose);
  const updateReceiptField = (field: keyof PurchaseReceiptForm, value: string) => {
    clearReceiptError(field);
    setReceiptForm(prev => ({ ...prev, [field]: value }));
  };
  const receiptErrorCount = Object.keys(receiptErrors).length;

  return (
  <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" data-testid="purchase-receipt-drawer">
    <button
      type="button"
      aria-label="关闭收货批次"
      className="flex-1 cursor-default"
      onClick={handleClose}
    />
    <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black text-emerald-600">收货台账</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">收货批次</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">{receiptDrawerOrder.item} · #{receiptDrawerOrder.id}</p>
        </div>
        <button
          type="button"
          data-testid="purchase-receipt-close"
          onClick={handleClose}
          className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
        >关闭</button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        {!canWrite && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
            当前角色只能查看收货批次，保存收货需要采购写入权限。
          </div>
        )}
        {receiptErrorCount > 0 && (
          <div data-testid="purchase-receipt-error-summary" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
            还有 {receiptErrorCount} 项收货信息需要修正：{Object.values(receiptErrors)[0]}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField dataTestId="purchase-receipt-quantity-input" label="本次数量" value={receiptForm.quantity} onChange={(value) => {
            clearReceiptError('quantity');
            setReceiptForm(prev => ({ ...prev, quantity: value, acceptedQuantity: prev.acceptedQuantity || value }));
          }} error={receiptErrors.quantity} disabled={!canWrite || receiptDrawerOrder.status === 'received'} />
          <FormField dataTestId="purchase-receipt-accepted-input" label="合格数量" value={receiptForm.acceptedQuantity} onChange={(value) => updateReceiptField('acceptedQuantity', value)} error={receiptErrors.acceptedQuantity} disabled={!canWrite || receiptDrawerOrder.status === 'received'} />
          <FormField dataTestId="purchase-receipt-rejected-input" label="差异数量" value={receiptForm.rejectedQuantity} onChange={(value) => updateReceiptField('rejectedQuantity', value)} error={receiptErrors.rejectedQuantity} disabled={!canWrite || receiptDrawerOrder.status === 'received'} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField dataTestId="purchase-receipt-batch-input" label="入库批次" value={receiptForm.batchNo} onChange={(value) => updateReceiptField('batchNo', value)} disabled={!canWrite || receiptDrawerOrder.status === 'received'} />
          <FormField label="差异原因" value={receiptForm.discrepancyReason} onChange={(value) => updateReceiptField('discrepancyReason', value)} disabled={!canWrite || receiptDrawerOrder.status === 'received'} />
        </div>
        <FormField className="mt-3" as="textarea" rows={3} label="备注" value={receiptForm.note} onChange={(value) => updateReceiptField('note', value)} disabled={!canWrite || receiptDrawerOrder.status === 'received'} />
        <button
          type="button"
          data-testid="purchase-receipt-save-button"
          onClick={submitReceipt}
          disabled={isReceiptLoading || !canWrite || receiptDrawerOrder.status === 'received'}
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
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs font-bold text-slate-500 sm:grid-cols-3">
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
};
