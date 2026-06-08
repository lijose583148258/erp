import { useMemo } from 'react';
import { BookOpen, ClipboardList, PackageCheck, UsersRound } from 'lucide-react';
import { WorkspaceTaskNavigator, type WorkspaceTaskNavigatorItem } from '../../components/ui/WorkspaceTaskNavigator';
import { getProcurementDeskCopy } from './procurementDeskCopy';

export type ProcurementMainTab = 'suppliers' | 'orders';
export type ProcurementDeskTab = ProcurementMainTab | 'receipts' | 'principle';

type ProcurementDeskNavigatorProps = {
  language: string;
  activeDesk: ProcurementDeskTab;
  supplierCount: number;
  orderCount: number;
  receiptReadyCount: number;
  onChange: (desk: ProcurementDeskTab) => void;
};

export const ProcurementDeskNavigator = ({
  language,
  activeDesk,
  supplierCount,
  orderCount,
  receiptReadyCount,
  onChange,
}: ProcurementDeskNavigatorProps) => {
  const copy = useMemo(() => getProcurementDeskCopy(language), [language]);

  const items = useMemo<WorkspaceTaskNavigatorItem<ProcurementDeskTab>[]>(() => [
    {
      id: 'suppliers',
      title: copy.suppliers.title,
      subtitle: copy.suppliers.subtitle,
      purpose: copy.suppliers.purpose,
      count: supplierCount,
      icon: UsersRound,
      testId: 'procurement-desk-suppliers',
    },
    {
      id: 'orders',
      title: copy.orders.title,
      subtitle: copy.orders.subtitle,
      purpose: copy.orders.purpose,
      count: orderCount,
      icon: ClipboardList,
      testId: 'procurement-desk-orders',
    },
    {
      id: 'receipts',
      title: copy.receipts.title,
      subtitle: copy.receipts.subtitle,
      purpose: copy.receipts.purpose,
      count: receiptReadyCount,
      icon: PackageCheck,
      testId: 'procurement-desk-receipts',
    },
    {
      id: 'principle',
      title: copy.principle.title,
      subtitle: copy.principle.subtitle,
      purpose: copy.principle.purpose,
      count: copy.principleCards.length,
      icon: BookOpen,
      testId: 'procurement-desk-principle',
    },
  ], [copy, orderCount, receiptReadyCount, supplierCount]);

  return (
    <>
      <WorkspaceTaskNavigator
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        items={items}
        activeId={activeDesk}
        onChange={onChange}
        columns="four"
      />

      {activeDesk === 'receipts' && (
        <section data-testid="procurement-receipt-guidance" className="rounded-[32px] border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-600">{copy.receipts.title}</p>
              <h3 className="mt-2 text-xl font-black tracking-tight text-slate-950 dark:text-white">{copy.receiptGuideTitle}</h3>
              <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-emerald-800/80 dark:text-emerald-200/80">{copy.receiptGuideBody}</p>
            </div>
            <div className="rounded-2xl bg-white/80 px-4 py-3 text-xs font-black text-emerald-700 shadow-sm dark:bg-slate-950/60 dark:text-emerald-200">
              {copy.receiptGuideHint}
            </div>
          </div>
        </section>
      )}

      {activeDesk === 'principle' && (
        <section data-testid="procurement-principle-panel" className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {copy.principleCards.map(([title, body]) => (
            <article key={title} className="rounded-[30px] border border-slate-100 bg-white/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
                <BookOpen size={18} />
              </div>
              <h3 className="text-base font-black tracking-tight text-slate-950 dark:text-white">{title}</h3>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-500 dark:text-slate-400">{body}</p>
            </article>
          ))}
        </section>
      )}
    </>
  );
};
