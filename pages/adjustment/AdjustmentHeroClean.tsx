import React from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AdjustmentStatCounts } from './adjustment.constants';

interface AdjustmentHeroProps {
  stat: AdjustmentStatCounts;
}

const AdjustmentHeroClean = ({ stat }: AdjustmentHeroProps) => {
  return (
    <section className="relative overflow-hidden rounded-[42px] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.22),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.20),transparent_30%)]" />
      <div className="relative p-8 lg:p-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.3em] text-blue-200">
          <ShieldCheck size={12} />
          异常调账治理台账
        </div>
        <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-black italic leading-none tracking-tighter uppercase lg:text-5xl">
              跨域异常调账与审计回放
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 lg:text-base">
              这里只处理已经确认的跨域异常、历史补偿和冲销回放。日常应收核销、生产完工、仓库入库仍回到各自主入口，避免同一笔业务被多个页面重复录入。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:min-w-[360px]">
            {[
              ['总单据', stat.total],
              ['已生效', stat.posted],
              ['待处理', stat.pending],
              ['已冲销', stat.reversed],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{label}</p>
                <div className="mt-3 text-3xl font-black italic">{value as number}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default AdjustmentHeroClean;
