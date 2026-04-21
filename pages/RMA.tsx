
import React, { useCallback, useState, useEffect } from 'react';
import {
  RotateCcw,
  TrendingDown,
  ClipboardList
} from 'lucide-react';
import DataTable, { Column } from '../components/DataTable';
import { rmaService } from '../services/rma.service';
import { RmaRecord, RmaStatus } from '../types';
import { useAppContext } from '../app/AppContext';
import { isCanceledApiError } from '../utils/api';

const RMA: React.FC = () => {
  const { t } = useAppContext();
  const [data, setData] = useState<RmaRecord[]>([]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await rmaService.getAll({ signal });
      setData(result || []);
    } catch (error) {
      if (isCanceledApiError(error)) return;
      console.error('Failed to load RMA data:', error);
      setData([]); // Shield against undefined/null
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const columns: Column<RmaRecord>[] = [
    { header: t.rmaTitle || '编号', key: 'id', accessor: (row) => <span className="font-mono font-bold">#{row.id}</span> },
    { header: t.orderRef || '关联订单', key: 'order', accessor: 'orderNo' },
    { header: t.customerName || '申请商', key: 'customer', accessor: (row: RmaRecord) => row.customerDisplayName || row.customerName },
    {
      header: t.rmaReason || '详细原因', key: 'reason', accessor: (row: RmaRecord) => (
        <span className="text-xs font-medium truncate max-w-[180px] block" title={row.reason}>{row.reason || '-'}</span>
      )
    },
    {
      header: t.rmaType || '业务类型', key: 'type', accessor: (row: RmaRecord) => (
        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${row.type === 'refund' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
          row.type === 'exchange' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
            'bg-slate-50 text-slate-600 border border-slate-100'
          }`}>
          {row.type || 'N/A'}
        </span>
      )
    },
    {
      header: t.status || '审核状态', key: 'status', accessor: (row: RmaRecord) => (
        <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest ${row.status === RmaStatus.APPROVED ? 'bg-emerald-500 text-white' :
          row.status === RmaStatus.REJECTED ? 'bg-rose-500 text-white' :
            'bg-amber-100 text-amber-700 border border-amber-200'
          }`}>
          {row.status === RmaStatus.APPROVED ? (t.verified || '已通过') : row.status === RmaStatus.REJECTED ? (t.commRejected || '已拒绝') : (t.pending || '待审核')}
        </span>
      )
    },
  ];

  return (
    <div className="space-y-10 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic uppercase bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{t.rma || '售后系统'}</h1>
          <p className="text-rose-600 dark:text-rose-400 font-black text-[10px] uppercase tracking-[0.3em] mt-3 opacity-70 px-1">{t.rmaSub || 'RMA & RETURNS MANAGEMENT'}</p>
        </div>
        <button className="flex items-center px-8 py-4 bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white rounded-[26px] font-black text-xs uppercase tracking-widest shadow-2xl hover:scale-105 transition-all">
          <RotateCcw size={18} className="mr-3" />
          {t.rmaClaim || '提交申请'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 dark:bg-indigo-900/10 rounded-full -mr-16 -mt-16 group-hover:scale-[1.8] transition-transform duration-1000"></div>
          <div className="relative z-10 flex items-center space-x-6 mb-8">
            <div className="p-4 bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-[22px] shadow-xl group-hover:rotate-6 transition-transform"><TrendingDown size={28} /></div>
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">{t.returnRate || '售后率分析'}</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5 flex items-center">
                {t.rmaReturnRateSub || 'RETURN QUOTA'}: <span className="text-indigo-600 dark:text-indigo-400 ml-1.5 italic">{(Math.min((data.length / (data.length + 200)) * 100, 100)).toFixed(2)}%</span>
              </p>
            </div>
          </div>
          <div className="relative h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${Math.min(data.length * 2, 100)}%` }} />
          </div>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-center justify-between group gap-6">
          <div className="flex items-center space-x-6 w-full md:w-auto">
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-[22px] group-hover:scale-110 transition-transform"><ClipboardList size={28} /></div>
            <div>
              <h3 className="text-xl font-black text-slate-800 dark:text-white tracking-tight uppercase italic">{t.pendingActions || '待审批'}</h3>
              <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">
                {data.filter(r => r.status === RmaStatus.IN_REVIEW).length} {t.rmaPendingSub || 'URGENT REVIEW'}
              </p>
            </div>
          </div>
          <button className="w-full md:w-auto px-8 py-4 text-emerald-700 dark:text-emerald-400 font-black bg-emerald-50 dark:bg-emerald-950/30 rounded-[22px] hover:bg-emerald-100 transition-all text-[10px] uppercase tracking-widest active-shrink">
            {t.auditNow || '立即审批'}
          </button>
        </div>
      </div>

      <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden">
        <DataTable tableId="rma_final_v2" title={t.rmaTitle || '售后处理流水'} columns={columns} data={data} />
      </div>
    </div>
  );
};

export default RMA;


