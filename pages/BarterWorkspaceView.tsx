import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Layers3, RefreshCcw } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { can } from '../app/permissions';
import { getModuleDescription, getModuleTitle } from '../components/navigation/moduleRegistry';
import { ReasonDialog } from '../components/ui/ReasonDialog';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';
import { WorkspaceTaskNavigator } from '../components/ui/WorkspaceTaskNavigator';
import barterService, { BarterAgreement, BarterItem, BarterSettlement, BarterSummary, CreateBarterAgreementInput, CreateBarterBatchInput } from '../services/barter.service';
import { customerService } from '../src/services/customer.service';
import procurementService, { Supplier } from '../services/procurement.service';
import { orderService } from '../src/services/order.service';
import { getCustomerDisplayName } from '../utils/customerName';
import { isCanceledApiError } from '../utils/api';
import type { Customer, SalesOrder } from '../types';
import {
  BARTER_DESK_TABS,
  BarterItemEditor,
  barterFieldClass,
  barterStatusLabelMap,
  buildBarterPreview,
  createBarterItem,
  type BarterDeskTab,
  type OrderOption,
} from './barter/barterWorkspaceParts';
import { barterInputBoundaries, barterInputEvidence, barterInputGuideSteps } from './barter/barterInputGuideContent';
import { BarterAgreementList } from './barter/BarterAgreementList';
import { BarterInputRoadmap } from './barter/BarterInputRoadmap';
import { BarterLedgerPanel } from './barter/BarterLedgerPanel';

const BarterWorkspaceClean: React.FC = () => {
  const { formatPrice, notify, language, currentUser } = useAppContext();
  const canWriteBarter = can(currentUser, 'barter.write');
  const canApproveBarter = can(currentUser, 'barter.approve');
  const canPostBarter = can(currentUser, 'barter.post');
  const [summary, setSummary] = useState<BarterSummary | null>(null);
  const [agreements, setAgreements] = useState<BarterAgreement[]>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<BarterAgreement | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [agreementSubmitting, setAgreementSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [activeBarterTab, setActiveBarterTab] = useState<BarterDeskTab>('agreement');
  const [reverseSettlement, setReverseSettlement] = useState<BarterSettlement | null>(null);
  const [reverseSubmitting, setReverseSubmitting] = useState(false);

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
    items: [createBarterItem('counterparty'), createBarterItem('our')],
  });

  const [batchForm, setBatchForm] = useState({
    orderId: '',
    valuationDate: new Date().toISOString().slice(0, 10),
    note: '',
    items: [createBarterItem('counterparty'), createBarterItem('our')],
  });

  const agreementPreview = useMemo(() => buildBarterPreview(agreementForm.items), [agreementForm.items]);
  const batchPreview = useMemo(() => buildBarterPreview(batchForm.items), [batchForm.items]);
  const selectedAgreementRemaining = Number(selectedAgreement?.remainingOffsetAmount || 0);
  const batchRemainingAfter = selectedAgreement ? Number((selectedAgreementRemaining - batchPreview.offsetAmount).toFixed(2)) : 0;
  const batchExceedsAgreementRemaining = Boolean(selectedAgreement && batchPreview.offsetAmount > selectedAgreementRemaining);

  const customerOptions = customers.map((customer) => ({ id: String(customer.id), label: getCustomerDisplayName(customer, language) }));
  const moduleTitle = getModuleTitle('barter', language);
  const moduleDescription = getModuleDescription('barter', language);
  const summaryCards = [
    ['协议/批次', summary?.settlementCount ?? 0],
    ['待审核', summary?.quotedCount ?? 0],
    ['已审核', summary?.approvedCount ?? 0],
    ['已过账', summary?.postedCount ?? 0],
  ];
  const barterDeskItems = useMemo(
    () => BARTER_DESK_TABS.map(tab => ({
      ...tab,
      count: tab.id === 'agreement'
        ? agreements.length
        : tab.id === 'batch'
          ? selectedAgreement?.settlements?.length ?? 0
          : selectedAgreement?.settlements?.filter(item => ['approved', 'posted', 'reversed'].includes(item.status)).length ?? 0,
    })),
    [agreements.length, selectedAgreement?.settlements],
  );

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
  const canSubmitBatch = Boolean(selectedAgreement) && canWriteBarter && ensureValidItems(batchForm.items) && selectedAgreementRemaining > 0 && !batchExceedsAgreementRemaining;

  const handleSelectAgreement = async (agreementId: number) => {
    const detail = await barterService.getAgreementById(agreementId);
    setSelectedAgreement(detail);
    setBatchForm((current) => ({ ...current, orderId: detail.orderId ? String(detail.orderId) : current.orderId }));
  };

  const handleCreateAgreement = async () => {
    if (!canWriteBarter) {
      notify('warning', '当前角色只能查看货抵协议，不能创建协议');
      return;
    }
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
        items: [createBarterItem('counterparty'), createBarterItem('our')],
      });
      await loadBase(created.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建货抵协议失败');
    } finally {
      setAgreementSubmitting(false);
    }
  };

  const handleCreateBatch = async () => {
    if (!canWriteBarter) {
      notify('warning', '当前角色只能查看货抵批次，不能创建执行批次');
      return;
    }
    if (!selectedAgreement || !ensureValidItems(batchForm.items)) {
      notify('warning', '请先选择协议并完整填写批次标的');
      return;
    }
    if (selectedAgreementRemaining <= 0) {
      notify('warning', '当前协议剩余待抵金额为 0，不能继续创建执行批次');
      return;
    }
    if (batchExceedsAgreementRemaining) {
      notify('warning', '本次可抵金额不能超过当前协议的剩余待抵金额');
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
        items: [createBarterItem('counterparty'), createBarterItem('our')],
      });
      await loadBase(selectedAgreement.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '创建执行批次失败');
    } finally {
      setBatchSubmitting(false);
    }
  };

  const handleApprove = async (settlement: BarterSettlement) => {
    if (!canApproveBarter) {
      notify('warning', '当前角色没有货抵审核权限');
      return;
    }
    try {
      await barterService.approve(settlement.id);
      notify('success', `批次 ${settlement.settlementNo} 已审核`);
      await loadBase(selectedAgreement?.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '审核批次失败');
    }
  };

  const handlePost = async (settlement: BarterSettlement) => {
    if (!canPostBarter) {
      notify('warning', '当前角色没有货抵过账权限');
      return;
    }
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
    if (!canPostBarter) {
      notify('warning', '当前角色没有货抵冲销权限');
      return;
    }
    setReverseSettlement(settlement);
  };

  const confirmReverseSettlement = async (reason: string) => {
    if (!reverseSettlement) return;
    setReverseSubmitting(true);
    try {
      await barterService.reverse(reverseSettlement.id, reason);
      notify('success', `批次 ${reverseSettlement.settlementNo} 已冲销`);
      setReverseSettlement(null);
      await loadBase(selectedAgreement?.id);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '冲销批次失败');
    } finally {
      setReverseSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="rounded-[40px] bg-[#0B1020] p-8 text-white shadow-[0_30px_60px_rgba(15,23,42,0.24)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-200">
          <ArrowRightLeft size={14} />
          {moduleTitle}
        </div>
        <p className="mt-4 max-w-2xl text-sm font-bold text-slate-300">{moduleDescription}</p>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {summaryCards.map(([label, value]) => (
            <div key={String(label)} className="rounded-[28px] border border-white/10 bg-white/6 p-5">
              <div className="text-sm font-bold text-slate-300">{label}</div>
              <div className="mt-3 text-4xl font-black tracking-tight">{loading ? '...' : value}</div>
            </div>
          ))}
        </div>
      </div>

      <WorkspaceTaskNavigator
        eyebrow="货抵职责导航"
        title="先定协议，再分批执行，最后审批过账"
        description="货抵不是一次性表单，而是“协议对象 + 多个执行批次 + 审批过账流水”。三个区域拆开，避免把总额、本次抵扣和财务确认混在一起。"
        items={barterDeskItems}
        activeId={activeBarterTab}
        onChange={(id) => {
          if (id === 'agreement' || id === 'batch' || id === 'ledger') {
            setActiveBarterTab(id);
          }
        }}
        variant="blue"
      />

      <DocumentInputGuide
        testId="barter-complex-input-guide"
        eyebrow="复杂输入路径"
        title="协议主档 + 分批抵扣明细 + 入账/反冲台账 + 回读证据"
        description="录入时先确定协议边界，再按批次登记实际抵扣，最后通过台账完成审核、过账、反冲和保存后回读。每一步只承担一个职责，减少总额、本次金额和财务确认互相覆盖。"
        steps={barterInputGuideSteps}
        boundaries={barterInputBoundaries}
        evidence={barterInputEvidence}
        tone="blue"
      />

      <BarterInputRoadmap />

      <div className={`${activeBarterTab === 'ledger' ? 'hidden' : 'grid'} gap-8 ${activeBarterTab === 'batch' ? 'xl:grid-cols-1' : 'xl:grid-cols-[1.02fr_0.98fr]'}`}>
        <section className={`${activeBarterTab === 'agreement' ? '' : 'hidden'} rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl`}>
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
          {!canWriteBarter && (
            <div className="mb-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
              当前角色可以查看货抵协议，但不能创建或修改货抵业务。
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <select aria-label="货抵协议客户" title="货抵协议客户" value={agreementForm.customerId} onChange={(e) => setAgreementForm({ ...agreementForm, customerId: e.target.value })} className={barterFieldClass}>
              <option value="">选择客户</option>
              {customerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <input aria-label="货抵协议对方名称" title="货抵协议对方名称" value={agreementForm.counterpartyName} onChange={(e) => setAgreementForm({ ...agreementForm, counterpartyName: e.target.value })} placeholder="对方名称" className={barterFieldClass} />
            <select aria-label="货抵协议供应商" title="货抵协议供应商" value={agreementForm.supplierId} onChange={(e) => setAgreementForm({ ...agreementForm, supplierId: e.target.value })} className={barterFieldClass}>
              <option value="">选择供应商（可选）</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierDisplayName || supplier.name}</option>)}
            </select>
            <select aria-label="货抵协议关联订单" title="货抵协议关联订单" value={agreementForm.orderId} onChange={(e) => setAgreementForm({ ...agreementForm, orderId: e.target.value })} className={barterFieldClass}>
              <option value="">选择关联订单（可选）</option>
              {orders.map((order) => <option key={order.id} value={order.id}>{order.label}</option>)}
            </select>
          </div>

          <div className="mt-4 rounded-[28px] border border-blue-100 bg-blue-50/60 p-4">
            <div className="mb-3 text-sm font-black text-slate-800">协议主档字段</div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <select aria-label="货抵协议结算方式" title="货抵协议结算方式" value={agreementForm.settlementMode} onChange={(e) => setAgreementForm({ ...agreementForm, settlementMode: e.target.value as typeof agreementForm.settlementMode })} className={barterFieldClass}>
                <option value="mixed">货抵 + 差额</option>
                <option value="barter">纯货抵</option>
                <option value="cash_top_up">现金补差</option>
                <option value="cash_refund">现金退款</option>
              </select>
              <input aria-label="货抵协议币种" title="货抵协议币种" value={agreementForm.currency} onChange={(e) => setAgreementForm({ ...agreementForm, currency: e.target.value.toUpperCase() })} placeholder="币种，如 CNY" className={barterFieldClass} />
              <input aria-label="货抵协议日期" title="货抵协议日期" type="date" value={agreementForm.agreementDate} onChange={(e) => setAgreementForm({ ...agreementForm, agreementDate: e.target.value })} className={barterFieldClass} />
              <input aria-label="货抵协议估值日期" title="货抵协议估值日期" type="date" value={agreementForm.valuationDate} onChange={(e) => setAgreementForm({ ...agreementForm, valuationDate: e.target.value })} className={barterFieldClass} />
            </div>
            <textarea
              aria-label="货抵协议备注"
              title="货抵协议备注"
              value={agreementForm.note}
              onChange={(e) => setAgreementForm({ ...agreementForm, note: e.target.value })}
              placeholder="协议备注：记录估值依据、质量折扣、补差约定或双方确认口径"
              className={`${barterFieldClass} mt-4 min-h-[86px] resize-none`}
            />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <BarterItemEditor title="协议对方总标的" item={agreementForm.items[0]} onChange={(key, value) => updateAgreementItem(0, key, value)} />
            <BarterItemEditor title="协议我方总标的" item={agreementForm.items[1]} onChange={(key, value) => updateAgreementItem(1, key, value)} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-slate-50 px-5 py-4">
            <div className="grid gap-1 text-sm font-bold text-slate-700">
              <div>协议可抵总额：{formatPrice(agreementPreview.offsetAmount)}</div>
              <div>协议差额（我方 - 对方）：{formatPrice(agreementPreview.difference)}</div>
            </div>
            <button onClick={() => void handleCreateAgreement()} disabled={agreementSubmitting || !canWriteBarter} className="rounded-[20px] bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-3 text-sm font-black text-white shadow-xl shadow-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60">
              {agreementSubmitting ? '提交中...' : '创建协议'}
            </button>
          </div>
        </section>

        <section className="space-y-8">
          <div className={activeBarterTab === 'agreement' ? '' : 'hidden'}>
            <BarterAgreementList
              agreements={agreements}
              selectedAgreementId={selectedAgreement?.id}
              formatPrice={formatPrice}
              onSelect={(agreementId) => void handleSelectAgreement(agreementId)}
            />
          </div>

          <div className={`${activeBarterTab === 'batch' ? '' : 'hidden'} rounded-[40px] border border-white/50 bg-white/75 p-8 shadow-[0_16px_40px_rgba(15,23,42,0.05)] backdrop-blur-xl`}>
            <div className="mb-4 text-2xl font-black tracking-tighter">登记执行批次</div>
            <div className="mb-5 rounded-[24px] border border-blue-100 bg-blue-50/70 p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-500">协议库 → 选中协议 → 执行批次</div>
                  <div className="mt-1 text-sm font-bold text-slate-600">执行批次必须挂在一个已选协议下；下方只登记“本次”交付和抵扣，不改协议总额。</div>
                </div>
                {selectedAgreement && <StatusBadge status={selectedAgreement.status} label={barterStatusLabelMap[selectedAgreement.status] || selectedAgreement.status} />}
              </div>
              <select
                aria-label="货抵执行批次协议"
                title="货抵执行批次协议"
                value={selectedAgreement?.id ? String(selectedAgreement.id) : ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    setSelectedAgreement(null);
                    return;
                  }
                  void handleSelectAgreement(Number(e.target.value));
                }}
                className={barterFieldClass}
              >
                <option value="">先从协议库选择一个协议，才能保存批次</option>
                {agreements.map((agreement) => (
                  <option key={agreement.id} value={agreement.id}>
                    {agreement.agreementNo} / {agreement.counterpartyName} / 剩余待抵 {formatPrice(agreement.remainingOffsetAmount)}
                  </option>
                ))}
              </select>
            </div>
            {selectedAgreement ? (
              <>
                <div className="mb-4 rounded-[24px] bg-slate-950 p-5 text-white">
                  <div className="text-sm font-black">{selectedAgreement.agreementNo}</div>
                  <div className="mt-2 text-sm text-slate-300">{selectedAgreement.counterpartyName}</div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm font-bold">
                    <div><div className="text-xs text-slate-400">协议可抵总额</div><div>{formatPrice(selectedAgreement.agreedOffsetAmount)}</div></div>
                    <div><div className="text-xs text-slate-400">已过账累计抵扣</div><div>{formatPrice(selectedAgreement.executedOffsetAmount)}</div></div>
                    <div><div className="text-xs text-slate-400">本批前剩余待抵</div><div>{formatPrice(selectedAgreement.remainingOffsetAmount)}</div></div>
                  </div>
                </div>

                <div className="mb-4 rounded-[24px] border border-blue-100 bg-blue-50/70 p-4">
                  <div className="mb-3 text-sm font-black text-slate-800">分批抵扣明细字段</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <select aria-label="货抵执行批次关联订单" title="货抵执行批次关联订单" value={batchForm.orderId} onChange={(e) => setBatchForm({ ...batchForm, orderId: e.target.value })} className={barterFieldClass}>
                      <option value="">沿用协议订单或暂不关联订单</option>
                      {orders.map((order) => <option key={order.id} value={order.id}>{order.label}</option>)}
                    </select>
                    <input aria-label="货抵执行批次估值日期" title="货抵执行批次估值日期" type="date" value={batchForm.valuationDate} onChange={(e) => setBatchForm({ ...batchForm, valuationDate: e.target.value })} className={barterFieldClass} />
                  </div>
                  <textarea
                    aria-label="货抵执行批次备注"
                    title="货抵执行批次备注"
                    value={batchForm.note}
                    onChange={(e) => setBatchForm({ ...batchForm, note: e.target.value })}
                    placeholder="本批备注：记录交付单号、验收口径、库存闭环或本次抵扣说明"
                    className={`${barterFieldClass} mt-4 min-h-[86px] resize-none`}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <BarterItemEditor title="本次对方交付" item={batchForm.items[0]} onChange={(key, value) => updateBatchItem(0, key, value)} />
                  <BarterItemEditor title="本次我方抵扣" item={batchForm.items[1]} onChange={(key, value) => updateBatchItem(1, key, value)} />
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-slate-50 px-5 py-4">
                  <div className="grid gap-1 text-sm font-bold text-slate-700">
                    <div>本次可抵金额：{formatPrice(batchPreview.offsetAmount)}</div>
                    <div>本次差额（我方 - 对方）：{formatPrice(batchPreview.difference)}</div>
                    <div className={batchExceedsAgreementRemaining ? 'text-rose-600' : 'text-slate-500'}>
                      创建后预计剩余待抵：{formatPrice(Math.max(batchRemainingAfter, 0))}
                      {batchExceedsAgreementRemaining ? '（本次金额已超过协议剩余）' : ''}
                    </div>
                  </div>
                  <button onClick={() => void handleCreateBatch()} disabled={batchSubmitting || !canSubmitBatch} className="rounded-[20px] bg-gradient-to-br from-blue-600 to-blue-700 px-6 py-3 text-sm font-black text-white shadow-xl shadow-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60">
                    {batchSubmitting ? '提交中...' : '创建批次'}
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 px-5 py-10 text-center text-sm font-bold text-slate-400">请先在上方选择协议；没有选中协议时不能保存执行批次。</div>
            )}
          </div>
        </section>
      </div>

      <div className={activeBarterTab === 'ledger' ? '' : 'hidden'}>
        <BarterLedgerPanel
          agreement={selectedAgreement}
          canApprove={canApproveBarter}
          canPost={canPostBarter}
          formatPrice={formatPrice}
          onApprove={(settlement) => void handleApprove(settlement)}
          onPost={(settlement) => void handlePost(settlement)}
          onReverse={(settlement) => void handleReverse(settlement)}
        />
      </div>

      <ReasonDialog
        open={Boolean(reverseSettlement)}
        title={reverseSettlement ? `冲销批次 ${reverseSettlement.settlementNo}` : '冲销批次'}
        description="冲销会影响货抵结算流水，请填写清晰原因，方便财务和审计后续追踪。"
        defaultReason="对方撤回 / 录入作废"
        confirmLabel="确认冲销"
        tone="danger"
        loading={reverseSubmitting}
        onCancel={() => setReverseSettlement(null)}
        onConfirm={confirmReverseSettlement}
      />
    </div>
  );
};

export default BarterWorkspaceClean;
