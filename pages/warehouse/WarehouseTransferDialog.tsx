import { ArrowRightLeft, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import type { StockBalanceRecord } from '../../services/warehouse.service';
import type { TransferFormErrors, TransferFormState, WarehouseLocationOption } from './warehouseWorkspaceTypes';

interface WarehouseTransferDialogProps {
  balance: StockBalanceRecord | null;
  allLocations: WarehouseLocationOption[];
  transferForm: TransferFormState;
  setTransferForm: Dispatch<SetStateAction<TransferFormState>>;
  transferErrors: TransferFormErrors;
  clearTransferError: (field: keyof TransferFormErrors) => void;
  transferMsg: string;
  transferSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
  canWrite: boolean;
}

export function WarehouseTransferDialog({
  balance,
  allLocations,
  transferForm,
  setTransferForm,
  transferErrors,
  clearTransferError,
  transferMsg,
  transferSaving,
  onClose,
  onSubmit,
  canWrite,
}: WarehouseTransferDialogProps) {
  const { requestClose } = useUnsavedForm({
    sourceId: 'warehouse-transfer-dialog',
    label: '库存调拨',
    open: Boolean(balance),
    value: transferForm,
    resetKey: balance?.id ?? null,
  });

  if (!balance) return null;

  const sourceLocationId = Number(balance.locationId);
  const availableQuantity = Number(balance.quantity || 0);
  const targetLocations = allLocations.filter(location => Number(location.id) !== sourceLocationId);
  const destinationErrorId = 'warehouse-transfer-destination-error';
  const quantityErrorId = 'warehouse-transfer-quantity-error';
  const handleClose = () => {
    if (!transferSaving) requestClose(onClose);
  };

  return (
    <div
      data-testid="warehouse-transfer-modal"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-md"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl rounded-[28px] border border-white/40 bg-white p-7 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-orange-500/30">
              <ArrowRightLeft size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white">库存调拨</h3>
              <p className="mt-1 text-xs font-bold text-slate-400">同批次从一个库位转到另一个库位，保存后自动刷新台账。</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="warehouse-transfer-close"
            onClick={handleClose}
 className="rounded-2xl bg-slate-100 p-2 text-slate-400 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:hover:text-white"
            aria-label="关闭库存调拨弹窗"
          >
            <X size={18} />
          </button>
        </div>
        {!canWrite && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
            当前角色只能查看库存，不能执行库存调拨。
          </div>
        )}

        <div className="mb-5 rounded-2xl border border-amber-100 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-500">产品</p>
              <p className="mt-1 font-black text-slate-900 dark:text-white">{balance.productName}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-500">批次</p>
              <p className="mt-1 font-mono text-xs font-bold text-slate-600 dark:text-slate-300">{balance.batchNo}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-500">当前库位</p>
              <p className="mt-1 font-bold text-slate-700 dark:text-slate-200">{balance.warehouseName || '-'} / {balance.locationName || '-'}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-500">可调数量</p>
              <p className="mt-1 font-black text-amber-700 dark:text-amber-300">{availableQuantity} {balance.unit}</p>
            </div>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { title: '调出行', text: '使用当前库存余额行作为唯一调出来源。' },
            { title: '负库存防护', text: '数量必须大于 0 且不超过可调数量。' },
            { title: '流水回读', text: '保存后生成 warehouse_transfer sourceRef。' },
          ].map(item => (
            <div key={item.title} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/35">
              <p className="text-[11px] font-black tracking-[0.14em] text-slate-400">{item.title}</p>
              <p className="mt-1 text-xs font-bold leading-5 text-slate-600 dark:text-slate-200">{item.text}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">目标库位 *</label>
            <select
              data-testid="warehouse-transfer-destination-select"
              value={transferForm.toLocationId}
              onChange={event => {
                clearTransferError('toLocationId');
                setTransferForm(form => ({ ...form, toLocationId: Number(event.target.value) }));
              }}
              aria-invalid={Boolean(transferErrors.toLocationId)}
              aria-describedby={transferErrors.toLocationId ? destinationErrorId : undefined}
 className={`w-full rounded-xl border bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none focus:border-transparent focus:ring-2 focus:ring-amber-500 dark:bg-slate-800 dark:text-white ${transferErrors.toLocationId ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/20' : 'border-slate-200 dark:border-slate-700'}`}
            >
              <option value={0}>-- 选择目标库位 --</option>
              {targetLocations.map(location => (
                <option key={location.id} value={location.id}>
                  {location.warehouseName} / {location.name} ({location.code})
                </option>
              ))}
            </select>
            {transferErrors.toLocationId ? (
              <p id={destinationErrorId} className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{transferErrors.toLocationId}</p>
            ) : null}
          </div>
          <div>
            <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">调拨数量 *</label>
            <input
              data-testid="warehouse-transfer-quantity-input"
              type="number"
              min={0}
              max={availableQuantity}
              step={0.01}
              value={transferForm.quantity || ''}
              onChange={event => {
                clearTransferError('quantity');
                setTransferForm(form => ({ ...form, quantity: Number(event.target.value) }));
              }}
              aria-invalid={Boolean(transferErrors.quantity)}
              aria-describedby={transferErrors.quantity ? quantityErrorId : undefined}
 className={`w-full rounded-xl border bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none focus:border-transparent focus:ring-2 focus:ring-amber-500 dark:bg-slate-800 dark:text-white ${transferErrors.quantity ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/20' : 'border-slate-200 dark:border-slate-700'}`}
            />
            {transferErrors.quantity ? (
              <p id={quantityErrorId} className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{transferErrors.quantity}</p>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-500">调拨备注</label>
            <textarea
              data-testid="warehouse-transfer-note-input"
              value={transferForm.note}
              onChange={event => setTransferForm(form => ({ ...form, note: event.target.value }))}
              placeholder="例如：生产领料预转、库位整理、批次换区"
              rows={3}
 className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none focus:border-transparent focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        {transferMsg && (
          <div
            data-testid="warehouse-transfer-message"
            className={`mt-4 rounded-xl border px-4 py-3 text-sm font-bold ${
              transferMsg.startsWith('✓')
                ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30'
                : transferMsg.includes('处理中')
                  ? 'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30'
                  : 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-900/30'
            }`}
          >
            {transferMsg}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            data-testid="warehouse-transfer-cancel"
            onClick={handleClose}
            disabled={transferSaving}
 className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-black text-slate-600 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="warehouse-transfer-submit-button"
            onClick={onSubmit}
            disabled={transferSaving || !canWrite}
 className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-sm font-black text-white shadow-lg shadow-orange-500/30 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
          >
            {transferSaving ? '调拨处理中...' : '确认调拨'}
          </button>
        </div>
      </div>
    </div>
  );
}
