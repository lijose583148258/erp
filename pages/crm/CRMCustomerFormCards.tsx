import type { Contact, CustomerAddress } from '../../types';

type TranslationText = Record<string, string | undefined>;

export function AddressCard({
  t,
  address,
  onChange,
  testIdPrefix,
}: {
  t: TranslationText;
  address: CustomerAddress;
  onChange: (patch: Partial<CustomerAddress>) => void;
  testIdPrefix?: string;
}) {
  const fullAddressLength = String(address.fullAddress || '').length;
  const fullAddressOverLimit = fullAddressLength > 500;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
      <div className="grid gap-3 md:grid-cols-3">
        <select
          data-testid={testIdPrefix ? `${testIdPrefix}-type` : undefined}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
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
          maxLength={60}
          placeholder={t.crmSiteLabelPlaceholder || '站点标签'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-country` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold uppercase outline-none dark:border-slate-700 dark:bg-slate-900"
          value={address.countryCode || ''}
          onChange={(event) => onChange({ countryCode: event.target.value.toUpperCase() })}
          maxLength={3}
          placeholder={t.crmCountryCodePlaceholder || '国家代码'}
        />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-registered-name` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={address.registeredName || ''}
          onChange={(event) => onChange({ registeredName: event.target.value })}
          maxLength={160}
          placeholder={t.crmRegisteredNamePlaceholder || '注册名称'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-registration-no` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={address.registrationNo || ''}
          onChange={(event) => onChange({ registrationNo: event.target.value })}
          maxLength={80}
          placeholder={t.crmRegistrationNoPlaceholder || '注册号 / 营业执照号'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-tax-no` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={address.taxNo || ''}
          onChange={(event) => onChange({ taxNo: event.target.value })}
          maxLength={80}
          placeholder={t.crmTaxNoPlaceholder || '税号 / VAT'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-city` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={address.city || ''}
          onChange={(event) => onChange({ city: event.target.value })}
          maxLength={80}
          placeholder={t.crmCityPlaceholder || '城市'}
        />
      </div>
      <textarea
        data-testid={testIdPrefix ? `${testIdPrefix}-full-address` : undefined}
        value={address.fullAddress || ''}
        onChange={(event) => onChange({ fullAddress: event.target.value })}
        aria-invalid={fullAddressOverLimit}
        aria-describedby={testIdPrefix ? `${testIdPrefix}-full-address-count` : undefined}
        placeholder={t.crmFullAddressPlaceholder || '完整地址'}
        className={`mt-3 min-h-[84px] w-full resize-y rounded-xl border bg-slate-50 px-4 py-3 text-sm font-bold outline-none dark:bg-slate-900 ${
          fullAddressOverLimit ? 'border-red-500 dark:border-red-500' : 'border-slate-200 dark:border-slate-700'
        }`}
      />
      <div
        id={testIdPrefix ? `${testIdPrefix}-full-address-count` : undefined}
        className={`mt-1 text-right text-xs font-medium ${fullAddressOverLimit ? 'text-red-600' : 'text-slate-500'}`}
      >
        {fullAddressOverLimit ? `已超出 ${fullAddressLength - 500} 个字符` : `${fullAddressLength}/500`}
      </div>
    </div>
  );
}

export function ContactCard({
  t,
  contact,
  onChange,
  testIdPrefix,
}: {
  t: TranslationText;
  contact: Contact;
  onChange: (patch: Partial<Contact>) => void;
  testIdPrefix?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
      <div className="grid gap-3 md:grid-cols-2">
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-name` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={contact.name || ''}
          onChange={(event) => onChange({ name: event.target.value })}
          maxLength={80}
          placeholder={t.crmContactNamePlaceholder || '联系人姓名'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-role` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={contact.role || contact.position || ''}
          onChange={(event) => onChange({ role: event.target.value, position: event.target.value })}
          maxLength={80}
          placeholder={t.crmRoleTitlePlaceholder || '角色 / 职务'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-phone` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={contact.phone || ''}
          onChange={(event) => onChange({ phone: event.target.value })}
          maxLength={40}
          placeholder={t.crmPhonePlaceholder || '电话'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-email` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={contact.email || ''}
          onChange={(event) => onChange({ email: event.target.value })}
          maxLength={160}
          placeholder={t.crmEmailPlaceholder || '邮箱'}
        />
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-department` : undefined}
          className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none dark:border-slate-700 dark:bg-slate-900"
          value={contact.department || ''}
          onChange={(event) => onChange({ department: event.target.value })}
          maxLength={80}
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
}
