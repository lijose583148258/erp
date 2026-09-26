import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BarterAgreement } from '../../services/barter.service';
import { barterStatusLabelMap } from './barterWorkspaceParts';

type Props = {
  agreements: BarterAgreement[];
  selectedAgreementId?: number;
  formatPrice: (amount: number) => string;
  onSelect: (agreementId: number) => void;
};

export function BarterAgreementList({
  agreements,
  selectedAgreementId,
  formatPrice,
  onSelect,
}: Props) {
  return (
    <div className="rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl">
      <div className="mb-6 text-2xl font-black tracking-tighter">协议列表</div>
      <div className="space-y-3">
        {agreements.map((agreement) => (
          <button
            key={agreement.id}
            type="button"
            onClick={() => onSelect(agreement.id)}
            className={`w-full rounded-[24px] border p-4 text-left ${selectedAgreementId === agreement.id ? 'border-blue-200 bg-blue-50/70' : 'border-slate-100 bg-slate-50/70'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-900">{agreement.agreementNo}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">{agreement.counterpartyName}</div>
              </div>
              <StatusBadge status={agreement.status} label={barterStatusLabelMap[agreement.status] || agreement.status} className="shrink-0" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm font-bold text-slate-700">
              <div><div className="text-xs uppercase tracking-[0.2em] text-slate-400">已抵</div><div>{formatPrice(agreement.executedOffsetAmount)}</div></div>
              <div><div className="text-xs uppercase tracking-[0.2em] text-slate-400">待抵</div><div>{formatPrice(agreement.remainingOffsetAmount)}</div></div>
              <div><div className="text-xs uppercase tracking-[0.2em] text-slate-400">批次</div><div>{agreement.batchCount || 0}</div></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
