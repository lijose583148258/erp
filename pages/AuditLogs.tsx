import React, { useState, useEffect, useCallback } from 'react';
import DataTable, { Column } from '../components/DataTable';
import { ShieldCheck, User, Clock, Search, Filter } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';
import { auditService, AuditLog } from '../services/audit.service';
import { isCanceledApiError } from '../utils/api';

const AuditLogs = () => {
    const { t, notify } = useAppContext();
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [meta, setMeta] = useState({ page: 1, total: 0, totalPages: 0 });
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState('');

    const fetchLogs = useCallback((page = 1, signal?: AbortSignal) => {
        setIsLoading(true);
        setLoadError('');
        auditService.getLogs({ page, pageSize: 20 }, { signal })
            .then(res => {
                if (signal?.aborted) return;
                setLogs(res.data);
                setMeta({ page: res.meta.page, total: res.meta.total, totalPages: res.meta.totalPages });
            })
            .catch((error) => {
                if (isCanceledApiError(error)) return;
                const message = error instanceof Error ? error.message : '审计日志加载失败，请刷新后再核对';
                setLoadError(message);
                notify('error', message);
            })
            .finally(() => {
                if (!signal?.aborted) setIsLoading(false);
            });
    }, [notify]);

    useEffect(() => {
        const controller = new AbortController();
        fetchLogs(1, controller.signal);
        return () => controller.abort();
    }, [fetchLogs]);

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
                <span className={`px-2 py-0.5 rounded-lg text-xs font-black uppercase tracking-widest ${row.action === 'CREATE' ? 'bg-emerald-50 text-emerald-600' :
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
                <div className="flex items-center text-slate-400 text-xs font-medium">
                    <Clock size={10} className="mr-1" />
                    {new Date(row.createdAt).toLocaleString()}
                </div>
            )
        },
    ];

    return (
        <div className="space-y-6">
            <DocumentInputGuide
                testId="audit-log-input-guide"
                eyebrow="审计日志 / 只读追溯路线"
                title="这里负责查证据，不负责改业务"
                description="审计日志是系统的黑匣子。它只做筛选、查看、追溯和导出，不应该产生业务写入。后续排查乱码、权限、回款、库存、调账问题时，先从这里确认操作人、时间、动作和对象，再回到对应业务单据处理。"
                tone="blue"
                steps={[
                    { title: '筛选范围', description: '按操作人、动作、时间、模块筛选。', badge: '筛选' },
                    { title: '查看证据', description: '确认操作对象、结果、IP/会话和错误信息。', badge: '证据' },
                    { title: '回到业务单据', description: '只定位问题，不在审计页直接修数据。', badge: '回链' },
                    { title: '导出复核', description: '需要对账或追责时导出日志留档。', badge: '留档' },
                ]}
                boundaries={[
                    { title: '本区负责', items: ['操作记录', '权限变更记录', '异常追踪', '证据导出'] },
                    { title: '本区禁止', items: ['修改业务数据', '删除日志', '替代审批', '替代回滚'] },
                ]}
                evidence={['日志可筛选', '动作可追溯', '对象可定位', '不产生业务写入']}
            />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center">
                        <ShieldCheck size={28} className="mr-3 text-blue-600" />
                        {t.audit || '审计日志'}
                    </h1>
                    <p className="text-slate-500 font-medium">查看系统内所有的操作记录与安全审计轨迹</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="min-h-8 bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center shadow-sm w-full sm:w-auto">
                        <Search size={16} className="text-slate-400 mr-2" />
                        <input type="text" aria-label="搜索审计日志" title="搜索审计日志" placeholder={t.phSearchAudit} className="min-h-8 bg-transparent border-none focus:ring-0 text-xs w-full sm:w-48 font-bold" />
                    </div>
 <button type="button" aria-label="筛选审计日志" title="筛选审计日志" className="inline-flex min-h-8 min-w-8 items-center justify-center p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-blue-600 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none">
                        <Filter size={18} />
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                {loadError && (
                    <div className="mx-6 mt-6 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                        {loadError}
                    </div>
                )}
                <DataTable
                    tableId="audit"
                    columns={columns}
                    data={logs}
                    isLoading={isLoading}
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

