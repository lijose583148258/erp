import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, FileText, Info, Sparkles, X } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { collectionsService } from '../../services/collections.service';
import {
  buildCollectionActionDraft,
  CollectionActionTemplateId,
  getCollectionActionTemplates,
  getDefaultCollectionActionTemplateId,
} from './collectionTemplates';

export type CollectionActionMode = 'promise' | 'dispute';

export interface CollectionActionTarget {
  customerId: number;
  customerName: string;
  orderId: number;
  orderNo: string;
  outstanding: number;
  contactName?: string | null;
  contactPhone?: string | null;
}

const parseFiniteAmountInput = (value: string) => {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface CollectionActionModalProps {
  mode: CollectionActionMode | null;
  target: CollectionActionTarget | null;
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => Promise<void> | void;
}

const CollectionActionModal: React.FC<CollectionActionModalProps> = ({ mode, target, open, onClose, onSubmitted }) => {
  const { formatPrice, notify, t } = useAppContext();
  const templates = useMemo(() => (mode ? getCollectionActionTemplates(mode) : []), [mode]);
  const [submitting, setSubmitting] = useState(false);
  const [templateId, setTemplateId] = useState<CollectionActionTemplateId | 'custom'>('custom');
  const [promisedAt, setPromisedAt] = useState('');
  const [promisedAmount, setPromisedAmount] = useState(0);
  const [channel, setChannel] = useState<'phone' | 'wechat' | 'email' | 'onsite'>('phone');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [reasonCategory, setReasonCategory] = useState<'billing' | 'delivery' | 'quality' | 'contract'>('billing');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const applyTemplate = useCallback((nextTemplateId: CollectionActionTemplateId | 'custom') => {
    if (!mode || !target) return;
    const draft = buildCollectionActionDraft(mode, target, nextTemplateId);
    setPromisedAmount(draft.promisedAmount);
    setPromisedAt(draft.promisedAt);
    setChannel(draft.channel);
    setContactName(draft.contactName);
    setContactPhone(draft.contactPhone);
    setReasonCategory(draft.reasonCategory);
    setReason(draft.reason);
    setNote(draft.note);
  }, [mode, target]);

  useEffect(() => {
    if (!open || !target || !mode) return;
    const defaultTemplateId = getDefaultCollectionActionTemplateId(mode);
    setTemplateId(defaultTemplateId);
    applyTemplate(defaultTemplateId);
  }, [applyTemplate, open, target, mode]);

  if (!open || !mode || !target) return null;

  const title = mode === 'promise' ? t.collectionPromiseTitle : t.collectionDisputeTitle;
  const icon = mode === 'promise' ? <Clock3 className="text-amber-500" size={22} /> : <FileText className="text-rose-500" size={22} />;
  const activeTemplate = templateId === 'custom' ? null : templates.find((item) => item.id === templateId) || null;
  const defaultPromiseNote = t.collectionPromiseDefaultNote.replace('{orderNo}', target.orderNo);
  const defaultDisputeNote = t.collectionDisputeDefaultNote.replace('{orderNo}', target.orderNo);
  const outstandingAmount = Number.isFinite(target.outstanding) ? target.outstanding : 0;

  const handleSubmit = async () => {
    if (mode === 'promise' && (!Number.isFinite(promisedAmount) || promisedAmount <= 0)) {
      notify('error', '承诺金额必须大于 0。');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'promise') {
        await collectionsService.createPromise({
          customerId: target.customerId,
          orderId: target.orderId,
          promisedAmount,
          promisedAt,
          channel,
          contactName: contactName || undefined,
          contactPhone: contactPhone || undefined,
          note: note || defaultPromiseNote,
        });
        notify('success', t.collectionPromiseSuccess);
      } else {
        await collectionsService.createDispute({
          customerId: target.customerId,
          orderId: target.orderId,
          disputedAmount: outstandingAmount,
          reasonCategory,
          reason,
          note: note || defaultDisputeNote,
        });
        notify('success', t.collectionDisputeSuccess);
      }

      if (onSubmitted) {
        await onSubmitted();
      }
      onClose();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : (mode === 'promise' ? t.collectionPromiseFail : t.collectionDisputeFail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="collection-action-modal" className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md rounded-[32px] border border-slate-100 bg-white p-8 shadow-2xl animate-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {icon}
            <div>
              <h3 className="text-xl font-black italic text-slate-900 dark:text-white">{title}</h3>
              <p className="text-xs font-bold text-slate-400">{target.orderNo}</p>
            </div>
          </div>
          <button data-testid="collection-action-close" onClick={onClose} className="rounded-full bg-slate-100 p-2 dark:bg-slate-800">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
            <p className="text-xs font-bold tracking-wide text-slate-400">{t.collectionTargetOrder}</p>
            <p className="font-bold text-slate-800 dark:text-white">{target.customerName}</p>
            <p className="text-xs text-slate-500">
              未收金额：
              <span className="ml-1 font-bold text-rose-500">{formatPrice(outstandingAmount)}</span>
            </p>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="text-blue-500" />
              <p className="text-xs font-bold tracking-wide text-slate-400">{t.collectionScenarioTemplate}</p>
            </div>
            <select
              className="w-full rounded-2xl bg-white p-4 text-sm font-bold outline-none dark:bg-slate-900"
              value={templateId}
              onChange={(event) => {
                const nextTemplateId = event.target.value as CollectionActionTemplateId | 'custom';
                setTemplateId(nextTemplateId);
                applyTemplate(nextTemplateId);
              }}
            >
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
              <option value="custom">{t.collectionCustomEntry}</option>
            </select>
            <p className="mt-2 text-xs font-bold text-slate-500">{activeTemplate?.description || t.collectionManualHint}</p>
          </div>

          {mode === 'promise' ? (
            <>
              <div className="flex items-center rounded-xl bg-amber-50 p-3 text-xs font-bold leading-relaxed text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                <Info size={14} className="mr-2 shrink-0" />
                {t.collectionPromiseNotice}
              </div>
              <div>
                <label className="ml-2 text-xs font-bold tracking-wide text-slate-400">{t.collectionPromisedAmount}</label>
                <input
                  type="number"
                  data-testid="collection-action-promised-amount"
                  className="w-full rounded-2xl bg-slate-50 p-4 text-lg font-black outline-none focus:ring-2 focus:ring-blue-100 dark:bg-slate-800"
                  value={Number.isFinite(promisedAmount) ? promisedAmount : ''}
                  onChange={(event) => setPromisedAmount(parseFiniteAmountInput(event.target.value))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="ml-2 text-xs font-bold tracking-wide text-slate-400">{t.collectionPromisedAt}</label>
                  <input
                    type="datetime-local"
                    data-testid="collection-action-promised-at"
                    className="w-full rounded-2xl bg-slate-50 p-4 font-bold outline-none dark:bg-slate-800"
                    value={promisedAt}
                    onChange={(event) => setPromisedAt(event.target.value)}
                  />
                </div>
                <div>
                  <label className="ml-2 text-xs font-bold tracking-wide text-slate-400">{t.collectionChannel}</label>
                  <select
                    className="w-full appearance-none rounded-2xl bg-slate-50 p-4 font-bold outline-none dark:bg-slate-800"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value as 'phone' | 'wechat' | 'email' | 'onsite')}
                  >
                    <option value="phone">{t.phone}</option>
                    <option value="wechat">{t.collectionChannelWechat}</option>
                    <option value="email">{t.email}</option>
                    <option value="onsite">{t.collectionChannelOnsite}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  className="w-full rounded-2xl bg-slate-50 p-4 text-sm font-bold outline-none dark:bg-slate-800"
                  placeholder={t.contactName}
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                />
                <input
                  type="text"
                  className="w-full rounded-2xl bg-slate-50 p-4 text-sm font-bold outline-none dark:bg-slate-800"
                  placeholder={t.phone}
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center rounded-xl bg-rose-50 p-3 text-xs font-bold leading-relaxed text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                <Info size={14} className="mr-2 shrink-0" />
                {t.collectionDisputeNotice}
              </div>
              <div>
                <label className="ml-2 text-xs font-bold tracking-wide text-slate-400">{t.collectionReasonCategory}</label>
                <select
                  className="w-full appearance-none rounded-2xl bg-slate-50 p-4 font-bold outline-none dark:bg-slate-800"
                  value={reasonCategory}
                  onChange={(event) => setReasonCategory(event.target.value as 'billing' | 'delivery' | 'quality' | 'contract')}
                >
                  <option value="billing">{t.collectionReasonBilling}</option>
                  <option value="delivery">{t.collectionReasonDelivery}</option>
                  <option value="quality">{t.collectionReasonQuality}</option>
                  <option value="contract">{t.collectionReasonContract}</option>
                </select>
              </div>
              <div>
                <label className="ml-2 text-xs font-bold tracking-wide text-slate-400">{t.adjReason}</label>
                <textarea
                  data-testid="collection-action-dispute-reason"
                  className="h-28 w-full resize-none rounded-2xl bg-slate-50 p-4 text-sm font-bold outline-none dark:bg-slate-800"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            </>
          )}

          <input
            type="text"
            data-testid="collection-action-note"
            className="w-full rounded-2xl bg-slate-50 p-4 text-sm font-bold outline-none dark:bg-slate-800"
            placeholder={t.notes}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          <button
            data-testid="collection-action-submit"
            onClick={handleSubmit}
            disabled={submitting}
            className="mt-4 w-full rounded-[24px] bg-blue-600 py-4 font-black text-white shadow-xl transition-all hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (mode === 'promise' ? t.collectionSubmittingPromise : t.collectionSubmittingDispute) : mode === 'promise' ? t.collectionSubmitPromise : t.collectionSubmitDispute}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CollectionActionModal;
