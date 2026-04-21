import React, { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  ChevronDown,
  ChevronUp,
  FileStack,
  Globe2,
  Loader2,
  MapPin,
  Plus,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import type { Contact, Customer, CustomerAddress } from '../../types';
import { RiskLevel } from '../../types';
import { splitCustomerTextList } from '../../utils/customerAlias';

type Props = {
  t: any;
  isSubmitting: boolean;
  newCustomer: Partial<Customer>;
  setNewCustomer: React.Dispatch<React.SetStateAction<Partial<Customer>>>;
  onCreate: () => void;
  onClose: () => void;
  lockedSegment?: 'direct' | 'channel' | 'mixed' | null;
};

const createEmptyAddress = (type: CustomerAddress['type'] = 'legal'): CustomerAddress => ({
  type,
  label: type === 'legal' ? '法定主体' : type === 'shipping' ? '发货站点' : '附加站点',
  fullAddress: '',
  isPrimary: type === 'legal',
  countryCode: '',
});

const createEmptyContact = (isPrimary = true): Contact => ({
  name: '',
  position: '',
  phone: '',
  email: '',
  isPrimary,
  role: '',
  department: '',
  language: 'zh',
  mobile: '',
  whatsapp: '',
  wechat: '',
  siteLabel: '',
});

const AddressCard = ({
  t,
  address,
  onChange,
  testIdPrefix,
}: {
  t: any;
  address: CustomerAddress;
  onChange: (patch: Partial<CustomerAddress>) => void;
  testIdPrefix?: string;
}) => (
  <div className="rounded-[24px] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
    <div className="grid gap-3 md:grid-cols-3">
      <select
        data-testid={testIdPrefix ? `${testIdPrefix}-type` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={address.type}
        onChange={(event) => onChange({ type: event.target.value as CustomerAddress['type'] })}
      >
        <option value="legal">{t.crmAddressTypeLegal || '法定主体'}</option>
        <option value="shipping">{t.crmAddressTypeShipping || '发货地址'}</option>
        <option value="billing">{t.crmAddressTypeBilling || '账单地址'}</option>
        <option value="office">{t.crmAddressTypeOffice || '办公地址'}</option>
        <option value="other">{t.crmAddressTypeOther || '其他站点'}</option>
      </select>
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-label` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={address.label || ''}
        onChange={(event) => onChange({ label: event.target.value })}
        placeholder={t.crmSiteLabelPlaceholder || '站点标签'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-country` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold uppercase outline-none dark:border-slate-700 dark:bg-slate-900"
        value={address.countryCode || ''}
        onChange={(event) => onChange({ countryCode: event.target.value.toUpperCase() })}
        placeholder={t.crmCountryCodePlaceholder || '国家代码'}
      />
    </div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-registered-name` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={address.registeredName || ''}
        onChange={(event) => onChange({ registeredName: event.target.value })}
        placeholder={t.crmRegisteredNamePlaceholder || '注册名称'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-registration-no` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={address.registrationNo || ''}
        onChange={(event) => onChange({ registrationNo: event.target.value })}
        placeholder={t.crmRegistrationNoPlaceholder || '注册号 / 营业执照号'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-tax-no` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={address.taxNo || ''}
        onChange={(event) => onChange({ taxNo: event.target.value })}
        placeholder={t.crmTaxNoPlaceholder || '税号 / VAT'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-city` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={address.city || ''}
        onChange={(event) => onChange({ city: event.target.value })}
        placeholder={t.crmCityPlaceholder || '城市'}
      />
    </div>
    <textarea
      data-testid={testIdPrefix ? `${testIdPrefix}-full-address` : undefined}
      className="mt-3 min-h-[84px] w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
      value={address.fullAddress || ''}
      onChange={(event) => onChange({ fullAddress: event.target.value })}
      placeholder={t.crmFullAddressPlaceholder || '完整地址'}
    />
  </div>
);

const ContactCard = ({
  t,
  contact,
  onChange,
  testIdPrefix,
}: {
  t: any;
  contact: Contact;
  onChange: (patch: Partial<Contact>) => void;
  testIdPrefix?: string;
}) => (
  <div className="rounded-[24px] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
    <div className="grid gap-3 md:grid-cols-2">
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-name` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={contact.name || ''}
        onChange={(event) => onChange({ name: event.target.value })}
        placeholder={t.crmContactNamePlaceholder || '联系人姓名'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-role` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={contact.role || contact.position || ''}
        onChange={(event) => onChange({ role: event.target.value, position: event.target.value })}
        placeholder={t.crmRoleTitlePlaceholder || '角色 / 职务'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-phone` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={contact.phone || ''}
        onChange={(event) => onChange({ phone: event.target.value })}
        placeholder={t.crmPhonePlaceholder || '电话'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-email` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={contact.email || ''}
        onChange={(event) => onChange({ email: event.target.value })}
        placeholder={t.crmEmailPlaceholder || '邮箱'}
      />
      <input
        data-testid={testIdPrefix ? `${testIdPrefix}-department` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={contact.department || ''}
        onChange={(event) => onChange({ department: event.target.value })}
        placeholder={t.crmDepartmentPlaceholder || '部门'}
      />
      <select
        data-testid={testIdPrefix ? `${testIdPrefix}-language` : undefined}
        className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
        value={contact.language || ''}
        onChange={(event) => onChange({ language: event.target.value as Contact['language'] })}
      >
        <option value="">{t.crmCommonLanguage || '常用语言'}</option>
        <option value="zh">{t.crmChinese || '中文'}</option>
        <option value="en">{t.crmEnglish || 'English'}</option>
        <option value="vi">{t.crmVietnamese || 'Tiếng Việt'}</option>
      </select>
    </div>
  </div>
);

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

          <aside className="border-l border-slate-100 bg-slate-50/70 px-8 py-8 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="sticky top-0 space-y-6">
              <div className="rounded-[28px] bg-white p-6 shadow-sm dark:bg-slate-950">
                <div className="flex items-center gap-3">
                  <Globe2 className="text-blue-500" />
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{t.crmCommercialPreview || 'Commercial Preview'}</div>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{previewName}</div>
                    <div className="mt-2 space-y-1 text-[11px] font-bold text-slate-500">
                      {newCustomer.nameZh && <div>ZH: {newCustomer.nameZh}</div>}
                      {newCustomer.nameEn && <div>EN: {newCustomer.nameEn}</div>}
                      {newCustomer.nameVi && <div>VI: {newCustomer.nameVi}</div>}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{t.crmBusinessProfile || 'Business Profile'}</div>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${segmentMeta[segment].tone}`}>{segmentMeta[segment].label}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs font-bold text-slate-500">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{t.crmCreditLimit || '信用额度'}</div>
                        <div className="mt-1 text-sm text-slate-900 dark:text-white">{Number(newCustomer.creditLimit || 0).toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{t.crmTerms || '账期'}</div>
                        <div className="mt-1 text-sm text-slate-900 dark:text-white">{newCustomer.termsDays || 30} 天</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{t.crmCompletion || '建档完成度'}</div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="text-3xl font-black text-slate-900 dark:text-white">{readyCount}/4</div>
                      <div className="text-xs font-medium text-slate-500">{t.crmCompletionHint || '名称、主地址、主联系人、联系方式齐全后更适合直接进入业务流。'}</div>
                    </div>
                    <div className="mt-4 space-y-2 text-xs font-bold">
                      {[
                        [t.crmMainName || '主名称', checklist[0]],
                        [t.crmMainAddress || '主地址', checklist[1]],
                        [t.crmMainContact || '主联系人', checklist[2]],
                        [t.crmContactInfo || '联系方式', checklist[3]],
                      ].map(([label, ready]) => (
                        <div key={label} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2 text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                          <span>{label}</span>
                          {ready ? <BadgeCheck size={14} className="text-emerald-500" /> : <FileStack size={14} className="text-slate-300" />}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <button
                data-testid="crm-create-submit"
                onClick={onCreate}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center rounded-[24px] bg-slate-900 px-6 py-4 text-sm font-black uppercase tracking-[0.24em] text-white shadow-2xl transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900"
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : (t.crmCreateCustomerMaster || '创建客户主档')}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
