import React, { useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  MapPin,
  Plus,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import type { Contact, Customer, CustomerAddress } from '../../types';
import { RiskLevel } from '../../types';
import { splitCustomerTextList } from '../../utils/customerAlias';
import { CRMCreatePreviewPanel } from './CRMCreatePreviewPanel';
import { createEmptyAddress, createEmptyContact } from './CRMCustomerFormFactories';
import { AddressCard, ContactCard } from './CRMCustomerFormCards';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { useDialogFocus } from '../../app/useDialogFocus';

type Props = {
  t: any;
  isSubmitting: boolean;
  newCustomer: Partial<Customer>;
  setNewCustomer: React.Dispatch<React.SetStateAction<Partial<Customer>>>;
  onCreate: () => void;
  onClose: () => void;
  lockedSegment?: 'direct' | 'channel' | 'mixed' | null;
};

const advancedControlClass =
 'mt-1.5 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition-[border-color,box-shadow] duration-150 focus:border-slate-300 focus:ring-4 focus:ring-slate-100 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900';
const advancedLabelClass = 'block text-xs font-black text-slate-600 dark:text-slate-300';

export function CRMCreateModal({ t, isSubmitting, newCustomer, setNewCustomer, onCreate, onClose, lockedSegment = null }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const { requestClose } = useUnsavedForm({
    sourceId: 'crm-create-customer',
    label: '新建客户',
    open: true,
    value: newCustomer,
  });
  const handleClose = React.useCallback(() => requestClose(onClose), [onClose, requestClose]);
  useDialogFocus(true, dialogRef, handleClose);
  const segmentMeta = {
    direct: { label: t.crmSegmentDirect || '内销直销', tone: 'bg-blue-50 text-blue-600 border-blue-200' },
    channel: { label: t.crmSegmentChannel || '分销渠道', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
    mixed: { label: t.crmSegmentMixed || '混合经营', tone: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  } as const;
  const segmentLabels = {
    direct: t.crmSegmentDirect || '内销直销',
    channel: t.crmSegmentChannel || '分销渠道',
    mixed: t.crmSegmentMixed || '混合经营',
  } as const;
  const riskOptions = [
    { value: RiskLevel.LOW, label: t.crmRiskLow || '低风险' },
    { value: RiskLevel.MEDIUM, label: t.crmRiskMedium || '中风险' },
    { value: RiskLevel.HIGH, label: t.crmRiskHigh || '高风险' },
    { value: RiskLevel.CRITICAL, label: t.crmRiskCritical || '关键风险' },
  ];

  const addresses = useMemo(
    () => (Array.isArray(newCustomer.addresses) && newCustomer.addresses.length > 0 ? newCustomer.addresses : [createEmptyAddress()]),
    [newCustomer.addresses],
  );
  const contacts = useMemo(
    () => (Array.isArray(newCustomer.contacts) && newCustomer.contacts.length > 0 ? newCustomer.contacts : [createEmptyContact()]),
    [newCustomer.contacts],
  );

  const setAddresses = (nextAddresses: CustomerAddress[]) => {
    setNewCustomer((prev) => ({ ...prev, addresses: nextAddresses }));
  };

  const setContacts = (nextContacts: Contact[]) => {
    setNewCustomer((prev) => ({ ...prev, contacts: nextContacts }));
  };

  const updateAddress = (index: number, patch: Partial<CustomerAddress>) => {
    const next = [...addresses];
    next[index] = { ...next[index], ...patch };
    if (patch.isPrimary) {
      next.forEach((address, idx) => {
        next[idx] = { ...address, isPrimary: idx === index };
      });
    }
    setAddresses(next);
  };

  const updateContact = (index: number, patch: Partial<Contact>) => {
    const next = [...contacts];
    next[index] = { ...next[index], ...patch };
    if (patch.isPrimary) {
      next.forEach((contact, idx) => {
        next[idx] = { ...contact, isPrimary: idx === index };
      });
    }
    setContacts(next);
  };

  const primaryAddress = addresses[0];
  const primaryContact = contacts[0];
  const segment = (newCustomer.segment || lockedSegment || 'direct') as 'direct' | 'channel' | 'mixed';
  const previewName = newCustomer.name || newCustomer.nameZh || newCustomer.nameEn || newCustomer.nameVi || '未命名客户';
  const checklist = [
    Boolean(previewName && previewName !== '未命名客户'),
    Boolean(primaryAddress.fullAddress),
    Boolean(primaryContact.name),
    Boolean(primaryContact.phone || primaryContact.email),
  ];
  const readyCount = checklist.filter(Boolean).length;
  const aliases = newCustomer.nameAliases || [];
  const longestAliasLength = aliases.reduce((max, alias) => Math.max(max, String(alias).length), 0);
  const aliasesOverLimit = aliases.length > 50 || longestAliasLength > 160;
  const notesLength = String(newCustomer.notes || '').length;
  const notesOverLimit = notesLength > 1000;

  return (
 <div data-testid="crm-create-modal" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-create-title"
 aria-describedby="crm-create-description"
        tabIndex={-1}
        className="max-h-[96vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6 dark:border-slate-800">
            <div>
            <div className="text-xs font-black text-blue-600">{t.crmCustomerOnboarding || '客户建档'}</div>
            <h2 id="crm-create-title" className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{t.crmCreateCustomerMaster || '新建客户主数据'}</h2>
 <p id="crm-create-description" className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{t.crmCreateCustomerMasterHint || '按 1 公司主档、2 主地址、3 主联系人、4 高级信息的顺序填写；右侧会实时说明本次保存写入什么。'}</p>
          </div>
 <button aria-label={t.close || '关闭'} data-testid="crm-create-close" onClick={handleClose} className="min-h-11 min-w-11 rounded-xl bg-slate-100 p-3 text-slate-600 transition-colors duration-150 hover:text-slate-900 motion-reduce:transition-none dark:bg-slate-800 dark:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div className="grid max-h-[calc(96vh-88px)] grid-cols-1 overflow-y-auto lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5 px-4 py-5 sm:px-6">
 <section data-form-section="company-master" aria-labelledby="crm-create-company-title" className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="mb-5 flex items-center gap-3">
 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white" aria-hidden="true"><Building2 size={18} /></div>
                  <div>
 <div className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">第 1 步 · 确认客户身份</div>
 <h3 id="crm-create-company-title" className="text-lg font-black text-slate-900 dark:text-white">{t.crmCompanyMaster || '公司主档'}</h3>
                  <p className="text-xs font-medium text-slate-500">{t.crmCompanyMasterHint || '一家公司一条主数据，支持中文、英文、越南文并存。'}</p>
                  </div>
                </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="crm-name" className="mb-2 block text-xs font-black text-slate-600 dark:text-slate-300">{t.crmPrimaryName || '主名称'}</label>
                  <input
                    id="crm-name"
                    data-autofocus
                    data-testid="crm-name"
                    className="w-full rounded-xl border border-slate-200 bg-white px-5 py-4 font-bold outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.name || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })}
                    maxLength={160}
                    placeholder={t.crmPrimaryNamePlaceholder || '例如：爱劳达集团 / AiLaoda Group'}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
 <label className="block text-xs font-black text-slate-600 dark:text-slate-300">
 中文名称
                  <input
                    data-testid="crm-name-zh"
 className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none transition-[border-color,box-shadow] duration-150 focus:border-blue-300 focus:ring-4 focus:ring-blue-100 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.nameZh || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, nameZh: event.target.value })}
                    maxLength={160}
                    placeholder={t.crmNameZhPlaceholder || '中文名称'}
                  />
 </label>
 <label className="block text-xs font-black text-slate-600 dark:text-slate-300">
 English name
                  <input
                    data-testid="crm-name-en"
 className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none transition-[border-color,box-shadow] duration-150 focus:border-blue-300 focus:ring-4 focus:ring-blue-100 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.nameEn || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, nameEn: event.target.value })}
                    maxLength={160}
                    placeholder={t.crmNameEnPlaceholder || 'English name'}
                  />
 </label>
 <label className="block text-xs font-black text-slate-600 dark:text-slate-300">
 Tên tiếng Việt
                  <input
                    data-testid="crm-name-vi"
 className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none transition-[border-color,box-shadow] duration-150 focus:border-blue-300 focus:ring-4 focus:ring-blue-100 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.nameVi || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, nameVi: event.target.value })}
                    maxLength={160}
                    placeholder={t.crmNameViPlaceholder || 'Tên tiếng Việt'}
                  />
 </label>
                </div>
              </div>
            </section>

 <section data-form-section="primary-address" aria-labelledby="crm-create-address-title" className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-500 p-3 text-white"><MapPin size={18} /></div>
                <div>
 <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600">第 2 步 · 确认业务发生地点</div>
 <h3 id="crm-create-address-title" className="text-lg font-black text-slate-900 dark:text-white">{t.crmPrimaryAddressTitle || '主地址 / 主体站点'}</h3>
                  <p className="text-xs font-medium text-slate-500">{t.crmPrimaryAddressHint || '先录 1 个核心地址，后续再补账单地址、发货地址、办公地址。'}</p>
                </div>
              </div>
                <AddressCard t={t} address={primaryAddress} testIdPrefix="crm-primary-address" onChange={(patch) => updateAddress(0, { ...patch, isPrimary: true })} />
            </section>

 <section data-form-section="primary-contact" aria-labelledby="crm-create-contact-title" className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-violet-500 p-3 text-white"><UserRound size={18} /></div>
                <div>
 <div className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-600">第 3 步 · 确认日常联系对象</div>
 <h3 id="crm-create-contact-title" className="text-lg font-black text-slate-900 dark:text-white">{t.crmPrimaryContactTitle || '主联系人'}</h3>
                  <p className="text-xs font-medium text-slate-500">{t.crmPrimaryContactHint || '至少保留一个可联系的人，后续再扩展完整通讯录。'}</p>
                </div>
              </div>
              <ContactCard t={t} contact={primaryContact} testIdPrefix="crm-primary-contact" onChange={(patch) => updateContact(0, { ...patch, isPrimary: true })} />
            </section>

 <section data-form-section="advanced" aria-labelledby="crm-create-advanced-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
 <button
 data-testid="crm-advanced-toggle"
 type="button"
 aria-expanded={showAdvanced}
 aria-controls="crm-create-advanced-fields"
 onClick={() => setShowAdvanced((value) => !value)}
 className="flex min-h-11 w-full items-center justify-between text-left"
 >
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-900 p-3 text-white dark:bg-white dark:text-slate-900"><ShieldCheck size={18} /></div>
                  <div>
 <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">第 4 步 · 低频信息，可后补</div>
 <div id="crm-create-advanced-title" className="text-lg font-black text-slate-900 dark:text-white">{t.crmAdvancedFields || '高级字段'}</div>
                    <div className="text-xs font-medium text-slate-500">{t.crmAdvancedFieldsHint || '别名、证照、信用、更多地址、更多联系人、档案备注。'}</div>
                  </div>
                </div>
                {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {showAdvanced && (
 <div id="crm-create-advanced-fields" className="mt-6 space-y-6 border-t border-slate-100 pt-6 dark:border-slate-800">
                  <div>
                    <label htmlFor="crm-aliases" className="mb-2 block text-xs font-black text-slate-600 dark:text-slate-300">{t.crmAliasesLabel || '别名 / 历史名 / 交易名'}</label>
                    <textarea
                      id="crm-aliases"
                      data-testid="crm-aliases"
                      className="min-h-[96px] w-full rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={(newCustomer.nameAliases || []).join('\n')}
                      onChange={(event) => setNewCustomer({ ...newCustomer, nameAliases: splitCustomerTextList(event.target.value) })}
                      aria-invalid={aliasesOverLimit}
                      aria-describedby="crm-aliases-count"
                      placeholder={t.crmAliasesPlaceholder || '每行一个别名或历史名'}
                    />
                    <div id="crm-aliases-count" className={`mt-1 text-right text-xs font-medium ${aliasesOverLimit ? 'text-red-600' : 'text-slate-500'}`}>
                      {aliasesOverLimit
                        ? `别名最多 50 个，每个最多 160 字符；当前 ${aliases.length} 个，最长 ${longestAliasLength} 字符。`
                        : `${aliases.length}/50 个别名，最长 ${longestAliasLength}/160 字符`}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <label className={advancedLabelClass}>
 注册名称
                    <input
 className={advancedControlClass}
                      value={primaryAddress.registeredName || ''}
                      onChange={(event) => updateAddress(0, { registeredName: event.target.value })}
                      maxLength={160}
 placeholder={t.crmRegisteredNamePlaceholder || '营业执照上的完整名称'}
                    />
 </label>
 <label className={advancedLabelClass}>
 注册号
                    <input
 className={advancedControlClass}
                      value={primaryAddress.registrationNo || ''}
                      onChange={(event) => updateAddress(0, { registrationNo: event.target.value })}
                      maxLength={80}
 placeholder={t.crmRegistrationNoPlaceholder || '企业登记号码'}
                    />
 </label>
 <label className={advancedLabelClass}>
 税号 / VAT
                    <input
 className={advancedControlClass}
                      value={primaryAddress.taxNo || ''}
                      onChange={(event) => updateAddress(0, { taxNo: event.target.value })}
                      maxLength={80}
 placeholder={t.crmTaxNoPlaceholder || '用于开票和税务识别'}
                    />
 </label>
 <label className={advancedLabelClass}>
 内部证照编号
                    <input
                      data-testid="crm-license-number"
 className={advancedControlClass}
                      value={newCustomer.licenseNumber || ''}
                      onChange={(event) => setNewCustomer({ ...newCustomer, licenseNumber: event.target.value })}
                      maxLength={80}
 placeholder={t.crmLicenseNumberPlaceholder || '公司内部管理编号'}
                    />
 </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <label className={advancedLabelClass}>
 信用额度
                    <input
                      data-testid="crm-credit-limit"
                      type="number"
 className={advancedControlClass}
                      value={newCustomer.creditLimit ?? 50000}
                      onChange={(event) => setNewCustomer({ ...newCustomer, creditLimit: Number(event.target.value) })}
 placeholder={t.crmCreditLimitPlaceholder || '允许未收款的最高金额'}
                    />
 </label>
 <label className={advancedLabelClass}>
 账期天数
                    <input
                      data-testid="crm-terms-days"
                      type="number"
 className={advancedControlClass}
                      value={newCustomer.termsDays ?? 30}
                      min={1}
                      max={365}
                      onChange={(event) => setNewCustomer({ ...newCustomer, termsDays: Math.min(365, Math.max(1, Number(event.target.value) || 1)) })}
 placeholder={t.crmTermsDaysPlaceholder || '从应收起算的天数'}
                    />
 </label>
 <label className={advancedLabelClass}>
 风险等级
                    <select
                      data-testid="crm-risk-level"
 className={advancedControlClass}
                      value={newCustomer.riskLevel || RiskLevel.MEDIUM}
                      onChange={(event) => setNewCustomer({ ...newCustomer, riskLevel: event.target.value as RiskLevel })}
                    >
                      {riskOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
 </label>
                    {lockedSegment ? (
 <div className={advancedLabelClass}>
 经营分群
 <div className={`mt-1.5 flex min-h-11 items-center justify-center rounded-[18px] border px-4 py-3 text-sm font-black ${segmentMeta[lockedSegment].tone}`}>
                        {segmentLabels[lockedSegment]}
                      </div>
 </div>
                    ) : (
 <label className={advancedLabelClass}>
 经营分群
                      <select
                        data-testid="crm-segment"
 className={advancedControlClass}
                        value={newCustomer.segment || 'direct'}
                        onChange={(event) => setNewCustomer({ ...newCustomer, segment: event.target.value as Customer['segment'] })}
                      >
                        <option value="direct">{segmentLabels.direct}</option>
                        <option value="channel">{segmentLabels.channel}</option>
                        <option value="mixed">{segmentLabels.mixed}</option>
                      </select>
 </label>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-black text-slate-900 dark:text-white">{t.crmMoreAddresses || '更多地址'}</div>
                        <div className="text-xs font-medium text-slate-500">{t.crmMoreAddressesHint || '继续补账单、发货、办公等站点。'}</div>
                      </div>
                      <button data-testid="crm-add-site" type="button" onClick={() => setAddresses([...addresses, createEmptyAddress('shipping')])} className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white dark:bg-white dark:text-slate-900">
                        <Plus size={14} className="mr-1" />{t.crmAddSite || '新增站点'}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {addresses.slice(1).map((address, index) => (
                        <div key={`${address.label || 'site'}-${index}`}>
                          <AddressCard t={t} address={address} testIdPrefix={`crm-address-${index + 1}`} onChange={(patch) => updateAddress(index + 1, patch)} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-black text-slate-900 dark:text-white">{t.crmMoreContacts || '更多联系人'}</div>
                        <div className="text-xs font-medium text-slate-500">{t.crmMoreContactsHint || '继续补部门、语言、移动端联系信息。'}</div>
                      </div>
                      <button data-testid="crm-add-contact" type="button" onClick={() => setContacts([...contacts, createEmptyContact(false)])} className="inline-flex items-center rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white dark:bg-white dark:text-slate-900">
                        <Plus size={14} className="mr-1" />{t.crmAddContact || '新增联系人'}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {contacts.slice(1).map((contact, index) => (
                        <div key={`${contact.name || 'contact'}-${index}`}>
                          <ContactCard t={t} contact={contact} testIdPrefix={`crm-contact-${index + 1}`} onChange={(patch) => updateContact(index + 1, patch)} />
                        </div>
                      ))}
                    </div>
                  </div>

 <label className={advancedLabelClass}>
 档案备注 / 风控提醒
                  <textarea
                    data-testid="crm-notes"
 className={`${advancedControlClass} min-h-[96px]`}
                    value={newCustomer.notes || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, notes: event.target.value })}
                    aria-invalid={notesOverLimit}
                    aria-describedby="crm-notes-count"
 placeholder={t.crmNotesPlaceholder || '记录客户背景、特殊约定或后续需核实事项'}
                  />
 </label>
                  <div id="crm-notes-count" className={`-mt-4 text-right text-xs font-medium ${notesOverLimit ? 'text-red-600' : 'text-slate-500'}`}>
                    {notesOverLimit ? `已超出 ${notesLength - 1000} 个字符` : `${notesLength}/1000`}
                  </div>
                </div>
              )}
            </section>
          </div>

          <CRMCreatePreviewPanel
            t={t}
            newCustomer={newCustomer}
            previewName={previewName}
            segment={segment}
            segmentMeta={segmentMeta}
            checklist={checklist}
            readyCount={readyCount}
            isSubmitting={isSubmitting}
            onCreate={onCreate}
          />
        </div>
      </div>
    </div>
  );
}
