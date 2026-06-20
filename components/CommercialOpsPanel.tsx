import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, ClipboardCheck, Database, PlayCircle, RefreshCw } from 'lucide-react';
import api, { isCanceledApiError } from '../utils/api';

type BiSummary = {
  orders: number;
  revenue: number;
  customers: number;
  lowStock: number;
  pendingWorkflow: number;
};

type WorkflowTask = {
  id: number;
  document_type: string;
  document_id: string;
  node_code: string;
  created_at: string;
};

type NotificationRow = {
  id: number;
  title: string;
  message: string;
  severity: string;
  is_read: boolean | number;
  created_at: string;
};

const severityLabel: Record<string, string> = {
  info: '提醒',
  warning: '预警',
  error: '异常',
  critical: '严重',
};

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
    <p className="text-[12px] font-bold text-slate-600 dark:text-slate-300">{label}</p>
    <div className="mt-1 text-xl font-black text-slate-900 dark:text-white">{value}</div>
  </div>
);

const CommercialOpsPanel: React.FC = () => {
  const [summary, setSummary] = useState<BiSummary | null>(null);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [bi, taskRes, notificationRes] = await Promise.all([
        api.get<unknown, { data: BiSummary }>('/commercial/bi/summary', { signal }),
        api.get<unknown, { data: WorkflowTask[] }>('/commercial/workflow/tasks', { signal }),
        api.get<unknown, { data: NotificationRow[] }>('/commercial/notifications', { signal }),
      ]);
      setSummary(bi.data);
      setTasks(taskRes.data);
      setNotifications(notificationRes.data);
    } catch (error) {
      if (!isCanceledApiError(error)) {
        console.warn('commercial ops load failed', error);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, []);

  const approveTask = async (taskId: number) => {
    await api.post(`/commercial/workflow/tasks/${taskId}/actions`, { action: 'approve', comment: '前端工作台审批通过' });
    await load();
  };

  const runAlerts = async () => {
    await api.post('/commercial/alerts/run', {});
    await load();
  };

  const unread = notifications.filter((item) => !item.is_read).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black text-blue-600 dark:text-blue-300">商业运营闭环</p>
          <h3 className="mt-1 text-lg font-black text-slate-900 dark:text-white">运营看板、通知与待办</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <RefreshCw size={15} className="mr-2" />
            刷新
          </button>
          <button
            type="button"
            onClick={runAlerts}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            <PlayCircle size={15} className="mr-2" />
            执行预警
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Stat label="订单" value={summary?.orders ?? '--'} />
        <Stat label="客户" value={summary?.customers ?? '--'} />
        <Stat label="低库存" value={summary?.lowStock ?? '--'} />
        <Stat label="待审批" value={summary?.pendingWorkflow ?? '--'} />
        <Stat label="未读通知" value={unread} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
            <ClipboardCheck size={16} className="text-blue-600" />
            审批待办
          </div>
          <div className="space-y-2">
            {tasks.slice(0, 5).map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{task.document_type} / {task.document_id}</p>
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{task.node_code}</p>
                </div>
                <button type="button" onClick={() => approveTask(task.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white">
                  <CheckCircle2 size={13} className="mr-1 inline" />
                  通过
                </button>
              </div>
            ))}
            {tasks.length === 0 ? <p className="text-sm font-bold text-slate-600 dark:text-slate-300">暂无待审批任务</p> : null}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800 dark:text-slate-100">
            <Bell size={16} className="text-amber-600" />
            站内通知
          </div>
          <div className="space-y-2">
            {notifications.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.title}</p>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-600 dark:bg-slate-900 dark:text-slate-300">{severityLabel[item.severity] || item.severity}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs font-bold text-slate-600 dark:text-slate-300">{item.message}</p>
              </div>
            ))}
            {notifications.length === 0 ? <p className="text-sm font-bold text-slate-600 dark:text-slate-300">暂无通知</p> : null}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
        <Database size={14} />
        当前为运营待办与提醒工作台，审批结果不会自动反写订单、采购、库存或财务单据。
      </div>
    </section>
  );
};

export default CommercialOpsPanel;
