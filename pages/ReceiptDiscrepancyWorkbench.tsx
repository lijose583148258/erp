import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Plus, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { EnterpriseDataGrid } from '../components/ui/EnterpriseDataGrid';
import { FormField } from '../components/ui/FormField';
import { ModuleHero } from '../components/ui/ModuleHero';
import { PageShell } from '../components/ui/PageShell';
import {
  receiptDiscrepancyService,
  type ReceiptDiscrepancyActionType,
  type ReceiptDiscrepancyCase,
  type ReceiptDiscrepancyStatus,
  type ReceiptToleranceAction,
  type ReceiptToleranceCounterpartyType,
  type ReceiptToleranceDiscrepancyType,
  type ReceiptToleranceRule,
  type ReceiptToleranceSourceType,
} from '../services/receiptDiscrepancy.service';
import { isCanceledApiError } from '../utils/api';
import { actionLabels, actionOptions, counterpartyLabels, discrepancyTypeLabels, discrepancyTypeOptions, initialRuleDraft, sourceTypeLabels, statusLabels, type ActiveTab, type RuleDraft } from './receiptDiscrepancyWorkbench.config';
import { caseColumns, ruleColumns } from './receiptDiscrepancyWorkbench.columns';

const ReceiptDiscrepancyWorkbench: React.FC = () => {
  const { currentUser, notify } = useAppContext();
  const [activeTab, setActiveTab] = useState<ActiveTab>('cases');
  const [cases, setCases] = useState<ReceiptDiscrepancyCase[]>([]);
  const [rules, setRules] = useState<ReceiptToleranceRule[]>([]);
  const [caseSearch, setCaseSearch] = useState('');
  const [ruleSearch, setRuleSearch] = useState('');
  const [caseStatusFilter, setCaseStatusFilter] = useState<'all' | ReceiptDiscrepancyStatus>('all');
  const [loading, setLoading] = useState(true);
  const [savingRule, setSavingRule] = useState(false);
  const [actioningCaseId, setActioningCaseId] = useState<string | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(initialRuleDraft);

  const canManageRules = ['admin', 'manager'].includes(currentUser.role);
  const canResolveCases = ['admin', 'manager', 'warehouse'].includes(currentUser.role);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [caseResponse, ruleResponse] = await Promise.all([
        receiptDiscrepancyService.getAll({ pageSize: 100 }, { signal }),
        receiptDiscrepancyService.getToleranceRules({ pageSize: 100 }, { signal }),
      ]);
      if (signal?.aborted) return;
      setCases(caseResponse.data);
      setRules(ruleResponse.data);
    } catch (error) {
      if (isCanceledApiError(error)) return;
      console.error(error);
      notify('error', '收发货差异工作台加载失败，请检查接口或权限');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  const filteredCases = useMemo(() => {
    return caseStatusFilter === 'all'
      ? cases
      : cases.filter((item) => item.status === caseStatusFilter);
  }, [caseStatusFilter, cases]);

  const stats = useMemo(() => {
    const pending = cases.filter((item) => item.status === 'pending').length;
    const inReview = cases.filter((item) => item.status === 'in_review').length;
    const resolved = cases.filter((item) => item.status === 'resolved').length;
    const blockingRules = rules.filter((item) => item.actionOutsideTolerance === 'block').length;
    return { pending, inReview, resolved, blockingRules };
  }, [cases, rules]);

  const updateCaseStatus = async (item: ReceiptDiscrepancyCase, status: ReceiptDiscrepancyStatus) => {
    if (!canResolveCases) {
      notify('warning', '当前角色只能查看差异，不能处理差异单');
      return;
    }

    try {
      const updated = await receiptDiscrepancyService.resolve(item.id, {
        status,
        resolution: status === 'resolved' ? '工作台快速关闭：已人工确认后续处理路径' : undefined,
        actionRef: status === 'resolved' ? `WORKBENCH-${Date.now()}` : undefined,
        note: status === 'in_review' ? '工作台快速置为评审中' : '工作台快速处理',
      });
      setCases((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      notify('success', `差异单 ${updated.caseNo} 已更新为 ${statusLabels[updated.status] || updated.status}`);
    } catch (error) {
      console.error(error);
      notify('error', '差异单状态更新失败');
    }
  };

  const createCaseAction = async (item: ReceiptDiscrepancyCase, actionType: ReceiptDiscrepancyActionType) => {
    if (!canResolveCases) {
      notify('warning', '当前角色只能查看差异，不能创建处置动作');
      return;
    }

    setActioningCaseId(item.id);
    try {
      const action = await receiptDiscrepancyService.createAction(item.id, {
        actionType,
        quantity: item.quantity,
        unit: item.unit,
        reasonCode: item.discrepancyType,
        dispositionCode: actionType === 'customer_rma' ? 'rma_review' : 'finance_review',
        note: actionType === 'customer_rma'
          ? '由差异工作台创建客户 RMA 处置动作'
          : '由差异工作台创建财务/索赔待处理动作',
      });
      await loadData();
      notify('success', `已创建处置动作 ${action.actionNo}${action.targetRef ? `，关联 ${action.targetRef}` : ''}`);
    } catch (error) {
      console.error(error);
      notify('error', '处置动作创建失败，请检查权限或差异单状态');
    } finally {
      setActioningCaseId(null);
    }
  };

  const createRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageRules) {
      notify('warning', '只有管理员或经理可以维护容差规则');
      return;
    }
    if (!ruleDraft.name.trim()) {
      notify('warning', '请填写规则名称');
      return;
    }

    setSavingRule(true);
    try {
      const rule = await receiptDiscrepancyService.createToleranceRule({
        ...ruleDraft,
        productName: ruleDraft.productName.trim() || null,
        note: ruleDraft.note.trim() || null,
      });
      setRules((current) => [rule, ...current]);
      setRuleDraft(initialRuleDraft);
      setShowRuleForm(false);
      setActiveTab('rules');
      notify('success', `容差规则 ${rule.ruleNo} 已创建`);
    } catch (error) {
      console.error(error);
      notify('error', '容差规则创建失败');
    } finally {
      setSavingRule(false);
    }
  };

  return (
    <PageShell
      eyebrow="EXCEPTION GOVERNANCE"
      title="收发货差异工作台"
      subtitle="统一查看采购拒收、客户短签、破损和错货；先把异常归队列和规则管住，再接质检、RMA、索赔和财务扣减。"
      tabs={[
        { id: 'cases', label: '差异队列', active: activeTab === 'cases', onClick: () => setActiveTab('cases'), testId: 'receipt-discrepancy-tab-cases' },
        { id: 'rules', label: '容差规则', active: activeTab === 'rules', onClick: () => setActiveTab('rules'), testId: 'receipt-discrepancy-tab-rules' },
      ]}
      actions={(
        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex items-center rounded-[18px] bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800"
        >
          <RefreshCw size={14} className="mr-2" />
          刷新
        </button>
      )}
    >
      <ModuleHero
        eyebrow="Receipt & Delivery Control"
        title="异常先进队列，规则先判定"
        description="低风险可自动关闭，超容差可阻止提交；但质检、RMA、索赔和财务扣减仍保留为后续动作，不在本页偷偷自动改账。"
        stats={[
          { label: '待处理', value: stats.pending, icon: <AlertTriangle size={18} />, tone: 'amber' },
          { label: '评审中', value: stats.inReview, icon: <ClipboardList size={18} />, tone: 'blue' },
          { label: '已关闭', value: stats.resolved, icon: <CheckCircle2 size={18} />, tone: 'emerald' },
          { label: '阻止规则', value: stats.blockingRules, icon: <ShieldCheck size={18} />, tone: 'rose' },
        ]}
      />

      {activeTab === 'cases' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'pending', 'in_review', 'resolved'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setCaseStatusFilter(status)}
                className={`rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition ${
                  caseStatusFilter === status
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                    : 'bg-white text-slate-500 ring-1 ring-slate-100 hover:text-blue-600 dark:bg-slate-900 dark:ring-slate-800'
                }`}
              >
                {status === 'all' ? '全部' : statusLabels[status]}
              </button>
            ))}
          </div>

          <EnterpriseDataGrid
            data={filteredCases}
            columns={caseColumns}
            rowKey="id"
            title="差异队列"
            description="按差异类型、容差动作和状态追踪，避免采购/发货各自处理导致断链。"
            searchValue={caseSearch}
            onSearchChange={setCaseSearch}
            searchPlaceholder="搜索差异单、客户/供应商、货品、原因..."
            searchInputTestId="receipt-discrepancy-case-search"
            loading={loading}
            emptyTitle="暂无差异单"
            emptyDescription="当采购拒收或客户签收异常发生时，会自动进入这里。"
            exportFileName="receipt-discrepancy-cases"
            rowActions={(row) => (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={!canResolveCases || row.status === 'resolved' || row.status === 'cancelled'}
                  onClick={() => updateCaseStatus(row, 'in_review')}
                  className="rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-black text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-950/30 dark:text-blue-200"
                >
                  评审
                </button>
                <button
                  type="button"
                  disabled={!canResolveCases || actioningCaseId === row.id || Boolean(row.actionRef) || row.status === 'resolved' || row.status === 'cancelled' || row.counterpartyType !== 'customer'}
                  onClick={() => createCaseAction(row, 'customer_rma')}
                  className="rounded-xl bg-indigo-50 px-3 py-2 text-[11px] font-black text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-950/30 dark:text-indigo-200"
                >
                  {row.actionRef ? '已处置' : '转RMA'}
                </button>
                <button
                  type="button"
                  disabled={!canResolveCases || actioningCaseId === row.id || Boolean(row.actionRef) || row.status === 'resolved' || row.status === 'cancelled'}
                  onClick={() => createCaseAction(row, 'credit_or_deduction')}
                  className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  待财务
                </button>
                <button
                  type="button"
                  disabled={!canResolveCases || row.status === 'resolved' || row.status === 'cancelled'}
                  onClick={() => updateCaseStatus(row, 'resolved')}
                  className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-black text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-950/30 dark:text-emerald-200"
                >
                  关闭
                </button>
              </div>
            )}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="app-panel p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="app-section-title mb-2">RULE MANAGEMENT</p>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">容差规则</h2>
                <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-300">
                  规则越具体优先级越高；产品、对象、差异类型越精确，越先被命中。
                </p>
              </div>
              <button
                type="button"
                disabled={!canManageRules}
                onClick={() => setShowRuleForm((current) => !current)}
                data-testid="receipt-tolerance-new-rule"
                className="inline-flex items-center rounded-[20px] bg-blue-600 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white shadow-xl shadow-blue-500/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={16} className="mr-2" />
                新增规则
              </button>
            </div>

            {showRuleForm ? (
              <form onSubmit={createRule} className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-4">
                <FormField
                  label="规则名称"
                  required
                  className="lg:col-span-2"
                  value={ruleDraft.name}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, name: value }))}
                  placeholder="例如：采购短少 3% 内预警"
                  dataTestId="receipt-tolerance-rule-name"
                />
                <FormField
                  label="来源"
                  as="select"
                  value={ruleDraft.sourceType}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, sourceType: value as ReceiptToleranceSourceType }))}
                  options={(['all', 'purchase_receipt', 'shipment_receipt'] as ReceiptToleranceSourceType[]).map((value) => ({
                    value,
                    label: sourceTypeLabels[value],
                  }))}
                />
                <FormField
                  label="差异类型"
                  as="select"
                  value={ruleDraft.discrepancyType}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, discrepancyType: value as ReceiptToleranceDiscrepancyType }))}
                  options={discrepancyTypeOptions.map((value) => ({
                    value,
                    label: discrepancyTypeLabels[value],
                  }))}
                />
                <FormField
                  label="对象类型"
                  as="select"
                  value={ruleDraft.counterpartyType}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, counterpartyType: value as ReceiptToleranceCounterpartyType }))}
                  options={(['all', 'supplier', 'customer'] as ReceiptToleranceCounterpartyType[]).map((value) => ({
                    value,
                    label: counterpartyLabels[value],
                  }))}
                />
                <FormField
                  label="货品名称"
                  value={ruleDraft.productName}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, productName: value }))}
                  placeholder="不填表示全部货品"
                />
                <FormField
                  label="百分比容差"
                  type="number"
                  value={String(ruleDraft.quantityTolerancePercent)}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, quantityTolerancePercent: Number(value || 0) }))}
                />
                <FormField
                  label="绝对值容差"
                  type="number"
                  value={String(ruleDraft.quantityToleranceAbs)}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, quantityToleranceAbs: Number(value || 0) }))}
                />
                <FormField
                  label="范围内动作"
                  as="select"
                  value={ruleDraft.actionWithinTolerance}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, actionWithinTolerance: value as ReceiptToleranceAction }))}
                  options={actionOptions.map((value) => ({
                    value,
                    label: actionLabels[value],
                  }))}
                />
                <FormField
                  label="超范围动作"
                  as="select"
                  value={ruleDraft.actionOutsideTolerance}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, actionOutsideTolerance: value as ReceiptToleranceAction }))}
                  options={actionOptions.map((value) => ({
                    value,
                    label: actionLabels[value],
                  }))}
                />
                <FormField
                  label="优先级"
                  type="number"
                  value={String(ruleDraft.priority)}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, priority: Number(value || 100) }))}
                />
                <FormField
                  label="备注"
                  className="lg:col-span-2"
                  value={ruleDraft.note}
                  onChange={(value) => setRuleDraft((current) => ({ ...current, note: value }))}
                  placeholder="规则说明或适用边界"
                />
                <label className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={ruleDraft.requiresQualityCheck}
                    onChange={(event) => setRuleDraft((current) => ({ ...current, requiresQualityCheck: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  要求质检介入
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="submit"
                    disabled={savingRule}
                    className="inline-flex flex-1 items-center justify-center rounded-[18px] bg-blue-600 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingRule ? '保存中...' : '保存规则'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRuleForm(false);
                      setRuleDraft(initialRuleDraft);
                    }}
                    className="inline-flex items-center justify-center rounded-[18px] bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </form>
            ) : null}
          </div>

          <EnterpriseDataGrid
            data={rules}
            columns={ruleColumns}
            rowKey="id"
            title="规则清单"
            description="本清单只维护判定入口，不直接生成质检、RMA、索赔或财务凭证。"
            searchValue={ruleSearch}
            onSearchChange={setRuleSearch}
            searchPlaceholder="搜索规则号、名称、货品、动作..."
            searchInputTestId="receipt-tolerance-rule-search"
            loading={loading}
            emptyTitle="暂无容差规则"
            emptyDescription="默认规则会由启动修复链自动种入。"
            exportFileName="receipt-tolerance-rules"
          />
        </div>
      )}
    </PageShell>
  );
};

export default ReceiptDiscrepancyWorkbench;
