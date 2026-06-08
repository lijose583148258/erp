import { BadgeCheck, FileStack, Globe2, Loader2 } from 'lucide-react';
import type { Customer } from '../../types';

type TranslationText = Record<string, string | undefined>;
type SegmentKey = 'direct' | 'channel' | 'mixed';
type SegmentMeta = Record<SegmentKey, { label: string; tone: string }>;

export function CRMCreatePreviewPanel({
  t,
  newCustomer,
  previewName,
  segment,
  segmentMeta,
  checklist,
  readyCount,
  isSubmitting,
  onCreate,
}: {
  t: TranslationText;
  newCustomer: Partial<Customer>;
  previewName: string;
  segment: SegmentKey;
  segmentMeta: SegmentMeta;
  checklist: boolean[];
  readyCount: number;
  isSubmitting: boolean;
  onCreate: () => void;
}) {
  return (
    <aside className="border-l border-slate-100 bg-slate-50/70 px-8 py-8 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="sticky top-0 space-y-6">
        <div className="rounded-[28px] bg-white p-6 shadow-sm dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <Globe2 className="text-blue-500" />
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{t.crmCommercialPreview || 'Commercial Preview'}</div>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-sm font-black text-slate-900 dark:text-white">{previewName}</div>
              <div className="mt-2 space-y-1 text-[11px] font-bold text-slate-500">
                {newCustomer.nameZh && <div>ZH: {newCustomer.nameZh}</div>}
                {newCustomer.nameEn && <div>EN: {newCustomer.nameEn}</div>}
                {newCustomer.nameVi && <div>VI: {newCustomer.nameVi}</div>}
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{t.crmBusinessProfile || 'Business Profile'}</div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${segmentMeta[segment].tone}`}>{segmentMeta[segment].label}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs font-bold text-slate-500">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{t.crmCreditLimit || '信用额度'}</div>
                  <div className="mt-1 text-sm text-slate-900 dark:text-white">{Number(newCustomer.creditLimit || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{t.crmTerms || '账期'}</div>
                  <div className="mt-1 text-sm text-slate-900 dark:text-white">{newCustomer.termsDays || 30} 天</div>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{t.crmCompletion || '建档完成度'}</div>
              <div className="mt-3 flex items-center gap-3">
                <div className="text-3xl font-black text-slate-900 dark:text-white">{readyCount}/4</div>
                <div className="text-xs font-medium text-slate-500">{t.crmCompletionHint || '名称、主地址、主联系人、联系方式齐全后更适合直接进入业务流。'}</div>
              </div>
              <div className="mt-4 space-y-2 text-xs font-bold">
                {[
                  { key: 'main-name', label: t.crmMainName || '主名称', ready: checklist[0] },
                  { key: 'main-address', label: t.crmMainAddress || '主地址', ready: checklist[1] },
                  { key: 'main-contact', label: t.crmMainContact || '主联系人', ready: checklist[2] },
                  { key: 'contact-info', label: t.crmContactInfo || '联系方式', ready: checklist[3] },
                ].map(({ key, label, ready }) => (
                  <div key={key} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                    <span>{label}</span>
                    {ready ? <BadgeCheck size={14} className="text-emerald-500" /> : <FileStack size={14} className="text-slate-300" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <button
          data-testid="crm-create-submit"
          onClick={onCreate}
          disabled={isSubmitting}
          className="flex w-full items-center justify-center rounded-[24px] bg-slate-900 px-6 py-4 text-sm font-black uppercase tracking-[0.24em] text-white shadow-2xl transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900"
        >
          {isSubmitting ? <Loader2 className="animate-spin" /> : (t.crmCreateCustomerMaster || '创建客户主档')}
        </button>
      </div>
    </aside>
  );
}
