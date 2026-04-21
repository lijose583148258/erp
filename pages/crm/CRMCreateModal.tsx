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
import { AddressCard, ContactCard, createEmptyAddress, createEmptyContact } from './CRMCustomerFormCards';

type Props = {
  t: any;
  isSubmitting: boolean;
  newCustomer: Partial<Customer>;
  setNewCustomer: React.Dispatch<React.SetStateAction<Partial<Customer>>>;
  onCreate: () => void;
  onClose: () => void;
  lockedSegment?: 'direct' | 'channel' | 'mixed' | null;
};

export function CRMCreateModal({ t, isSubmitting, newCustomer, setNewCustomer, onCreate, onClose, lockedSegment = null }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  return (
    <div data-testid="crm-create-modal" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-md animate-in fade-in">
      <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[40px] border border-white/40 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6 dark:border-slate-800">
            <div>
            <div className="text-[11px] font-black uppercase tracking-[0.32em] text-blue-500">{t.crmCustomerOnboarding || 'Customer Onboarding'}</div>
            <h2 className="mt-2 text-3xl font-black italic tracking-tight text-slate-900 dark:text-white">{t.crmCreateCustomerMaster || '新建客户主数据'}</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">{t.crmCreateCustomerMasterHint || '先完成主档，再逐步补充站点、联系人、客户池与风控信息。'}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-3 text-slate-500 transition hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div className="grid max-h-[calc(92vh-96px)] grid-cols-1 overflow-y-auto lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-8 px-8 py-8">
            <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-2xl bg-blue-600 p-3 text-white"><Building2 size={18} /></div>
                  <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{t.crmCompanyMaster || '公司主档'}</h3>
                  <p className="text-xs font-medium text-slate-500">{t.crmCompanyMasterHint || '一家公司一条主数据，支持中文、英文、越南文并存。'}</p>
                  </div>
                </div>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t.crmPrimaryName || 'Primary Name'}</label>
                  <input
                    data-testid="crm-name"
                    className="w-full rounded-[20px] border border-slate-200 bg-white px-5 py-4 font-bold outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.name || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })}
                    placeholder={t.crmPrimaryNamePlaceholder || '例如：爱劳达集团 / AiLaoda Group'}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    data-testid="crm-name-zh"
                    className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.nameZh || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, nameZh: event.target.value })}
                    placeholder={t.crmNameZhPlaceholder || '中文名称'}
                  />
                  <input
                    data-testid="crm-name-en"
                    className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.nameEn || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, nameEn: event.target.value })}
                    placeholder={t.crmNameEnPlaceholder || 'English name'}
                  />
                  <input
                    data-testid="crm-name-vi"
                    className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.nameVi || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, nameVi: event.target.value })}
                    placeholder={t.crmNameViPlaceholder || 'Tên tiếng Việt'}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-500 p-3 text-white"><MapPin size={18} /></div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{t.crmPrimaryAddressTitle || '主地址 / 主体站点'}</h3>
                  <p className="text-xs font-medium text-slate-500">{t.crmPrimaryAddressHint || '先录 1 个核心地址，后续再补账单地址、发货地址、办公地址。'}</p>
                </div>
              </div>
                <AddressCard t={t} address={primaryAddress} testIdPrefix="crm-primary-address" onChange={(patch) => updateAddress(0, { ...patch, isPrimary: true })} />
            </section>

            <section className="rounded-[30px] border border-slate-100 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl bg-violet-500 p-3 text-white"><UserRound size={18} /></div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{t.crmPrimaryContactTitle || '主联系人'}</h3>
                  <p className="text-xs font-medium text-slate-500">{t.crmPrimaryContactHint || '至少保留一个可联系的人，后续再扩展完整通讯录。'}</p>
                </div>
              </div>
              <ContactCard t={t} contact={primaryContact} testIdPrefix="crm-primary-contact" onChange={(patch) => updateContact(0, { ...patch, isPrimary: true })} />
            </section>

            <section className="rounded-[30px] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <button data-testid="crm-advanced-toggle" type="button" onClick={() => setShowAdvanced((value) => !value)} className="flex w-full items-center justify-between text-left">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-900 p-3 text-white dark:bg-white dark:text-slate-900"><ShieldCheck size={18} /></div>
                  <div>
                    <div className="text-lg font-black text-slate-900 dark:text-white">{t.crmAdvancedFields || '高级字段'}</div>
                    <div className="text-xs font-medium text-slate-500">{t.crmAdvancedFieldsHint || '别名、证照、信用、更多地址、更多联系人、档案备注。'}</div>
                  </div>
                </div>
                {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {showAdvanced && (
                <div className="mt-6 space-y-6 border-t border-slate-100 pt-6 dark:border-slate-800">
                  <div>
                    <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{t.crmAliasesLabel || 'Aliases / 历史名 / 交易名'}</label>
                    <textarea
                      data-testid="crm-aliases"
                      className="min-h-[96px] w-full rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={(newCustomer.nameAliases || []).join('\n')}
                      onChange={(event) => setNewCustomer({ ...newCustomer, nameAliases: splitCustomerTextList(event.target.value) })}
                      placeholder={t.crmAliasesPlaceholder || '每行一个别名或历史名'}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <input
                      className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={primaryAddress.registeredName || ''}
                      onChange={(event) => updateAddress(0, { registeredName: event.target.value })}
                      placeholder={t.crmRegisteredNamePlaceholder || '注册名称'}
                    />
                    <input
                      className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={primaryAddress.registrationNo || ''}
                      onChange={(event) => updateAddress(0, { registrationNo: event.target.value })}
                      placeholder={t.crmRegistrationNoPlaceholder || '注册号'}
                    />
                    <input
                      className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={primaryAddress.taxNo || ''}
                      onChange={(event) => updateAddress(0, { taxNo: event.target.value })}
                      placeholder={t.crmTaxNoPlaceholder || '税号 / VAT'}
                    />
                    <input
                      data-testid="crm-license-number"
                      className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={newCustomer.licenseNumber || ''}
                      onChange={(event) => setNewCustomer({ ...newCustomer, licenseNumber: event.target.value })}
                      placeholder={t.crmLicenseNumberPlaceholder || '内部证照编号'}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <input
                      data-testid="crm-credit-limit"
                      type="number"
                      className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={newCustomer.creditLimit ?? 50000}
                      onChange={(event) => setNewCustomer({ ...newCustomer, creditLimit: Number(event.target.value) })}
                      placeholder={t.crmCreditLimitPlaceholder || '信用额度'}
                    />
                    <input
                      data-testid="crm-terms-days"
                      type="number"
                      className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={newCustomer.termsDays ?? 30}
                      onChange={(event) => setNewCustomer({ ...newCustomer, termsDays: Number(event.target.value) })}
                      placeholder={t.crmTermsDaysPlaceholder || '账期天数'}
                    />
                    <select
                      data-testid="crm-risk-level"
                      className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                      value={newCustomer.riskLevel || RiskLevel.MEDIUM}
                      onChange={(event) => setNewCustomer({ ...newCustomer, riskLevel: event.target.value as RiskLevel })}
                    >
                      {riskOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {lockedSegment ? (
                      <div className={`flex items-center justify-center rounded-[18px] border px-4 py-3 text-sm font-black ${segmentMeta[lockedSegment].tone}`}>
                        {segmentLabels[lockedSegment]}
                      </div>
                    ) : (
                      <select
                        data-testid="crm-segment"
                        className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                        value={newCustomer.segment || 'direct'}
                        onChange={(event) => setNewCustomer({ ...newCustomer, segment: event.target.value as Customer['segment'] })}
                      >
                        <option value="direct">{segmentLabels.direct}</option>
                        <option value="channel">{segmentLabels.channel}</option>
                        <option value="mixed">{segmentLabels.mixed}</option>
                      </select>
                    )}
                  </div>

                  <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
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

                  <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
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

                  <textarea
                    data-testid="crm-notes"
                    className="min-h-[96px] w-full rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-900"
                    value={newCustomer.notes || ''}
                    onChange={(event) => setNewCustomer({ ...newCustomer, notes: event.target.value })}
                    placeholder={t.crmNotesPlaceholder || '档案备注 / 风控提醒 / 客户背景'}
                  />
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
