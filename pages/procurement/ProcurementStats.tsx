import React from 'react';
import { AlertTriangle, ClipboardList, Factory, Truck } from 'lucide-react';

type ProcurementStatsProps = {
  t: any;
  supplierCount: number;
  stats: {
    activeOrders: number;
    avgLead: number;
    risky: number;
  };
};

export const ProcurementStats = ({ t, supplierCount, stats }: ProcurementStatsProps) => (
  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.supplierTotal}</p>
      <div className="flex items-center justify-between">
        <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{supplierCount}</span>
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-blue-500"><Factory size={20} /></div>
      </div>
    </div>
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.activePurchase}</p>
      <div className="flex items-center justify-between">
        <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{stats.activeOrders}</span>
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-emerald-500"><ClipboardList size={20} /></div>
      </div>
    </div>
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.avgLead}</p>
      <div className="flex items-center justify-between">
        <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{stats.avgLead}</span>
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-amber-500"><Truck size={20} /></div>
      </div>
    </div>
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm dark:bg-slate-900 dark:border-slate-800">
      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.riskSuppliers}</p>
      <div className="flex items-center justify-between">
        <span className="text-3xl font-black text-slate-800 tracking-tighter dark:text-white">{stats.risky}</span>
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-rose-500"><AlertTriangle size={20} /></div>
      </div>
    </div>
  </div>
);
