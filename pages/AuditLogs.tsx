import React, { useState, useEffect } from 'react';
import DataTable, { Column } from '../components/DataTable';
import { ShieldCheck, User, Clock, Search, Filter } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { auditService, AuditLog } from '../services/audit.service';
import { isCanceledApiError } from '../utils/api';

const AuditLogs = () => {
    const { t } = useAppContext();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [meta, setMeta] = useState({ page: 1, total: 0, totalPages: 0 });

    const fetchLogs = (page = 1, signal?: AbortSignal) => {
        auditService.getLogs({ page, pageSize: 20 }, { signal })
            .then(res => {
                if (signal?.aborted) return;
                setLogs(res.data);
                setMeta({ page: res.meta.page, total: res.meta.total, totalPages: res.meta.totalPages });
            })
            .catch((error) => {
                if (isCanceledApiError(error)) return;
                console.error('Failed to load audit logs:', error);
            });
    };

    useEffect(() => {
        const controller = new AbortController();
        fetchLogs(1, controller.signal);
        return () => controller.abort();
    }, []);

    const columns: Column<AuditLog>[] = [
        {
            header: t.operator || '操作人',
            key: 'user',
            accessor: (row) => (
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                        <User size={14} />
                    </div>
                    <span className="font-bold text-xs">{row.user?.username || 'System'}</span>
                </div>
            )
        },
        {
            header: t.actionType || '操作类型',
            key: 'action',
            accessor: (row) => (
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${row.action === 'CREATE' ? 'bg-emerald-50 text-emerald-600' :
                    row.action === 'UPDATE' ? 'bg-blue-50 text-blue-600' :
                        row.action === 'DELETE' ? 'bg-rose-50 text-rose-600' :
                            'bg-slate-50 text-slate-600'
                    }`}>
                    {row.action}
                </span>
            )
        },
        { header: t.resourceType || '资源', key: 'resource', accessor: 'resource' },
        {
            header: t.details || '详情',
            key: 'details',
            accessor: (row) => (
                <span className="text-xs text-slate-500 truncate max-w-[300px] block" title={row.details}>
                    {row.details}
                </span>
            )
        },
        {
            header: t.ipAddress || 'IP地址',
            key: 'ip',
            accessor: 'ipAddress'
        },
        {
            header: t.timestamp || '时间',
            key: 'createdAt',
            accessor: (row) => (
                <div className="flex items-center text-slate-400 text-[10px] font-medium">
                    <Clock size={10} className="mr-1" />
                    {new Date(row.createdAt).toLocaleString()}
                </div>
            )
        },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center">
                        <ShieldCheck size={28} className="mr-3 text-blue-600" />
                        {t.audit || '审计日志'}
                    </h1>
                    <p className="text-slate-500 font-medium">查看系统内所有的操作记录与安全审计轨迹</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center shadow-sm w-full sm:w-auto">
                        <Search size={16} className="text-slate-400 mr-2" />
                        <input type="text" placeholder={t.phSearchAudit} className="bg-transparent border-none focus:ring-0 text-xs w-full sm:w-48 font-bold" />
                    </div>
                    <button className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-blue-600 transition-all">
                        <Filter size={18} />
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                <DataTable
                    tableId="audit"
                    columns={columns}
                    data={logs}
                    title="系统操作列表"
                />
                <div className="p-6 border-t border-slate-50 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                        Showing {(meta.page - 1) * 20 + 1} to {Math.min(meta.page * 20, meta.total)} of {meta.total} events
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            disabled={meta.page === 1}
                            onClick={() => fetchLogs(meta.page - 1)}
                            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-black disabled:opacity-30"
                        >
                            Previous
                        </button>
                        <button
                            disabled={meta.page >= meta.totalPages}
                            onClick={() => fetchLogs(meta.page + 1)}
                            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-black disabled:opacity-30"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AuditLogs;

