import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Beaker, BellRing, ClipboardCheck, FlaskConical, Plus, ShieldCheck } from 'lucide-react';
import DataTable, { Column } from '../components/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useAppContext } from '../app/AppContext';
import { customerService } from '../src/services/customer.service';
import { sampleService } from '../services/sample.service';
import { SampleRecord, SampleStatus } from '../types';
import { getCustomerDisplayName } from '../utils/customerName';
import { isCanceledApiError } from '../utils/api';

const inputClass = 'rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:bg-slate-950 dark:text-white';

const Samples: React.FC = () => {
  const { t, notify, language } = useAppContext();
  const [samples, setSamples] = useState<SampleRecord[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; label: string }>>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState({
    customerId: '',
    productName: '',
    specifications: '',
    quantity: '1',
    shippingAddress: '',
  });

  useEffect(() => {
    const controller = new AbortController();
    sampleService
      .getAll({ signal: controller.signal })
      .then(setSamples)
      .catch((error) => {
        if (isCanceledApiError(error)) return;
        notify('error', t.loadDataFail || '样品数据加载失败');
      });
    return () => controller.abort();
  }, [notify, t.loadDataFail]);

  useEffect(() => {
    const controller = new AbortController();
    customerService
      .getAll({ signal: controller.signal })
      .then(list => {
        setCustomers(list.map(customer => ({
          id: String(customer.id),
          label: getCustomerDisplayName(customer, language),
        })));
      })
      .catch((error) => {
        if (isCanceledApiError(error)) return;
        notify('error', t.loadDataFail || '客户数据加载失败');
      });
    return () => controller.abort();
  }, [language, notify, t.loadDataFail]);

  const handleImport = async (newData: SampleRecord[]) => {
    try {
      const createdRecords = await Promise.all(newData.map(item => sampleService.create({
        ...item,
        status: item.status || SampleStatus.REQUESTED,
        requestDate: item.requestDate || new Date().toISOString().split('T')[0],
      })));
      setSamples(prev => [...createdRecords, ...prev]);
      notify('success', (t.sampleImportSuccess || '已导入 {count} 条样品记录').replace('{count}', String(createdRecords.length)));
    } catch {
      notify('error', t.sampleImportFail || '样品导入失败');
    }
  };

  const handleCreate = async () => {
    if (!draft.customerId) {
      notify('warning', t.selectCustomerRequired || '请选择客户');
      return;
    }
    if (!draft.productName.trim()) {
      notify('warning', t.productNameRequired || '请填写产品名称');
      return;
    }

    setSubmitting(true);
    try {
      const customer = customers.find(item => item.id === draft.customerId);
      const created = await sampleService.create({
        customerId: draft.customerId,
        customerName: customer?.label || '',
        customerDisplayName: customer?.label || '',
        productName: draft.productName.trim(),
        specifications: draft.specifications.trim() || '-',
        quantity: draft.quantity,
        shippingAddress: draft.shippingAddress.trim() || undefined,
      });
      setSamples(prev => [created, ...prev]);
      setDraft({
        customerId: '',
        productName: '',
        specifications: '',
        quantity: '1',
        shippingAddress: '',
      });
      setShowCreateForm(false);
      notify('success', t.sampleRequestCreated || '样品申请已创建');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : (t.sampleRequestCreateFail || '样品申请创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: Column<SampleRecord>[] = [
    { header: t.sampleTicket, key: 'id', accessor: (row) => <span className="font-mono font-bold text-slate-400">#{row.id}</span> },
    { header: t.customerName, key: 'customer', accessor: (row) => getCustomerDisplayName({
      name: row.customerName,
      nameZh: row.customerNameZh,
      nameEn: row.customerNameEn,
      nameVi: row.customerNameVi,
      displayName: row.customerDisplayName,
    }, language) },
    {
      header: t.sampleProduct, key: 'product', accessor: (row) => (
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl shrink-0 dark:bg-blue-900/30"><Beaker size={14} /></div>
          <div className="flex flex-col min-0">
            <span className="font-bold text-slate-800 dark:text-white truncate tracking-tight">{row.productName}</span>
            <span className="text-xs text-slate-500 italic truncate tracking-tight opacity-70 dark:text-slate-400" title={row.specifications}>{row.specifications}</span>
          </div>
        </div>
      ),
    },
    {
      header: t.status, key: 'status', accessor: (row) => (
        <StatusBadge status={row.status} label={t[`sample${row.status.charAt(0).toUpperCase() + row.status.slice(1)}`] || row.status} className="rounded-xl" />
      ),
    },
    {
      header: t.sampleFollowup, key: 'followup', accessor: (row) => (
        <div className="flex items-center">
          {row.needsFollowUp ? (
            <div className="flex items-center text-amber-600 bg-amber-50 px-2 py-1 rounded-xl border border-amber-100 animate-pulse dark:bg-amber-900/30">
              <BellRing size={12} className="mr-1.5" />
              <span className="text-xs font-black">{t.feedbackReq} ({row.followUpDate})</span>
            </div>
          ) : row.status === SampleStatus.FEEDBACK ? (
            <div className="flex items-center text-emerald-600">
              <ClipboardCheck size={16} className="mr-1.5" />
              <span className="text-xs font-black tracking-wide">{t.received}</span>
            </div>
           ) : <span className="text-slate-300">-</span>}
        </div>
      ),
    },
  ];

  const sampleStats = useMemo(() => {
    const total = samples.length;
    const waitingFollowUp = samples.filter(item => item.status === SampleStatus.SENT && item.needsFollowUp).length;
    const feedbackDone = samples.filter(item => item.status === SampleStatus.FEEDBACK).length;
    const feedbackRate = total ? Math.round((feedbackDone / total) * 100) : null;
    return { total, waitingFollowUp, feedbackDone, feedbackRate };
  }, [samples]);

  return (
    <div className="space-y-10 pb-16 ">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{t.samples}</h1>
          <p className="text-emerald-600 dark:text-emerald-400 font-black text-xs tracking-wide mt-3 opacity-70 px-1">{t.sampleTitle}</p>
        </div>
        <button data-testid="samples-open-create" onClick={() => setShowCreateForm(current => !current)} className="flex items-center px-8 py-4 bg-blue-600 text-white rounded-[26px] font-black text-xs tracking-wide shadow-2xl shadow-blue-500/30 transition-colors ">
          <Plus size={18} className="mr-3" />
          {t.newSampleRequest}
        </button>
      </div>

      <section data-testid="samples-boundary-notice" className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-teal-100 bg-teal-50/80 p-5 text-sm font-bold leading-6 text-teal-900 dark:border-teal-900/40 dark:bg-teal-950/20 dark:text-teal-100">
          <div className="mb-2 flex items-center gap-2 text-xs font-black tracking-[0.16em] text-teal-600 dark:text-teal-200">
            <ShieldCheck size={14} />
            样品主入口
          </div>
          本页只登记样品申请、寄样、客户测试反馈和跟进提醒，不在这里直接生成销售订单、扣库存或做回款。
        </div>
        <div className="rounded-[28px] border border-blue-100 bg-blue-50/80 p-5 text-sm font-bold leading-6 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
          <div className="mb-2 text-xs font-black tracking-[0.16em] text-blue-600 dark:text-blue-200">正确闭环</div>
          样品通过后再转销售订单；寄样出库走发货/仓储记录；客户反馈有异常时再进入售后或差异处理。
        </div>
        <div className="rounded-[28px] border border-slate-100 bg-white/80 p-5 text-sm font-bold leading-6 text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          <div className="mb-2 text-xs font-black tracking-[0.16em] text-slate-400">真实口径</div>
          样品看板只展示当前记录回读出来的待跟进、已反馈和总申请数，不再用固定百分比装饰。
        </div>
      </section>

      {showCreateForm && (
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[36px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">{t.newSampleRequest}</h2>
            </div>
            <button onClick={() => setShowCreateForm(false)} className="rounded-[18px] border border-slate-200 px-4 py-2 text-xs font-black text-slate-500">{t.cancel}</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.customer}</span>
              <select data-testid="samples-create-customer" value={draft.customerId} onChange={(e) => setDraft(prev => ({ ...prev, customerId: e.target.value }))} className={inputClass}>
                <option value="">{t.phSelectCustomer}</option>
                {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.sampleProduct}</span>
              <input data-testid="samples-create-product" value={draft.productName} onChange={(e) => setDraft(prev => ({ ...prev, productName: e.target.value }))} className={inputClass} placeholder="e.g. Glue A-01" />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.packagingSpec}</span>
              <input data-testid="samples-create-specifications" value={draft.specifications} onChange={(e) => setDraft(prev => ({ ...prev, specifications: e.target.value }))} className={inputClass} placeholder="e.g. 25kg/drum" />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.quantity}</span>
              <input data-testid="samples-create-quantity" type="number" min="1" value={draft.quantity} onChange={(e) => setDraft(prev => ({ ...prev, quantity: e.target.value }))} className={inputClass} />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200 md:col-span-2">
              <span>{t.shippingAddress}</span>
              <input data-testid="samples-create-address" value={draft.shippingAddress} onChange={(e) => setDraft(prev => ({ ...prev, shippingAddress: e.target.value }))} className={inputClass} placeholder={t.phNote} />
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowCreateForm(false)} className="rounded-[18px] border border-slate-200 px-5 py-3 text-sm font-black text-slate-500">{t.cancel}</button>
            <button data-testid="samples-create-submit" onClick={() => void handleCreate()} disabled={submitting} className="rounded-[18px] bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-xl shadow-blue-500/25 disabled:opacity-60">
              {submitting ? t.submitting : t.ctrlConfirm}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 bg-gradient-to-br from-indigo-900 to-slate-900 rounded-[44px] p-10 text-white relative overflow-hidden shadow-2xl shadow-indigo-900/10 group transition-colors ">
          <div className="absolute top-0 right-0 w-80 h-80 bg-blue-400/10 rounded-full -mr-40 -mt-40 blur-3xl "></div>
          <div className="relative z-10 flex flex-col h-full justify-between">
            <div className="flex items-start space-x-6">
              <div className="p-5 bg-white/10 rounded-[28px] backdrop-blur-md border border-white/20 shadow-inner ">
                <FlaskConical size={32} className="text-white animate-pulse" />
              </div>
              <div>
                <h3 className="text-2xl font-black tracking-tighter italic">{t.sampleHub}</h3>
                <p className="text-indigo-200 text-xs mt-3 max-w-lg leading-relaxed font-bold tracking-wide opacity-80">
                  当前共有 <span className="text-white text-xl underline decoration-amber-400 underline-offset-8 font-black">{sampleStats.total}</span> 条样品申请，其中 <span className="text-white text-xl underline decoration-amber-400 underline-offset-8 font-black">{sampleStats.waitingFollowUp}</span> 条需要跟进。
                </p>
              </div>
            </div>
            <div className="mt-10 flex flex-wrap gap-4">
              <button onClick={() => notify('info', t.sampleSprintInfo)} className="px-8 py-4 bg-white text-indigo-900 rounded-[22px] font-black text-xs tracking-wide shadow-xl transition-colors ">
                {t.sampleSprint}
              </button>
              <button onClick={() => notify('info', t.sampleAnalyticsInfo)} className="px-8 py-4 bg-white/10 text-white border border-white/20 rounded-[22px] font-black text-xs tracking-wide hover:bg-white/20 transition-colors backdrop-blur-sm">
                {t.viewAnalytics}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] flex flex-col justify-center relative overflow-hidden group">
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-50 dark:bg-emerald-900/10 rounded-full transition-colors "></div>
          <div className="relative z-10">
            <div className="p-4 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-[22px] w-fit mb-8 shadow-sm "><ArrowUpRight size={28} /></div>
            <p className="text-xs font-black text-slate-400 tracking-wide mb-2">反馈完成率</p>
            <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic">
              {sampleStats.feedbackRate === null ? '暂无' : `${sampleStats.feedbackRate}%`}
            </p>
            <p className="text-xs text-emerald-500 font-black mt-6 flex items-center bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1.5 rounded-full w-fit border border-emerald-100 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-2"></span>
              已反馈 {sampleStats.feedbackDone} / 总申请 {sampleStats.total}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden">
        <DataTable tableId="samples" title={t.sampleHistory} columns={columns} data={samples} onImport={handleImport} />
      </div>
    </div>
  );
};

export default Samples;
