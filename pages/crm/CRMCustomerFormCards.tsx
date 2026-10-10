import type { Contact, CustomerAddress } from '../../types';

type TranslationText = Record<string, string | undefined>;
const cardControlClass =
 'mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold outline-none transition-[border-color,box-shadow] duration-150 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900';
const cardLabelClass = 'block text-xs font-black text-slate-600 dark:text-slate-300';

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
 <label className={cardLabelClass}>
 地址用途
        <select
          data-testid={testIdPrefix ? `${testIdPrefix}-type` : undefined}
 className={cardControlClass}
          value={address.type}
          onChange={(event) => onChange({ type: event.target.value as CustomerAddress['type'] })}
        >
          <option value="legal">{t.crmAddressTypeLegal || '法定主体'}</option>
          <option value="shipping">{t.crmAddressTypeShipping || '发货地址'}</option>
          <option value="billing">{t.crmAddressTypeBilling || '账单地址'}</option>
          <option value="office">{t.crmAddressTypeOffice || '办公地址'}</option>
          <option value="other">{t.crmAddressTypeOther || '其他站点'}</option>
        </select>
 </label>
 <label className={cardLabelClass}>
 站点标签
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-label` : undefined}
 className={cardControlClass}
          value={address.label || ''}
          onChange={(event) => onChange({ label: event.target.value })}
          maxLength={60}
 placeholder={t.crmSiteLabelPlaceholder || '例如：越南仓、总部'}
        />
 </label>
 <label className={cardLabelClass}>
 国家 / 地区代码
        <input
          data-testid={testIdPrefix ? `${testIdPrefix}-country` : undefined}
 className={`${cardControlClass} uppercase`}
          value={address.countryCode || ''}
          onChange={(event) => onChange({ countryCode: event.target.value.toUpperCase() })}
          maxLength={3}
 placeholder={t.crmCountryCodePlaceholder || '例如：CN、VN'}
        />
 </label>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
 <label className={cardLabelClass}>注册名称
 <input data-testid={testIdPrefix ? `${testIdPrefix}-registered-name` : undefined} className={cardControlClass} value={address.registeredName || ''} onChange={(event) => onChange({ registeredName: event.target.value })} maxLength={160} placeholder={t.crmRegisteredNamePlaceholder || '营业执照上的完整名称'} />
 </label>
 <label className={cardLabelClass}>注册号 / 营业执照号
 <input data-testid={testIdPrefix ? `${testIdPrefix}-registration-no` : undefined} className={cardControlClass} value={address.registrationNo || ''} onChange={(event) => onChange({ registrationNo: event.target.value })} maxLength={80} placeholder={t.crmRegistrationNoPlaceholder || '企业登记号码'} />
 </label>
 <label className={cardLabelClass}>税号 / VAT
 <input data-testid={testIdPrefix ? `${testIdPrefix}-tax-no` : undefined} className={cardControlClass} value={address.taxNo || ''} onChange={(event) => onChange({ taxNo: event.target.value })} maxLength={80} placeholder={t.crmTaxNoPlaceholder || '用于开票和税务识别'} />
 </label>
 <label className={cardLabelClass}>城市
 <input data-testid={testIdPrefix ? `${testIdPrefix}-city` : undefined} className={cardControlClass} value={address.city || ''} onChange={(event) => onChange({ city: event.target.value })} maxLength={80} placeholder={t.crmCityPlaceholder || '例如：东莞、胡志明市'} />
 </label>
      </div>
 <label className={`${cardLabelClass} mt-3`}>
 完整地址
      <textarea
        data-testid={testIdPrefix ? `${testIdPrefix}-full-address` : undefined}
        value={address.fullAddress || ''}
        onChange={(event) => onChange({ fullAddress: event.target.value })}
        aria-invalid={fullAddressOverLimit}
        aria-describedby={testIdPrefix ? `${testIdPrefix}-full-address-count` : undefined}
 placeholder={t.crmFullAddressPlaceholder || '省/州、市、区、街道、门牌及邮编'}
 className={`${cardControlClass} min-h-[84px] resize-y ${fullAddressOverLimit ? 'border-red-500 dark:border-red-500' : ''}`}
      />
 </label>
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
 <label className={cardLabelClass}>联系人姓名
 <input data-testid={testIdPrefix ? `${testIdPrefix}-name` : undefined} className={cardControlClass} value={contact.name || ''} onChange={(event) => onChange({ name: event.target.value })} maxLength={80} placeholder={t.crmContactNamePlaceholder || '真实姓名'} />
 </label>
 <label className={cardLabelClass}>角色 / 职务
 <input data-testid={testIdPrefix ? `${testIdPrefix}-role` : undefined} className={cardControlClass} value={contact.role || contact.position || ''} onChange={(event) => onChange({ role: event.target.value, position: event.target.value })} maxLength={80} placeholder={t.crmRoleTitlePlaceholder || '例如：采购经理'} />
 </label>
 <label className={cardLabelClass}>电话
 <input data-testid={testIdPrefix ? `${testIdPrefix}-phone` : undefined} className={cardControlClass} value={contact.phone || ''} onChange={(event) => onChange({ phone: event.target.value })} maxLength={40} placeholder={t.crmPhonePlaceholder || '含国家/地区代码'} />
 </label>
 <label className={cardLabelClass}>邮箱
 <input data-testid={testIdPrefix ? `${testIdPrefix}-email` : undefined} className={cardControlClass} value={contact.email || ''} onChange={(event) => onChange({ email: event.target.value })} maxLength={160} placeholder={t.crmEmailPlaceholder || '用于业务通知'} />
 </label>
 <label className={cardLabelClass}>部门
 <input data-testid={testIdPrefix ? `${testIdPrefix}-department` : undefined} className={cardControlClass} value={contact.department || ''} onChange={(event) => onChange({ department: event.target.value })} maxLength={80} placeholder={t.crmDepartmentPlaceholder || '例如：采购部'} />
 </label>
 <label className={cardLabelClass}>常用语言
 <select data-testid={testIdPrefix ? `${testIdPrefix}-language` : undefined} className={cardControlClass} value={contact.language || ''} onChange={(event) => onChange({ language: event.target.value as Contact['language'] })}>
 <option value="">{t.crmCommonLanguage || '请选择'}</option>
          <option value="zh">{t.crmChinese || '中文'}</option>
          <option value="en">{t.crmEnglish || 'English'}</option>
          <option value="vi">{t.crmVietnamese || 'Tiếng Việt'}</option>
        </select>
 </label>
      </div>
    </div>
  );
}
