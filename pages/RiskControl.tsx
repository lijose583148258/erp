
import React, { useState, useMemo, useEffect } from 'react';
import DataTable, { Column } from '../components/DataTable';
import { Invoice, PaymentRecord } from '../types';
import {
  History,
  ShieldAlert,
  Clock,
  Receipt,
  Megaphone,
  Zap,
  TrendingDown,
  ArrowRight
} from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import {
  CollectionLedgerRecord,
  CollectionOverdueRecord,
  CollectionSummary,
  collectionsService,
} from '../services/collections.service';
import { getCustomerDisplayName } from '../utils/customerName';
import { isCanceledApiError } from '../utils/api';
import CommercialOpsPanel from '../components/CommercialOpsPanel';

const RiskControl = () => {
  const { t, formatPrice, language, notify } = useAppContext();
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [overdueOrders, setOverdueOrders] = useState<CollectionOverdueRecord[]>([]);
  const [ledger, setLedger] = useState<CollectionLedgerRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      const workbenchData = await collectionsService.getWorkbench({ signal: controller.signal });

      if (cancelled || controller.signal.aborted) return;
      setSummary(workbenchData.summary);
      setOverdueOrders(workbenchData.overdue);
      setLedger(workbenchData.ledger);
    };

    load().catch((error) => {
      if (isCanceledApiError(error)) return;
      if (!cancelled) {
        setSummary(null);
        setOverdueOrders([]);
        setLedger([]);
        notify('error', error instanceof Error ? error.message : '风控数据加载失败，请刷新后再核对');
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [notify]);

  const invoices = useMemo<Invoice[]>(() => {
    const verifiedPaymentsByOrder = ledger.reduce<Record<number, PaymentRecord[]>>((acc, record) => {
      if (record.status !== 'verified') {
        return acc;
      }
      if (!acc[record.orderId]) {
        acc[record.orderId] = [];
      }
      acc[record.orderId].push({
        id: String(record.id),
        amount: Number(record.amount),
        method: record.method,
        date: record.date,
        note: record.note || undefined,
        payerName: record.payerName || undefined,
        isProxy: record.isProxy,
        status: record.status,
      });
      return acc;
    }, {});

    return overdueOrders.map((order) => {
      const customerDisplayName = getCustomerDisplayName({
        name: order.customerName,
        nameZh: order.customerNameZh,
        nameEn: order.customerNameEn,
        nameVi: order.customerNameVi,
        displayName: order.customerDisplayName,
      }, language);

      return {
        id: String(order.orderId),
        orderId: String(order.orderId),
        customerName: order.customerName,
        customerNameZh: order.customerNameZh || undefined,
        customerNameEn: order.customerNameEn || undefined,
        customerNameVi: order.customerNameVi || undefined,
        customerDisplayName,
        amount: Number(order.finalAmount),
        dueDate: order.dueDate,
        status: order.paymentStatus,
        payments: verifiedPaymentsByOrder[order.orderId] || [],
      };
    });
  }, [ledger, overdueOrders, language]);

  const stats = useMemo(() => {
    const overdueList = overdueOrders;
    const totalOverdueAmount = summary?.overdueAmount || 0;
    let maxDays = 0;
    let maxDaysCustomer = '';

    const tickerItems = overdueList.map((inv) => {
      const monthLabel = `${new Date(inv.dueDate).getMonth() + 1}${t.month}`;
      if (inv.daysOverdue > maxDays) {
        maxDays = inv.daysOverdue;
        maxDaysCustomer = getCustomerDisplayName({
          name: inv.customerName,
          nameZh: inv.customerNameZh,
          nameEn: inv.customerNameEn,
          nameVi: inv.customerNameVi,
          displayName: inv.customerDisplayName,
        }, language) || inv.customerName;
      }
      return `${getCustomerDisplayName({
        name: inv.customerName,
        nameZh: inv.customerNameZh,
        nameEn: inv.customerNameEn,
        nameVi: inv.customerNameVi,
        displayName: inv.customerDisplayName,
      }, language) || inv.customerName} | ${monthLabel} ${t.tickerOverdue} ${formatPrice(inv.outstanding)} (${inv.daysOverdue}${t.days})`;
    });

    return { tickerItems, totalOverdueAmount, maxDays, maxDaysCustomer };
  }, [overdueOrders, summary, t, formatPrice, language]);

  const blindSpots = useMemo(() => {
    const overdueList = overdueOrders;
    const invoiceMap = new Map<string, Invoice>(invoices.map((invoice) => [invoice.orderId, invoice]));
    const noPayment = overdueList.filter(inv => (invoiceMap.get(String(inv.orderId))?.payments.length || 0) === 0);
    const longOverdue = overdueList.filter(inv => inv.daysOverdue > 30);
    const totalOutstanding = overdueList.reduce((sum, inv) => sum + Number(inv.outstanding), 0);
    const topCustomer = [...overdueList].sort((a, b) => Number(b.outstanding) - Number(a.outstanding))[0];
    const concentration = topCustomer && totalOutstanding > 0
      ? Math.round((Number(topCustomer.outstanding) / totalOutstanding) * 100)
      : 0;

    const list = [] as { title: string; impact: string; action: string }[];

    if (noPayment.length > 0) {
      list.push({
        title: t.blindspotMilestone,
        impact: `${noPayment.length} ${t.invoicesWithoutPayment}`,
        action: t.blindspotMilestoneAction
      });
    }

    if (longOverdue.length > 0) {
      list.push({
        title: t.blindspotAging,
        impact: `${longOverdue.length} ${t.invoicesOver30}`,
        action: t.blindspotAgingAction
      });
    }

    if (concentration > 35) {
      list.push({
        title: t.blindspotConcentration,
        impact: `${getCustomerDisplayName({
          name: topCustomer?.customerName,
          nameZh: topCustomer?.customerNameZh,
          nameEn: topCustomer?.customerNameEn,
          nameVi: topCustomer?.customerNameVi,
          displayName: topCustomer?.customerDisplayName,
        }, language) || topCustomer?.customerName || ''} ${concentration}%`,
        action: t.blindspotConcentrationAction
      });
    }

    if (list.length === 0) {
      list.push({ title: t.blindspotHealthy, impact: t.blindspotHealthyImpact, action: t.blindspotHealthyAction });
    }

    return list;
  }, [overdueOrders, invoices, t, language]);

  const getRiskUI = (days: number, status: string) => {
    if (status === 'paid') return { label: t.settled, color: 'bg-emerald-50 text-emerald-600 border-emerald-100' };
    if (status === 'payment_submitted') return { label: t.pendingVerification || '待财务核验', color: 'bg-amber-50 text-amber-600 border-amber-100' };
    if (days === 0) return { label: t.onSchedule, color: 'bg-blue-50 text-blue-600 border-blue-100' };
    if (days <= 7) return { label: t.minor, color: 'bg-amber-50 text-amber-600 border-amber-100' };
    if (days <= 15) return { label: t.warning, color: 'bg-orange-50 text-orange-600 border-orange-100' };
    if (days <= 30) return { label: t.severe, color: 'bg-rose-50 text-rose-600 border-rose-100' };
    return { label: t.critical, color: 'bg-red-600 text-white border-red-700 shadow-lg' };
  };

  const columns: Column<Invoice>[] = [
    { header: t.id, key: 'id', accessor: (row) => <span className="font-mono font-bold text-slate-800 dark:text-slate-200">#{row.id}</span> },
    { header: t.customerName, key: 'customer', accessor: (row) => row.customerDisplayName || row.customerName },
    {
      header: t.balanceTracking, key: 'finance', accessor: (row) => {
        const paidTotal = row.payments.reduce((sum, p) => sum + p.amount, 0);
        const percent = Math.min((paidTotal / row.amount) * 100, 100);
        return (
          <div className="flex flex-col min-w-[140px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-black text-slate-900 dark:text-white text-sm italic">{formatPrice(paidTotal)}</span>
              <span className="text-[10px] text-slate-400 font-bold">/ {formatPrice(row.amount)}</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div className="bg-blue-600 h-full transition-all duration-1000" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      }
    },
    {
      header: t.riskStatus, key: 'days', accessor: (row) => {
        const matched = overdueOrders.find(item => String(item.orderId) === row.id);
        const days = matched?.daysOverdue ?? 0;
        const ui = getRiskUI(days, row.status);
        return (
          <span className={`px-4 py-1.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${ui.color}`}>
            {ui.label}
          </span>
        );
      }
    },
    {
      header: t.history, key: 'freq', accessor: (row) => (
        <button
          onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === row.id ? null : row.id); }}
          className="flex items-center text-[10px] font-black text-blue-600 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 transition-all shadow-sm active:scale-95"
        >
          <History size={12} className="mr-2" />
          {row.payments.length} {t.history}
        </button>
      )
    },
  ];

  return (
    <div className="space-y-8 pb-12">
      <CommercialOpsPanel />

      {/* Dynamic Overdue Ticker */}
      <div className="bg-slate-900 dark:bg-black h-14 flex items-center overflow-hidden rounded-[24px] shadow-2xl border border-slate-800">
        <div className="bg-rose-600 h-full px-4 md:px-8 flex items-center z-10 border-r border-rose-500 shadow-lg">
          <Megaphone size={20} className="text-white animate-bounce" />
          <span className="text-white text-[12px] font-black uppercase ml-4 whitespace-nowrap tracking-widest">{t.overdueAlert}</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex whitespace-nowrap animate-[ticker_60s_linear_infinite] hover:[animation-play-state:paused] items-center h-full">
            {stats.tickerItems.length > 0 ? (
              [...stats.tickerItems, ...stats.tickerItems].map((item, i) => (
                <span key={i} className="text-slate-200 font-bold text-sm mx-16 flex items-center group cursor-default">
                  <Zap size={14} className="mr-3 text-rose-400 group-hover:scale-125 transition-transform" />
                  {item}
                  <span className="ml-16 text-slate-700 font-black opacity-30">///</span>
                </span>
              ))
            ) : (
              <span className="text-emerald-400 font-black text-[10px] mx-16 uppercase tracking-[0.2em]">{t.tickerNoOverdue}</span>
            )}
          </div>
        </div>
        <div className="hidden sm:flex bg-slate-800 dark:bg-slate-900 h-full px-4 md:px-8 items-center z-10 border-l border-slate-700">
          <span className="text-white/40 text-[10px] font-black uppercase whitespace-nowrap mr-3">{t.totalOverdue}</span>
          <span className="text-rose-400 text-lg font-black italic tracking-tighter">{formatPrice(stats.totalOverdueAmount)}</span>
        </div>
      </div>

      <style>{`@keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter leading-none italic uppercase">{t.risk}</h1>
          <p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.3em] mt-3 opacity-60">{t.crmSub}</p>
        </div>
        <button className="flex items-center px-8 py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-[24px] font-black text-sm shadow-2xl hover:scale-105 active:scale-95 transition-all">
          <Receipt size={18} className="mr-3" />
          {t.performanceReport}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white dark:bg-slate-900 p-10 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group hover:shadow-2xl transition-all duration-500">
          <div className="absolute top-0 right-0 w-48 h-48 bg-rose-50 dark:bg-rose-900/10 rounded-full -mr-24 -mt-24 group-hover:scale-150 transition-transform duration-700"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-10">
              <div className="p-5 bg-rose-600 text-white rounded-3xl shadow-xl"><ShieldAlert size={32} /></div>
              <div className="text-right">
                <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">{t.globalExposure}</p>
                <span className="px-3 py-1 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-[10px] font-black rounded-full border border-rose-100 dark:border-rose-800">{t.critical}</span>
              </div>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center">
              {t.overduePayments}
              <ArrowRight size={14} className="ml-2 text-rose-400 group-hover:translate-x-2 transition-transform" />
            </p>
            <div className="flex items-baseline space-x-2">
              <span className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic">{formatPrice(stats.totalOverdueAmount)}</span>
              <span className="text-[10px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-900/20 px-2 py-0.5 rounded">+12.5%</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 dark:bg-slate-950 p-10 rounded-[40px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-40 h-40 bg-blue-600/10 rounded-full -mr-20 -mt-20 blur-3xl"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-10">
              <div className="p-5 bg-blue-600 text-white rounded-3xl shadow-xl"><Clock size={32} /></div>
            </div>
            <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3">{t.longestDelay}</p>
            <p className="text-5xl font-black text-white tracking-tighter italic">{stats.maxDays} <span className="text-xl font-bold ml-2 not-italic opacity-40 uppercase">{t.days}</span></p>
            <div className="mt-6 flex items-center p-4 bg-white/5 rounded-2xl border border-white/5">
              <div className="w-8 h-8 rounded-lg bg-blue-400/20 flex items-center justify-center text-blue-400 mr-4"><Zap size={16} /></div>
              <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest truncate">{stats.maxDaysCustomer}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-10 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group hover:shadow-2xl transition-all duration-500">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 dark:bg-emerald-900/10 rounded-full -mr-16 -mt-16"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-10">
              <div className="p-5 bg-emerald-500 text-white rounded-3xl shadow-xl"><TrendingDown size={32} /></div>
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t.expectedToday}</p>
            <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{formatPrice(summary?.dueSoonAmount || 0)}</p>
            <div className="mt-8 flex gap-2 items-center">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">{`${summary?.dueSoonCount || 0} ${t.activeSettlement}`}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[40px] border border-slate-200 dark:border-slate-800 shadow-sm p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-black uppercase tracking-widest text-slate-800 dark:text-white">{t.managementBlindspots}</h2>
            <p className="text-[10px] text-slate-400 font-bold mt-2 uppercase tracking-widest">{t.blindspotSubtitle}</p>
          </div>
          <Megaphone size={18} className="text-rose-500" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {blindSpots.map((spot, idx) => (
            <div key={idx} className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
              <p className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">{spot.title}</p>
              <p className="text-sm font-bold text-rose-600 mt-2">{spot.impact}</p>
              <p className="text-[10px] text-slate-400 font-bold mt-3 uppercase">{spot.action}</p>
            </div>
          ))}
        </div>
      </div>

      <DataTable
        tableId="invoices"
        title={t.paymentRiskLedger}
        columns={columns}
        data={invoices}
        onRowClick={(row) => setExpandedId(expandedId === row.id ? null : row.id)}
      />
    </div>
  );
};

export default RiskControl;

