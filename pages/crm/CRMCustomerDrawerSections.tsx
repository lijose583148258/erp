import { useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { BrainCircuit, Loader2, MapPin, UploadCloud, UserPlus } from 'lucide-react';
import type { Contact, Customer, CustomerAddress, CustomerPoolHistoryEntry, TeamMember } from '../../types';
import { CRMCustomerPoolAudit } from './CRMCustomerPoolAudit';

export type TranslationText = Record<string, string | undefined>;
export type CustomerPoolState = 'public' | 'internal' | 'private';
export type CustomerNames = {
  zh: string;
  en: string;
  vi: string;
  aliases: string[];
  primary: string;
};
export type PoolHistorySummary = {
  poolState: CustomerPoolState;
  salespersonId: string | null;
  poolReason: string | null;
  poolUpdatedAt: string | null;
  poolUpdatedBy: string | null;
} | null;

const SectionTitle = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div className="mb-4">
    <div className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">{subtitle}</div>
    <h5 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{title}</h5>
  </div>
);

const poolTone: Record<CustomerPoolState, string> = {
  public: 'bg-rose-100 text-rose-600',
  internal: 'bg-violet-100 text-violet-600',
  private: 'bg-emerald-100 text-emerald-600',
};

const addressTypeLabel: Record<CustomerAddress['type'], string> = {
  legal: '法定主体',
  shipping: '发货地址',
  billing: '账单地址',
  office: '办公地址',
  other: '其他站点',
};

const normalizeAliasInput = (value: string) => {
  const aliases = value
    .split(/[\n,，;；|/]+/g)
    .map((alias) => alias.trim())
    .filter(Boolean);
  return Array.from(new Set(aliases));
};

export function CRMCustomerMasterProfileSection({
  t,
  formatPrice,
  selectedCustomer,
  currentPoolState,
  customerNames,
  primaryAddress,
  primaryContact,
  readOnlyProfile,
  canEditProfile,
  aliasEditorValue,
  onUpdateProfileMeta,
  onUploadLicense,
  licenseInputRef,
}: {
  t: TranslationText;
  formatPrice: (value: number) => string;
  selectedCustomer: Customer;
  currentPoolState: CustomerPoolState;
  customerNames: CustomerNames;
  primaryAddress: CustomerAddress | null;
  primaryContact: Contact | null;
  readOnlyProfile: boolean;
  canEditProfile: boolean;
  aliasEditorValue: string;
  onUpdateProfileMeta: (patch: Partial<Pick<Customer, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'nameAliases' | 'notes'>>) => void;
  onUploadLicense: (event: ChangeEvent<HTMLInputElement>) => void;
  licenseInputRef: RefObject<HTMLInputElement | null>;
}) {
  const aliasCount = customerNames.aliases.length;

  return (
    <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
      <SectionTitle title={t.crmMasterProfileTitle || '主数据概览'} subtitle={t.crmMasterProfile || 'Master Profile'} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[20px] bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmCustomerPool || '客户池'}</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-sm font-black text-slate-900 dark:text-white">{currentPoolState.toUpperCase()}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-black uppercase ${poolTone[currentPoolState]}`}>{currentPoolState}</span>
          </div>
        </div>
        <div className="rounded-[20px] bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmCreditSnapshot || '信用快照'}</div>
          <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">已用 {formatPrice(selectedCustomer.usedCredit || 0)}</div>
          <div className="mt-1 text-xs font-medium text-slate-500">额度 {formatPrice(selectedCustomer.creditLimit || 0)}</div>
        </div>
        <div className="rounded-[20px] bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmBusinessLine || '业务线'}</div>
          <div className="mt-2 text-sm font-black text-slate-900 capitalize dark:text-white">{selectedCustomer.segment || 'mixed'}</div>
        </div>
        <div className="rounded-[20px] bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmRiskLevel || '风险等级'}</div>
          <div className="mt-2 text-sm font-black uppercase text-slate-900 dark:text-white">{selectedCustomer.riskLevel || '--'}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[20px] bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmPrimaryContact || '主联系人'}</div>
          <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{primaryContact?.name || '--'}</div>
          <div className="mt-1 text-xs font-medium text-slate-500">{[primaryContact?.phone, primaryContact?.email].filter(Boolean).join(' / ') || '未补联系方式'}</div>
        </div>
        <div className="rounded-[20px] bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmPrimaryAddress || '主地址'}</div>
          <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{primaryAddress?.label || '--'}</div>
          <div className="mt-1 text-xs font-medium text-slate-500">{[primaryAddress?.city, primaryAddress?.countryCode].filter(Boolean).join(' / ') || '未补地址'}</div>
        </div>
        <div className="rounded-[20px] bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmAliases || '别名'}</div>
          <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{aliasCount}</div>
          <div className="mt-1 text-xs font-medium text-slate-500">{aliasCount > 0 ? customerNames.aliases.slice(0, 2).join(' / ') : '暂无历史名'}</div>
        </div>
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmMasterNameAlias || '主名称与别名'}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{t.crmMasterNameAliasHint || '客户三语名称与历史名集中维护，支持手填和自动联想后的统一落库。'}</div>
          </div>
          {readOnlyProfile && <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-800">{t.crmReadOnly || '只读'}</div>}
        </div>

        {canEditProfile ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input value={selectedCustomer.name || ''} onChange={(event) => onUpdateProfileMeta({ name: event.target.value })} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder="主名称" />
              <input value={selectedCustomer.nameZh || ''} onChange={(event) => onUpdateProfileMeta({ nameZh: event.target.value })} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder="中文名" />
              <input value={selectedCustomer.nameEn || ''} onChange={(event) => onUpdateProfileMeta({ nameEn: event.target.value })} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder={t.crmEnglishName || 'English Name'} />
              <input value={selectedCustomer.nameVi || ''} onChange={(event) => onUpdateProfileMeta({ nameVi: event.target.value })} className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder="Tiếng Việt" />
            </div>
            <textarea value={aliasEditorValue} onChange={(event) => onUpdateProfileMeta({ nameAliases: normalizeAliasInput(event.target.value) })} rows={4} className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder={t.crmAliasesPlaceholder || '历史名 / 别名，支持换行、逗号、顿号分隔'} />
            <textarea value={selectedCustomer.notes || ''} onChange={(event) => onUpdateProfileMeta({ notes: event.target.value })} rows={3} className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder={t.crmMainNotesPlaceholder || '主数据备注、命名规则、历史说明'} />
            <div className="text-[11px] font-medium text-slate-400">{t.crmAliasesHint || '建议保留主名称为最常用对外名称，别名用于跨国别写法、旧公司名、简称匹配。'}</div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[18px] bg-slate-50 p-3 dark:bg-slate-900">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t.crmMainName || '主名称'}</div>
              <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{selectedCustomer.name || '--'}</div>
            </div>
            <div className="rounded-[18px] bg-slate-50 p-3 dark:bg-slate-900">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t.crmThreeLanguageName || '三语名称'}</div>
              <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{[selectedCustomer.nameZh, selectedCustomer.nameEn, selectedCustomer.nameVi].filter(Boolean).join(' / ') || '--'}</div>
            </div>
            <div className="rounded-[18px] bg-slate-50 p-3 md:col-span-2 dark:bg-slate-900">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t.crmHistoryAliases || '历史名 / 别名'}</div>
              <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{customerNames.aliases.join(' / ') || '--'}</div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t.crmCertificatesAndNotes || '证照与备注'}</div>
            <div className="mt-2 text-xs font-medium text-slate-500">{selectedCustomer.notes || (t.crmNoNotes || '暂无备注')}</div>
          </div>
          <button disabled={readOnlyProfile} onClick={() => !readOnlyProfile && licenseInputRef.current?.click()} className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900">
            {t.crmUploadLicense || '上传证照'}
          </button>
        </div>
        {selectedCustomer.licenseUrl ? (
          <img src={selectedCustomer.licenseUrl} alt="license" className="mt-4 aspect-video w-full rounded-[20px] object-cover" />
        ) : (
          <div onClick={() => !readOnlyProfile && licenseInputRef.current?.click()} className={`mt-4 flex aspect-video items-center justify-center rounded-[20px] border-2 border-dashed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900 ${readOnlyProfile ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
            <UploadCloud size={20} className="mr-2" />{t.crmUploadBusinessLicense || '点击上传营业执照'}
          </div>
        )}
        <input type="file" ref={licenseInputRef} className="hidden" accept="image/*" onChange={onUploadLicense} disabled={readOnlyProfile} />
      </div>
    </section>
  );
}

export function CRMCustomerOwnershipSection({
  t,
  currentPoolState,
  canManagePool,
  poolReason,
  setPoolReason,
  poolSalespersonId,
  setPoolSalespersonId,
  isPoolUpdating,
  onPoolAction,
  poolHistorySummary,
  salesAssignees,
}: {
  t: TranslationText;
  currentPoolState: CustomerPoolState;
  canManagePool: boolean;
  poolReason: string;
  setPoolReason: (value: string) => void;
  poolSalespersonId: string;
  setPoolSalespersonId: (value: string) => void;
  isPoolUpdating: boolean;
  onPoolAction: (poolState: CustomerPoolState) => void;
  poolHistorySummary: PoolHistorySummary;
  salesAssignees: TeamMember[];
}) {
  const [pendingPoolAction, setPendingPoolAction] = useState<CustomerPoolState | null>(null);
  const [lastConfirmedAction, setLastConfirmedAction] = useState<{
    action: CustomerPoolState;
    reason: string;
    confirmedAt: string;
  } | null>(null);
  const salespersonLookup = Object.fromEntries(salesAssignees.map((member) => [String(member.id), member]));
  const currentAssignee = poolSalespersonId ? salespersonLookup[String(poolSalespersonId)] : undefined;
  const keyword = poolSalespersonId.trim().toLowerCase();
  const suggestedSalespeople = (keyword
    ? salesAssignees.filter((member) => [member.id, member.name, member.role, member.type, member.region].join(' ').toLowerCase().includes(keyword))
    : salesAssignees
  ).slice(0, 8);
  const poolLabels: Record<CustomerPoolState, string> = {
    public: t.crmPoolPublic || '公海',
    internal: t.crmPoolInternal || '内池',
    private: t.crmPoolPrivate || '私海',
  };
  const poolActionCopy: Record<CustomerPoolState, { title: string; summary: string; tone: string; buttonClassName: string }> = {
    internal: {
      title: t.crmPutToInternalPool || '放入内池',
      summary: t.crmPoolInternalImpact || '客户将从当前池进入内部池，销售负责人会被清空，后续由管理角色重新分配。',
      tone: 'border-slate-200 bg-slate-900 text-white dark:border-slate-700 dark:bg-white dark:text-slate-900',
      buttonClassName: 'bg-slate-900 text-white dark:bg-white dark:text-slate-900',
    },
    public: {
      title: t.crmReleaseToPublic || '释放到公海',
      summary: t.crmPoolPublicImpact || '客户将进入公海，原私海负责人不再独占，团队成员可能重新认领或分配。',
      tone: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200',
      buttonClassName: 'bg-rose-500 text-white',
    },
    private: {
      title: t.crmAssignPrivateButton || '分配到私海',
      summary: currentAssignee
        ? `${t.crmPoolPrivateImpact || '客户将进入私海并绑定负责人'}：${currentAssignee.name} / ${currentAssignee.type}`
        : (t.crmPoolPrivateImpactNoOwner || '客户将进入私海；请确认负责人 ID 是否正确，未匹配到销售档案时仍会按现有输入提交。'),
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200',
      buttonClassName: 'bg-emerald-500 text-white',
    },
  };
  const pendingCopy = pendingPoolAction ? poolActionCopy[pendingPoolAction] : null;
  const trimmedReason = poolReason.trim();
  const openPoolConfirmation = (poolState: CustomerPoolState) => {
    setPendingPoolAction(poolState);
  };
  const confirmPoolAction = () => {
    if (!pendingPoolAction) return;
    setLastConfirmedAction({
      action: pendingPoolAction,
      reason: trimmedReason || (t.crmPoolNoReasonWarning || '未填写原因'),
      confirmedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    });
    onPoolAction(pendingPoolAction);
    setPendingPoolAction(null);
  };

  return (
    <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
      <SectionTitle title={t.crmOwnershipPoolTitle || '客户池与归属'} subtitle={t.crmOwnershipPool || 'Ownership & Pool'} />
      {canManagePool ? (
        <div className="space-y-4">
          <div className="grid gap-2">
            <div className="rounded-[24px] border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
              <div className="text-xs font-black uppercase tracking-[0.22em] text-blue-500">{t.crmPoolActionConfirmMode || '动作确认模式'}</div>
              <div className="mt-2 text-xs font-bold leading-relaxed text-blue-900 dark:text-blue-100">
                {t.crmPoolActionConfirmModeHint || '先选择动作，再核对原因、影响预览和确认记录，避免公海、私海、内池误操作。'}
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {(['internal', 'public', 'private'] as CustomerPoolState[]).map((poolState) => (
                <button
                  key={poolState}
                  type="button"
                  onClick={() => openPoolConfirmation(poolState)}
                  disabled={isPoolUpdating}
                  className={`rounded-2xl border px-3 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] transition disabled:opacity-50 ${poolActionCopy[poolState].tone}`}
                >
                  <span className="block">{poolActionCopy[poolState].title}</span>
                  <span className="mt-1 block text-xs opacity-75">{poolLabels[currentPoolState]} → {poolLabels[poolState]}</span>
                </button>
              ))}
            </div>
            <div className="rounded-[22px] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t.crmAssignPrivate || '分配到私海'}</div>
              <input list="crm-sales-assignees" value={poolSalespersonId} onChange={(event) => setPoolSalespersonId(event.target.value)} className="mt-3 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder={t.crmSalespersonSearchPlaceholder || '手填或搜索：销售 ID / 姓名 / 业务线'} />
              <datalist id="crm-sales-assignees">
                {salesAssignees.map((member) => (
                  <option key={member.id} value={member.id}>{member.name} / {member.type}</option>
                ))}
              </datalist>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestedSalespeople.map((member) => (
                  <button key={member.id} type="button" onClick={() => setPoolSalespersonId(member.id)} className={`rounded-2xl border px-3 py-2 text-left text-[11px] font-black transition ${String(member.id) === String(poolSalespersonId) ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                    {member.name} / {member.type}
                  </button>
                ))}
              </div>
              <div className="mt-3 text-xs font-medium text-slate-500">
                {currentAssignee ? `${t.crmCurrentCandidate || '当前候选'}：${currentAssignee.name} / ${currentAssignee.type} / ID ${currentAssignee.id}` : (t.crmSalespersonSearchHint || '支持手填，也支持根据姓名、ID、业务线联想搜索。')}
              </div>
              <button onClick={() => openPoolConfirmation('private')} disabled={isPoolUpdating} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-white disabled:opacity-50">{t.crmAssignPrivateButton || '分配到私海'}</button>
            </div>
            <textarea value={poolReason} onChange={(event) => setPoolReason(event.target.value)} rows={3} className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" placeholder={t.crmPoolReasonPlaceholder || '填写分配、回收、释放到公海的原因'} />
            {pendingCopy && pendingPoolAction && (
              <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{t.crmPoolActionPreview || '动作预览'}</div>
                    <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{pendingCopy.title}</div>
                  </div>
                  <span className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    {poolLabels[currentPoolState]} → {poolLabels[pendingPoolAction]}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t.crmPoolActionReason || '原因'}</div>
                    <div className="mt-2 text-xs font-bold text-slate-700 dark:text-slate-200">{trimmedReason || (t.crmPoolNoReasonWarning || '未填写原因，建议补充后再确认')}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{t.crmPoolActionImpact || '影响预览'}</div>
                    <div className="mt-2 text-xs font-bold leading-relaxed text-slate-700 dark:text-slate-200">{pendingCopy.summary}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <button type="button" onClick={() => setPendingPoolAction(null)} disabled={isPoolUpdating} className="rounded-2xl border border-slate-200 px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
                    {t.cancel || '取消'}
                  </button>
                  <button type="button" onClick={confirmPoolAction} disabled={isPoolUpdating} className={`rounded-2xl px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] disabled:opacity-50 ${pendingCopy.buttonClassName}`}>
                    {isPoolUpdating ? (t.crmPoolUpdating || '提交中') : (t.crmPoolConfirmAction || '确认并记录')}
                  </button>
                </div>
              </div>
            )}
            {lastConfirmedAction && (
              <div className="rounded-[22px] border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
                {t.crmPoolActionConfirmedRecord || '确认记录'}：{poolActionCopy[lastConfirmedAction.action].title} / {lastConfirmedAction.reason} / {lastConfirmedAction.confirmedAt}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] border border-slate-100 bg-white p-4 text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-950">
          {t.crmCurrentPool || '当前池'}：<span className="font-black text-slate-900 dark:text-white">{currentPoolState.toUpperCase()}</span>
          <div className="mt-2">{t.crmReason || '原因'}：{poolHistorySummary?.poolReason || '--'}</div>
          <div className="mt-1">{t.crmLastUpdated || '更新时间'}：{poolHistorySummary?.poolUpdatedAt || '--'}</div>
        </div>
      )}
    </section>
  );
}

export function CRMCustomerAddressesSection({
  t,
  addresses,
  readOnlyProfile,
  onAddAddress,
  onUpdateAddress,
}: {
  t: TranslationText;
  addresses: CustomerAddress[];
  readOnlyProfile: boolean;
  onAddAddress: () => void;
  onUpdateAddress: <K extends keyof CustomerAddress>(idx: number, field: K, value: CustomerAddress[K]) => void;
}) {
  return (
    <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-4 flex items-center justify-between">
        <SectionTitle title={t.crmSitesAddressesTitle || '地址与站点'} subtitle={t.crmSitesAddresses || 'Sites & Addresses'} />
        <button disabled={readOnlyProfile} onClick={onAddAddress} className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900">{t.crmAddSite || '新增站点'}</button>
      </div>
      <fieldset disabled={readOnlyProfile} className="space-y-4 disabled:opacity-70">
        {addresses.length === 0 && (
          <div className="rounded-[22px] border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-950">{t.crmNoAddressSites || '暂无地址站点'}</div>
        )}
        {addresses.map((address, idx) => (
          <div key={address.id || idx} className="rounded-[24px] border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-white">{address.label || `${addressTypeLabel[address.type]} ${idx + 1}`}</div>
                <div className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400">{addressTypeLabel[address.type]} {address.isPrimary ? ` / ${t.crmPrimaryTag || 'PRIMARY'}` : ''}</div>
              </div>
              <div className="text-xs font-bold text-slate-500">{address.countryCode || '--'} {address.city ? `· ${address.city}` : ''}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <select className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={address.type} onChange={(event) => onUpdateAddress(idx, 'type', event.target.value as CustomerAddress['type'])}>
                <option value="legal">法定主体</option>
                <option value="shipping">发货地址</option>
                <option value="billing">账单地址</option>
                <option value="office">办公地址</option>
                <option value="other">{t.crmOther || '其他'}</option>
              </select>
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={address.label || ''} onChange={(event) => onUpdateAddress(idx, 'label', event.target.value)} placeholder={t.crmSiteLabelPlaceholder || '站点标签'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={address.registeredName || ''} onChange={(event) => onUpdateAddress(idx, 'registeredName', event.target.value)} placeholder={t.crmRegisteredNamePlaceholder || '注册名称'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={address.registrationNo || ''} onChange={(event) => onUpdateAddress(idx, 'registrationNo', event.target.value)} placeholder={t.crmRegistrationNoPlaceholder || '注册号'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={address.taxNo || ''} onChange={(event) => onUpdateAddress(idx, 'taxNo', event.target.value)} placeholder={t.crmTaxNoPlaceholder || '税号'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold uppercase outline-none dark:border-slate-700 dark:bg-slate-900" value={address.countryCode || ''} onChange={(event) => onUpdateAddress(idx, 'countryCode', event.target.value.toUpperCase())} placeholder={t.crmCountryCodePlaceholder || '国家代码'} />
            </div>
            <textarea className="mt-3 min-h-[84px] w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={address.fullAddress || ''} onChange={(event) => onUpdateAddress(idx, 'fullAddress', event.target.value)} placeholder={t.crmFullAddressPlaceholder || '完整地址'} />
            <div className="mt-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400"><MapPin size={12} />{address.isPrimary ? (t.crmPrimarySite || 'Primary Site') : (t.crmSecondarySite || 'Secondary Site')}</div>
          </div>
        ))}
      </fieldset>
    </section>
  );
}

export function CRMCustomerContactsSection({
  t,
  contacts,
  readOnlyProfile,
  onAddContact,
  onUpdateContact,
}: {
  t: TranslationText;
  contacts: Contact[];
  readOnlyProfile: boolean;
  onAddContact: () => void;
  onUpdateContact: <K extends keyof Contact>(idx: number, field: K, value: Contact[K]) => void;
}) {
  return (
    <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-4 flex items-center justify-between">
        <SectionTitle title={t.crmContactsTitle || '联系人'} subtitle={t.crmContacts || 'Contacts'} />
        <button disabled={readOnlyProfile} onClick={onAddContact} className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900"><UserPlus size={14} className="mr-1 inline-flex" />{t.crmAddContact || '新增联系人'}</button>
      </div>
      <fieldset disabled={readOnlyProfile} className="space-y-4 disabled:opacity-70">
        {contacts.length === 0 && (
          <div className="rounded-[22px] border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-950">{t.crmNoContacts || '暂无联系人'}</div>
        )}
        {contacts.map((contact, idx) => (
          <div key={`${contact.name || 'contact'}-${idx}`} className="rounded-[24px] border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-white">{contact.name || `联系人 ${idx + 1}`}</div>
                <div className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400">{contact.isPrimary ? (t.crmPrimaryContactTag || 'PRIMARY CONTACT') : (t.crmSecondaryContactTag || 'SECONDARY CONTACT')}</div>
              </div>
              <div className="text-xs font-bold text-slate-500">{contact.language || '--'} {contact.department ? `· ${contact.department}` : ''}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.name || ''} onChange={(event) => onUpdateContact(idx, 'name', event.target.value)} placeholder={t.crmContactNamePlaceholder || '姓名'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.role || contact.position || ''} onChange={(event) => onUpdateContact(idx, 'role', event.target.value)} placeholder={t.crmRoleTitlePlaceholder || '角色 / 职务'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.phone || ''} onChange={(event) => onUpdateContact(idx, 'phone', event.target.value)} placeholder={t.crmPhonePlaceholder || '电话'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.email || ''} onChange={(event) => onUpdateContact(idx, 'email', event.target.value)} placeholder={t.crmEmailPlaceholder || '邮箱'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.department || ''} onChange={(event) => onUpdateContact(idx, 'department', event.target.value)} placeholder={t.crmDepartmentPlaceholder || '部门'} />
              <select className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.language || ''} onChange={(event) => onUpdateContact(idx, 'language', (event.target.value || undefined) as Contact['language'])}>
                <option value="">{t.crmCommonLanguage || '常用语言'}</option>
                <option value="zh">{t.crmChinese || '中文'}</option>
                <option value="en">{t.crmEnglish || 'English'}</option>
                <option value="vi">{t.crmVietnamese || 'Tiếng Việt'}</option>
              </select>
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.mobile || ''} onChange={(event) => onUpdateContact(idx, 'mobile', event.target.value)} placeholder={t.crmMobilePlaceholder || '手机 / Mobile'} />
              <input className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900" value={contact.siteLabel || ''} onChange={(event) => onUpdateContact(idx, 'siteLabel', event.target.value)} placeholder={t.crmSiteLabelPlaceholder || '关联站点标签'} />
            </div>
          </div>
        ))}
      </fieldset>
    </section>
  );
}

export function CRMCustomerAuditSection({
  t,
  selectedCustomer,
  aiInsight,
  loadingAi,
  onFetchAiInsight,
  poolHistory,
  poolHistoryLatest,
  poolHistorySummary,
  loadingPoolHistory,
}: {
  t: TranslationText;
  selectedCustomer: Customer;
  aiInsight: string | null;
  loadingAi: boolean;
  onFetchAiInsight: (customer: Customer) => void;
  poolHistory: CustomerPoolHistoryEntry[];
  poolHistoryLatest: CustomerPoolHistoryEntry | null;
  poolHistorySummary: PoolHistorySummary;
  loadingPoolHistory: boolean;
}) {
  return (
    <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
      <SectionTitle title={t.crmAuditInsightTitle || '审计与洞察'} subtitle={t.crmAuditInsight || 'Audit & Insight'} />
      <button onClick={() => onFetchAiInsight(selectedCustomer)} disabled={loadingAi} className="flex w-full items-center justify-center rounded-[22px] bg-slate-900 px-4 py-4 text-[11px] font-black uppercase tracking-[0.18em] text-white dark:bg-white dark:text-slate-900">
        {loadingAi ? <Loader2 className="mr-2 animate-spin" size={16} /> : <BrainCircuit className="mr-2" size={16} />}
        {loadingAi ? (t.crmGenerating || '生成中') : (t.crmGenerateSmartRiskSummary || '生成智能风险摘要')}
      </button>
      {aiInsight && <div className="mt-4 rounded-[22px] border border-blue-100 bg-blue-50 px-4 py-4 text-sm font-medium text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100">{aiInsight}</div>}
      <div className="mt-5">
        <CRMCustomerPoolAudit t={t} history={poolHistory} latest={poolHistoryLatest} currentPool={poolHistorySummary} loading={loadingPoolHistory} />
      </div>
    </section>
  );
}
