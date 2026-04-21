import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Coins, Layers3, RefreshCcw } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import barterService, { BarterAgreement, BarterItem, BarterSettlement, BarterSummary, CreateBarterAgreementInput, CreateBarterBatchInput } from '../services/barter.service';
import { customerService } from '../services/customer.service';
import procurementService, { Supplier } from '../services/procurement.service';
import { orderService } from '../services/order.service';
import { getCustomerDisplayName } from '../utils/customerName';
import { isCanceledApiError } from '../utils/api';
import type { Customer, SalesOrder } from '../types';

type OrderOption = { id: string; label: string };

const fieldClass = 'w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-300';

const createItem = (side: 'our' | 'counterparty'): BarterItem => ({
  side,
  itemName: '',
  specification: '',
  unit: side === 'our' ? 'kg' : 'm3',
  quantity: 0,
  unitPrice: 0,
  qualityFactor: 1,
  lossFactor: 1,
  note: '',
});

const statusLabelMap: Record<string, string> = {
  draft: '草稿',
  active: '执行中',
  partial: '部分完成',
  completed: '已完成',
  closed: '已关闭',
  terminated: '已终止',
  quoted: '待审核',
  approved: '已审核',
  posted: '已过账',
  reversed: '已冲销',
};

const statusClass = (status: string) => {
  if (status === 'completed' || status === 'posted' || status === 'approved') return 'bg-emerald-50 text-emerald-700';
  if (status === 'partial' || status === 'active' || status === 'quoted') return 'bg-amber-50 text-amber-700';
  if (status === 'reversed' || status === 'terminated') return 'bg-rose-50 text-rose-700';
  return 'bg-slate-100 text-slate-600';
};

const buildPreview = (items: BarterItem[]) => {
  const getValue = (side: 'our' | 'counterparty') =>
    items.filter((item) => item.side === side).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0) * Number(item.qualityFactor || 1) * Number(item.lossFactor || 1), 0);
  const counterpartyValue = getValue('counterparty');
  const ourValue = getValue('our');
  return {
    counterpartyValue,
    ourValue,
    offsetAmount: Number(Math.min(counterpartyValue, ourValue).toFixed(2)),
    difference: Number((ourValue - counterpartyValue).toFixed(2)),
  };
};

const ItemEditor = ({
  title,
  item,
  onChange,
}: {
  title: string;
  item: BarterItem;
  onChange: (key: keyof BarterItem, value: string | number) => void;
}) => (
  <div className="rounded-[24px] border border-slate-100 bg-slate-50/80 p-4">
    <div className="mb-3 text-sm font-black text-slate-800">{title}</div>
    <div className="grid gap-3">
      <input value={item.itemName} onChange={(e) => onChange('itemName', e.target.value)} placeholder="品名" className={fieldClass} />
      <input value={item.specification || ''} onChange={(e) => onChange('specification', e.target.value)} placeholder="规格" className={fieldClass} />
      <div className="grid grid-cols-3 gap-3">
        <input type="number" value={item.quantity} onChange={(e) => onChange('quantity', Number(e.target.value || 0))} placeholder="数量" className={fieldClass} />
        <input value={item.unit} onChange={(e) => onChange('unit', e.target.value)} placeholder="单位" className={fieldClass} />
        <input type="number" value={item.unitPrice} onChange={(e) => onChange('unitPrice', Number(e.target.value || 0))} placeholder="单价" className={fieldClass} />
      </div>
    </div>
  </div>
);

const BarterWorkspaceClean: React.FC = () => {
  const { formatPrice, notify, language } = useAppContext();
  const [summary, setSummary] = useState<BarterSummary | null>(null);
  const [agreements, setAgreements] = useState<BarterAgreement[]>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<BarterAgreement | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [agreementSubmitting, setAgreementSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const [agreementForm, setAgreementForm] = useState({
    customerId: '',
    supplierId: '',
    counterpartyName: '',
    orderId: '',
    settlementMode: 'mixed' as 'barter' | 'mixed' | 'cash_top_up' | 'cash_refund',
    currency: 'CNY',
    agreementDate: new Date().toISOString().slice(0, 10),
    valuationDate: new Date().toISOString().slice(0, 10),
    note: '',
    items: [createItem('counterparty'), createItem('our')],
  });

  const [batchForm, setBatchForm] = useState({
    orderId: '',
    valuationDate: new Date().toISOString().slice(0, 10),
    note: '',
    items: [createItem('counterparty'), createItem('our')],
  });

  const agreementPreview = useMemo(() => buildPreview(agreementForm.items), [agreementForm.items]);
  const batchPreview = useMemo(() => buildPreview(batchForm.items), [batchForm.items]);

  const customerOptions = customers.map((customer) => ({ id: String(customer.id), label: getCustomerDisplayName(customer, language) }));
  const summaryCards = [
    ['协议/批次', summary?.settlementCount ?? 0],
    ['待审核', summary?.quotedCount ?? 0],
    ['已审核', summary?.approvedCount ?? 0],
    ['已过账', summary?.postedCount ?? 0],
  ];

  const updateAgreementItem = (index: number, key: keyof BarterItem, value: string | number) => {
    setAgreementForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)) }));
  };

  const updateBatchItem = (index: number, key: keyof BarterItem, value: string | number) => {
    setBatchForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)) }));
  };

  const loadBase = useCallback(async (agreementId?: number | null, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [summaryData, agreementData, customerData, supplierData, orderData] = await Promise.all([
        barterService.getSummary({ signal }),
        barterService.listAgreements({ pageSize: 30 }, { signal }),
        customerService.getAll({ signal }),
        procurementService.getAllSuppliers('', { signal }),
        orderService.getAll({ signal }),
      ]);

      setSummary(summaryData ?? null);
      setAgreements(agreementData.items || []);
      setCustomers(customerData || []);
      setSuppliers(supplierData || []);
      setOrders((orderData || []).map((order: SalesOrder) => ({
        id: String(order.id),
        label: `${order.orderNo || order.id} / ${order.customerDisplayName || order.customerName || '未命名客户'}`,
      })));

      const targetAgreementId = agreementId ?? agreementData.items?.[0]?.id ?? null;
      if (targetAgreementId) {
        const detail = await barterService.getAgreementById(targetAgreementId, { signal });
        setSelectedAgreement(detail);
        setBatchForm((current) => ({ ...current, orderId: detail.orderId ? String(detail.orderId) : current.orderId }));
      } else {
        setSelectedAgreement(null);
      }
    } catch (error) {
      if (isCanceledApiError(error)) return;
      notify('error', error instanceof Error ? error.message : '加载货抵数据失败');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [notify]);

  useEffect(() => {
    const controller = new AbortController();
    void loadBase(null, controller.signal);
    return () => controller.abort();
  }, [loadBase]);

  const ensureValidItems = (items: BarterItem[]) => items.every((item) => item.itemName.trim() && Number(item.quantity) > 0 && Number(item.unitPrice) > 0);

  const handleCreateAgreement = async () => {
    if (!agreementForm.customerId || !agreementForm.counterpartyName.trim() || !ensureValidItems(agreementForm.items)) {
      notify('warning', '请完整填写客户、对方名称和协议标的');
      return;
    }

    const payload: CreateBarterAgreementInput = {
      counterpartyType: agreementForm.supplierId ? 'supplier' : 'customer',
      counterpartyName: agreementForm.counterpartyName.trim(),
      customerId: Number(agreementForm.customerId),
      supplierId: agreementForm.supplierId ? Number(agreementForm.supplierId) : null,
      orderId: agreementForm.orderId ? Number(agreementForm.orderId) : null,
      settlementMode: agreementForm.settlementMode,
      currency: agreementForm.currency,
      agreementDate: agreementForm.agreementDate,
      valuationDate: agreementForm.valuationDate,
      items: agreementForm.items.map((item) => ({ ...item, quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0) })),
    };
    if (agreementForm.note.trim()) {
      payload.note = agreementForm.note.trim();
    }

    setAgreementSubmitting(true);
    try {
      const created = await barterService.createAgreement(payload);
      notify('success', '货抵协议已创建');
      setAgreementForm({
        customerId: '',
        supplierId: '',
        counterpartyName: '',
        orderId: '',
        settlementMode: 'mixed',
        currency: 'CNY',
        agreementDate: new Date().toISOString().slice(0, 10),
        valuationDate: new Date().toISOString().slice(0, 10),
        note: '',
        items: [createItem('counterparty'), createItem('our')],
      });
      await loadBase(created.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建货抵协议失败');
    } finally {
      setAgreementSubmitting(false);
    }
  };

  const handleCreateBatch = async () => {
    if (!selectedAgreement || !ensureValidItems(batchForm.items)) {
      notify('warning', '请先选择协议并完整填写批次标的');
      return;
    }

    const payload: CreateBarterBatchInput = {
      orderId: batchForm.orderId ? Number(batchForm.orderId) : selectedAgreement.orderId ?? null,
      valuationDate: batchForm.valuationDate,
      items: batchForm.items.map((item) => ({ ...item, quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0) })),
    };
    if (batchForm.note.trim()) {
      payload.note = batchForm.note.trim();
    }

    setBatchSubmitting(true);
    try {
      await barterService.createBatch(selectedAgreement.id, payload);
      notify('success', '执行批次已创建');
      setBatchForm({
        orderId: selectedAgreement.orderId ? String(selectedAgreement.orderId) : '',
        valuationDate: new Date().toISOString().slice(0, 10),
        note: '',
        items: [createItem('counterparty'), createItem('our')],
      });
      await loadBase(selectedAgreement.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建执行批次失败');
    } finally {
      setBatchSubmitting(false);
    }
  };

  const handleApprove = async (settlement: BarterSettlement) => {
    try {
      await barterService.approve(settlement.id);
      notify('success', `批次 ${settlement.settlementNo} 已审核`);
      await loadBase(selectedAgreement?.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '审核批次失败');
    }
  };

  const handlePost = async (settlement: BarterSettlement) => {
    try {
      await barterService.post(settlement.id, {
        orderId: settlement.orderId ?? selectedAgreement?.orderId ?? null,
        postingAmount: Number(Math.min(settlement.totalPartyAValue || 0, settlement.totalPartyBValue || 0).toFixed(2)),
        offsetType: 'barter_offset',
      });
      notify('success', `批次 ${settlement.settlementNo} 已过账`);
      await loadBase(selectedAgreement?.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '过账批次失败');
    }
  };

  const handleReverse = async (settlement: BarterSettlement) => {
    const reason = window.prompt(`请输入 ${settlement.settlementNo} 的冲销原因`, '对方撤回 / 录入作废')?.trim();
    if (!reason) return;
    try {
      await barterService.reverse(settlement.id, reason);
      notify('success', `批次 ${settlement.settlementNo} 已冲销`);
      await loadBase(selectedAgreement?.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '冲销批次失败');
    }
  };

  return (
    <div className="space-y-8 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="rounded-[40px] bg-[#0B1020] p-8 text-white shadow-[0_30px_60px_rgba(15,23,42,0.24)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-200">
          <ArrowRightLeft size={14} />
          货抵协议 / 分批执行
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {summaryCards.map(([label, value]) => (
            <div key={String(label)} className="rounded-[28px] border border-white/10 bg-white/6 p-5">
              <div className="text-sm font-bold text-slate-300">{label}</div>
              <div className="mt-3 text-4xl font-black tracking-tight">{loading ? '...' : value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.02fr_0.98fr]">
        <section className="rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="flex items-center gap-3 text-2xl font-black tracking-tighter">
              <Layers3 size={22} className="text-blue-600" />
              新建货抵协议
            </h2>
            <button onClick={() => void loadBase(selectedAgreement?.id)} className="rounded-[18px] border border-slate-200 px-4 py-2 text-xs font-black text-slate-500 transition hover:border-blue-200 hover:text-blue-600">
              <RefreshCcw size={14} className="mr-2 inline-block" />
              刷新
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <select value={agreementForm.customerId} onChange={(e) => setAgreementForm({ ...agreementForm, customerId: e.target.value })} className={fieldClass}>
              <option value="">选择客户</option>
              {customerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <input value={agreementForm.counterpartyName} onChange={(e) => setAgreementForm({ ...agreementForm, counterpartyName: e.target.value })} placeholder="对方名称" className={fieldClass} />
            <select value={agreementForm.supplierId} onChange={(e) => setAgreementForm({ ...agreementForm, supplierId: e.target.value })} className={fieldClass}>
              <option value="">选择供应商（可选）</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierDisplayName || supplier.name}</option>)}
            </select>
            <select value={agreementForm.orderId} onChange={(e) => setAgreementForm({ ...agreementForm, orderId: e.target.value })} className={fieldClass}>
              <option value="">选择关联订单（可选）</option>
              {orders.map((order) => <option key={order.id} value={order.id}>{order.label}</option>)}
            </select>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ItemEditor title="协议对方总标的" item={agreementForm.items[0]} onChange={(key, value) => updateAgreementItem(0, key, value)} />
            <ItemEditor title="协议我方总标的" item={agreementForm.items[1]} onChange={(key, value) => updateAgreementItem(1, key, value)} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-slate-50 px-5 py-4">
            <div className="grid gap-1 text-sm font-bold text-slate-700">
              <div>协议可抵总额：{formatPrice(agreementPreview.offsetAmount)}</div>
              <div>协议差额（我方 - 对方）：{formatPrice(agreementPreview.difference)}</div>
            </div>
            <button onClick={() => void handleCreateAgreement()} disabled={agreementSubmitting} className="rounded-[20px] bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-3 text-sm font-black text-white shadow-xl shadow-blue-500/25 disabled:opacity-60">
              {agreementSubmitting ? '提交中...' : '创建协议'}
            </button>
          </div>
        </section>

        <section className="space-y-8">
          <div className="rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="mb-6 text-2xl font-black tracking-tighter">协议列表</div>
            <div className="space-y-3">
              {agreements.map((agreement) => (
                <button
                  key={agreement.id}
                  type="button"
                  onClick={async () => {
                    const detail = await barterService.getAgreementById(agreement.id);
                    setSelectedAgreement(detail);
                    setBatchForm((current) => ({ ...current, orderId: detail.orderId ? String(detail.orderId) : current.orderId }));
                  }}
                  className={`w-full rounded-[24px] border p-4 text-left ${selectedAgreement?.id === agreement.id ? 'border-blue-200 bg-blue-50/70' : 'border-slate-100 bg-slate-50/70'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{agreement.agreementNo}</div>
                      <div className="mt-1 text-xs font-bold text-slate-400">{agreement.counterpartyName}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusClass(agreement.status)}`}>{statusLabelMap[agreement.status] || agreement.status}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm font-bold text-slate-700">
                    <div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">已抵</div><div>{formatPrice(agreement.executedOffsetAmount)}</div></div>
                    <div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">待抵</div><div>{formatPrice(agreement.remainingOffsetAmount)}</div></div>
                    <div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">批次</div><div>{agreement.batchCount || 0}</div></div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl">
            <div className="mb-4 text-2xl font-black tracking-tighter">登记执行批次</div>
            {selectedAgreement ? (
              <>
                <div className="mb-4 rounded-[24px] bg-slate-950 p-5 text-white">
                  <div className="text-sm font-black">{selectedAgreement.agreementNo}</div>
                  <div className="mt-2 text-sm text-slate-300">{selectedAgreement.counterpartyName}</div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm font-bold">
                    <div><div className="text-xs text-slate-400">协议总额</div><div>{formatPrice(selectedAgreement.agreedOffsetAmount)}</div></div>
                    <div><div className="text-xs text-slate-400">累计已抵</div><div>{formatPrice(selectedAgreement.executedOffsetAmount)}</div></div>
                    <div><div className="text-xs text-slate-400">剩余待抵</div><div>{formatPrice(selectedAgreement.remainingOffsetAmount)}</div></div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <ItemEditor title="本次对方交付" item={batchForm.items[0]} onChange={(key, value) => updateBatchItem(0, key, value)} />
                  <ItemEditor title="本次我方抵扣" item={batchForm.items[1]} onChange={(key, value) => updateBatchItem(1, key, value)} />
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-slate-50 px-5 py-4">
                  <div className="grid gap-1 text-sm font-bold text-slate-700">
                    <div>本次可抵金额：{formatPrice(batchPreview.offsetAmount)}</div>
                    <div>本次差额（我方 - 对方）：{formatPrice(batchPreview.difference)}</div>
                  </div>
                  <button onClick={() => void handleCreateBatch()} disabled={batchSubmitting} className="rounded-[20px] bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-3 text-sm font-black text-white shadow-xl shadow-blue-500/25 disabled:opacity-60">
                    {batchSubmitting ? '提交中...' : '创建批次'}
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-5 py-10 text-center text-sm font-bold text-slate-400">请选择左侧协议后再登记批次。</div>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-3 text-2xl font-black tracking-tighter">
          <Coins size={22} className="text-blue-600" />
          批次流水
        </div>
        {selectedAgreement?.settlements?.length ? (
          <div className="space-y-4">
            {selectedAgreement.settlements.map((settlement) => (
              <div key={settlement.id} className="rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-black text-slate-900">第 {settlement.batchIndex || 0} 批 / {settlement.settlementNo}</div>
                    <div className="mt-1 text-xs font-bold text-slate-400">{statusLabelMap[settlement.status] || settlement.status}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {settlement.status === 'quoted' && <button onClick={() => void handleApprove(settlement)} className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-black text-amber-700">审核</button>}
                    {settlement.status === 'approved' && <button onClick={() => void handlePost(settlement)} className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">过账</button>}
                    {(settlement.status === 'approved' || settlement.status === 'posted') && <button onClick={() => void handleReverse(settlement)} className="rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700">冲销</button>}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-3 text-sm font-bold text-slate-700">
                  <div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">我方货值</div><div>{formatPrice(settlement.totalPartyAValue)}</div></div>
                  <div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">对方货值</div><div>{formatPrice(settlement.totalPartyBValue)}</div></div>
                  <div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">本次差额</div><div>{formatPrice(settlement.cashDifference)}</div></div>
                  <div><div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">本次已过账</div><div>{formatPrice((settlement.offsetPostings || []).reduce((sum, posting) => sum + Number(posting.offsetAmount || 0), 0))}</div></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-slate-200 px-5 py-10 text-center text-sm font-bold text-slate-400">当前协议还没有执行批次。</div>
        )}
      </section>
    </div>
  );
};

export default BarterWorkspaceClean;
