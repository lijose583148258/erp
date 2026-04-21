import { Customer, Contact, CustomerAddress, RiskLevel } from '../../types';
import { splitCustomerTextList } from '../../utils/customerAlias';
import { normalizeCustomerAddresses } from '../../utils/customerAddressV2';

export type ImportedCustomerRow = Partial<Customer> & Record<string, unknown>;
type ContactImportRecord = Partial<Record<keyof Contact, unknown>> & Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readImportValue = (row: ImportedCustomerRow, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const readImportText = (row: ImportedCustomerRow, keys: string[], fallback?: string) => {
  const value = readImportValue(row, ...keys);
  return value === undefined ? fallback : String(value).trim();
};

const readImportNumber = (row: ImportedCustomerRow, keys: string[], fallback: number) => {
  const value = readImportValue(row, ...keys);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeContactRecord = (value: unknown): Contact | null => {
  if (!isRecord(value)) return null;
  const source = value as ContactImportRecord;
  const name = String(source.name || source['姓名'] || source.contactName || '').trim();
  const phone = String(source.phone || source.mobile || source['电话'] || source['手机'] || '').trim();
  const email = String(source.email || source['邮箱'] || '').trim();
  const position = String(source.position || source.role || source['职务'] || source['角色'] || '').trim();

  if (!name && !phone && !email) return null;

  return {
    name,
    position,
    phone,
    email,
    isPrimary: Boolean(source.isPrimary),
    role: source.role ? String(source.role) : undefined,
    department: source.department ? String(source.department) : undefined,
    language: source.language === 'zh' || source.language === 'en' || source.language === 'vi' ? source.language : undefined,
    mobile: source.mobile ? String(source.mobile) : undefined,
    whatsapp: source.whatsapp ? String(source.whatsapp) : undefined,
    wechat: source.wechat ? String(source.wechat) : undefined,
    addressId: source.addressId ? String(source.addressId) : undefined,
    siteLabel: source.siteLabel ? String(source.siteLabel) : undefined,
  };
};

const parseImportedContacts = (value: unknown): Contact[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeContactRecord).filter((contact): contact is Contact => Boolean(contact));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map(normalizeContactRecord).filter((contact): contact is Contact => Boolean(contact))
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

const parseImportedAddresses = (row: ImportedCustomerRow): CustomerAddress[] => {
  const addressesValue = readImportValue(row, 'addresses', 'addressesJson', 'Addresses JSON', '地址JSON');
  const legacyAddress = readImportValue(row, 'address', 'Address', '地址');
  const addresses = Array.isArray(addressesValue)
    ? (addressesValue as CustomerAddress[])
    : typeof addressesValue === 'string'
      ? addressesValue
      : undefined;

  return normalizeCustomerAddresses({
    addresses: addresses || null,
    address: typeof legacyAddress === 'string' ? legacyAddress : null,
  });
};

export function formatImportedCustomers(rows: ImportedCustomerRow[], managerSegmentScope: Customer['segment'] | null): Customer[] {
  return rows.map((item) => ({
    id: '',
    name: readImportText(item, ['客户名称', 'Customer Name', 'name'], 'Unknown') || 'Unknown',
    nameZh: readImportText(item, ['中文名称', 'nameZh', 'Chinese Name']) || undefined,
    nameEn: readImportText(item, ['英文名称', 'nameEn', 'English Name']) || undefined,
    nameVi: readImportText(item, ['越南文名称', 'nameVi', 'Vietnamese Name']) || undefined,
    nameAliases: splitCustomerTextList(readImportValue(item, '别名/历史名', 'Alias', 'Aliases', 'aliasNames', 'nameAliases') as string[] | string | null),
    contacts: parseImportedContacts(readImportValue(item, 'contacts', 'contactsJson', 'Contacts JSON', '联系人JSON')),
    addresses: parseImportedAddresses(item),
    termsDays: readImportNumber(item, ['Terms Days', 'termsDays'], 30),
    creditLimit: readImportNumber(item, ['Credit Limit', 'creditLimit'], 50000),
    usedCredit: 0,
    riskLevel: readImportText(item, ['Risk Level', 'riskLevel'], 'medium')?.toLowerCase() as RiskLevel,
    segment: readImportText(item, ['Business Line', 'Segment', 'segment'], managerSegmentScope || 'mixed')?.toLowerCase() as Customer['segment'],
    poolState: readImportText(item, ['Pool State', 'poolState'], 'internal')?.toLowerCase() as Customer['poolState'],
    lastOrderDate: new Date().toISOString().split('T')[0],
    status: 'active',
    historicalOrderCount: 0,
    avgOrderInterval: 0,
    isPublicPool: false,
    licenseUrl: readImportText(item, ['License URL', 'licenseUrl']) || undefined,
    licenseStatus: readImportValue(item, 'License URL', 'licenseUrl') ? 'verified' : 'pending',
  }));
}
