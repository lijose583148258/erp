import { Coins } from 'lucide-react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BarterAgreement, BarterSettlement } from '../../services/barter.service';
import { barterStatusLabelMap } from './barterStatus';

type Props = {
  agreement: BarterAgreement | null;
  canApprove: boolean;
  canPost: boolean;
  formatPrice: (amount: number) => string;
  onApprove: (settlement: BarterSettlement) => void;
  onPost: (settlement: BarterSettlement) => void;
  onReverse: (settlement: BarterSettlement) => void;
  onRefund: (settlement: BarterSettlement) => void;
};

export function BarterLedgerPanel({
  agreement,
  canApprove,
  canPost,
  formatPrice,
  onApprove,
  onPost,
  onReverse,
  onRefund,
}: Props) {
  return (
    <section className="rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl">
      <div className="mb-6 flex items-center gap-3 text-2xl font-black tracking-tighter">
        <Coins size={22} className="text-blue-600" />
        批次流水
      </div>
      <div className="mb-5 rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black text-slate-600">过账 / 冲回 / 回读</p>
            <h2 className="mt-2 text-lg font-black text-slate-950">入账和反冲只在台账处理</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">协议和批次负责录入业务事实；审核、过账、反冲负责财务确认。保存后请核对批次状态、已过账金额和冲销原因，形成回读证据。</p>
          </div>
          {agreement ? (
            <div className="rounded-[22px] bg-white px-4 py-3 text-sm font-bold text-slate-700">
              <div className="text-xs font-black text-slate-600">当前协议</div>
              <div className="mt-1 text-slate-950">{agreement.agreementNo}</div>
              <div className="mt-1">剩余待抵 {formatPrice(agreement.remainingOffsetAmount)}</div>
            </div>
          ) : null}
        </div>
      </div>
      {agreement?.settlements?.length ? (
        <div className="space-y-4">
          {agreement.settlements.map((settlement) => (
            <div key={settlement.id} className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-black text-slate-900">第 {settlement.batchIndex || 0} 批 / {settlement.settlementNo}</div>
                  <div className="mt-2">
                    <StatusBadge status={settlement.status} label={barterStatusLabelMap[settlement.status] || settlement.status} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {settlement.status === 'quoted' && canApprove && <button onClick={() => onApprove(settlement)} className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-black text-amber-700">审核</button>}
                  {settlement.status === 'approved' && canPost && <button onClick={() => onPost(settlement)} className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">过账</button>}
                  {(settlement.status === 'approved' || settlement.status === 'posted') && canPost && !['settled', 'review'].includes(settlement.cashObligation?.status || '') && <button onClick={() => onReverse(settlement)} className="rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700">冲销</button>}
                  {((settlement.status === 'quoted' && !canApprove) || ((settlement.status === 'approved' || settlement.status === 'posted') && !canPost)) && (
                    <span className="rounded-[14px] border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black text-slate-400">只读</span>
                  )}
                </div>
              </div>
              {settlement.cashDifference < 0 && settlement.status !== 'quoted' && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800" data-testid={`barter-cash-${settlement.id}`}>
                  <div className="font-bold">退款责任：{settlement.cashObligation?.currency || settlement.currency} {Number(settlement.cashObligation?.amount ?? -settlement.cashDifference).toFixed(2)}（原币，不作汇率换算）</div>
                  <div>{settlement.cashObligation?.status === 'settled' ? `已登记退款 · ${settlement.cashObligation.paymentReference} · ${settlement.cashObligation.paymentDate}`
                    : settlement.cashObligation?.status === 'void' ? '已随原批次冲销，历史责任保留'
                      : settlement.cashObligation?.status === 'open' ? `待处理 · 责任人编号 ${settlement.cashObligation.ownerId}`
                        : settlement.status === 'approved' ? '过账后生成待处理责任' : '历史差额待核对，禁止重复付款或直接冲销'}</div>
                  {settlement.status === 'posted' && settlement.cashObligation?.status === 'open' && canPost && (
                    <button onClick={() => onRefund(settlement)} className="mt-3 rounded-xl border border-blue-300 bg-white px-4 py-2 font-bold text-blue-700">登记已完成退款</button>
                  )}
                  {settlement.cashObligation?.status === 'settled' && <p>原批次禁止直接冲销；后续更正需独立补偿凭证，本入口不支持撤销实际退款。</p>}
                </div>
              )}
              <div className="mt-3 grid grid-cols-4 gap-3 text-sm font-bold text-slate-700">
                <div><div className="text-xs uppercase tracking-[0.2em] text-slate-400">我方货值</div><div>{formatPrice(settlement.totalPartyAValue)}</div></div>
                <div><div className="text-xs uppercase tracking-[0.2em] text-slate-400">对方货值</div><div>{formatPrice(settlement.totalPartyBValue)}</div></div>
                <div><div className="text-xs uppercase tracking-[0.2em] text-slate-400">本次差额</div><div>{formatPrice(settlement.cashDifference)}</div></div>
                <div><div className="text-xs uppercase tracking-[0.2em] text-slate-400">本次已过账</div><div>{formatPrice((settlement.offsetPostings || []).reduce((sum, posting) => sum + Number(posting.offsetAmount || 0), 0))}</div></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-slate-200 px-5 py-10 text-center text-sm font-bold text-slate-400">当前协议还没有执行批次。</div>
      )}
    </section>
  );
}
