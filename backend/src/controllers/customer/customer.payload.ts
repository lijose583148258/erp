import { getPrimaryCustomerAddress, normalizeCustomerAddresses, type CustomerAddress } from '../../utils/customerAddressV2';
import { CustomerOrderStats, CustomerPoolAction, CustomerPoolState, CustomerSegment, NormalizedCustomerContact } from './customer.types';

type CustomerRecord = Record<string, unknown>;
type CustomerPayloadOverride = CustomerRecord & {
  contacts?: unknown;
  addresses?: unknown;
  poolState?: unknown;
  segment?: unknown;
  termsDays?: unknown;
};
type CustomerOrderStatSource = {
  createdAt: Date;
  paymentTerms: number;
  finalAmount: unknown;
  paidAmount: unknown;
};

const isRecord = (value: unknown): value is CustomerRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toOptionalString = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

const toNumberValue = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const toDateIso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
};

const normalizeSegmentValue = (value: unknown, fallback: CustomerSegment = 'mixed'): CustomerSegment => {
  return value === 'direct' || value === 'channel' || value === 'mixed' ? value : fallback;
};

const normalizePoolStateValue = (value: unknown): CustomerPoolState | undefined => {
  return value === 'public' || value === 'internal' || value === 'private' ? value : undefined;
};

export function normalizePoolState(row: { poolState?: unknown; salespersonId?: unknown }) {
  if (row.poolState === 'public' || row.poolState === 'internal' || row.poolState === 'private') {
    return row.poolState;
  }

  return row.salespersonId ? 'private' : 'public';
}

function normalizeContactItem(value: unknown): NormalizedCustomerContact | null {
  if (!isRecord(value)) return null;

  const name = String(value.name || '').trim();
  const phone = String(value.phone || '').trim();
  const email = String(value.email || '').trim();

  if (!name && !phone && !email) {
    return null;
  }

  return {
    name,
    position: value.position ? String(value.position).trim() : '',
    phone,
    email,
    isPrimary: Boolean(value.isPrimary),
    role: value.role ? String(value.role).trim() : undefined,
    department: value.department ? String(value.department).trim() : undefined,
    language: value.language ? String(value.language).trim() : undefined,
    mobile: value.mobile ? String(value.mobile).trim() : undefined,
    whatsapp: value.whatsapp ? String(value.whatsapp).trim() : undefined,
    wechat: value.wechat ? String(value.wechat).trim() : undefined,
    addressId: value.addressId ? String(value.addressId).trim() : undefined,
    siteLabel: value.siteLabel ? String(value.siteLabel).trim() : undefined,
  };
}

export function normalizeCustomerContacts(value: unknown): NormalizedCustomerContact[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    const normalized: NormalizedCustomerContact[] = value
      .map(item => normalizeContactItem(item))
      .filter((item): item is NormalizedCustomerContact => Boolean(item));

    if (normalized.length > 0 && !normalized.some(item => item?.isPrimary)) {
      normalized[0] = { ...normalized[0], isPrimary: true };
    }

    return normalized;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeCustomerContacts(parsed);
      }
    } catch {
      return [];
    }
  }

  return [];
}

export function serializeCustomerContacts(value: unknown): string | null {
  const contacts = normalizeCustomerContacts(value);
  return contacts.length > 0 ? JSON.stringify(contacts) : null;
}

export function deriveContacts(row: CustomerRecord, fallbackContacts?: unknown[]) {
  const normalizedFallback = normalizeCustomerContacts(fallbackContacts);
  if (normalizedFallback.length > 0) {
    return normalizedFallback;
  }

  const fromJson = normalizeCustomerContacts(row.contactsJson || row.contacts_json);
  if (fromJson.length > 0) {
    return fromJson;
  }

  const fromRow = normalizeCustomerContacts(row.contacts);
  if (fromRow.length > 0) {
    return fromRow;
  }

  if (row.contactName || row.contactPhone || row.contactEmail) {
    return [
      {
        name: toOptionalString(row.contactName) || '',
        position: '',
        phone: toOptionalString(row.contactPhone) || '',
        email: toOptionalString(row.contactEmail) || '',
        isPrimary: true,
      },
    ];
  }

  return [];
}

export function deriveAddresses(row: CustomerRecord, fallbackAddresses?: unknown[]) {
  const addresses = Array.isArray(fallbackAddresses) && fallbackAddresses.length > 0
    ? (fallbackAddresses as CustomerAddress[])
    : row.addressesJson || row.addresses || null;

  return normalizeCustomerAddresses({
    addresses: addresses as CustomerAddress[] | string | null,
    address: toOptionalString(row.address) || null,
  });
}

function normalizeLocalizedCustomerNames(row: CustomerRecord) {
  return {
    nameZh: toOptionalString(row.nameZh || row.name_zh) || null,
    nameEn: toOptionalString(row.nameEn || row.name_en) || null,
    nameVi: toOptionalString(row.nameVi || row.name_vi) || null,
  };
}

export function normalizeCustomerAliases(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(alias => String(alias).trim()).filter(Boolean)));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map(alias => String(alias).trim()).filter(Boolean)));
      }
    } catch {
      // fall through to delimiter split
    }

    return Array.from(new Set(
      trimmed
        .split(/[\n,;，、]+/)
        .map(alias => alias.trim())
        .filter(Boolean),
    ));
  }

  return [];
}

export function serializeCustomerAliases(value: unknown): string | null {
  const aliases = normalizeCustomerAliases(value);
  return aliases.length > 0 ? JSON.stringify(aliases) : null;
}

export function getCustomerDisplayName(row: { name?: string | null; nameZh?: string | null; nameEn?: string | null; nameVi?: string | null }) {
  return row.nameZh || row.nameEn || row.nameVi || row.name || '';
}

export function buildOrderStats(orders: CustomerOrderStatSource[]): CustomerOrderStats {
  if (orders.length === 0) {
    return {
      totalOrders: 0,
      totalAmount: 0,
      usedCredit: 0,
      avgOrderInterval: 0,
      termsDays: 30,
      lastOrderDate: null,
    };
  }

  const sortedOrders = [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const totalAmount = sortedOrders.reduce((sum, order) => sum + Number(order.finalAmount || 0), 0);
  const usedCredit = sortedOrders.reduce((sum, order) => {
    const outstanding = Number(order.finalAmount || 0) - Number(order.paidAmount || 0);
    return sum + Math.max(0, outstanding);
  }, 0);
  const termsDays = Number(sortedOrders[sortedOrders.length - 1].paymentTerms || 30);

  let avgOrderInterval = 0;
  if (sortedOrders.length > 1) {
    let totalInterval = 0;
    for (let i = 1; i < sortedOrders.length; i++) {
      totalInterval += (sortedOrders[i].createdAt.getTime() - sortedOrders[i - 1].createdAt.getTime()) / (1000 * 60 * 60 * 24);
    }
    avgOrderInterval = Number((totalInterval / (sortedOrders.length - 1)).toFixed(1));
  }

  return {
    totalOrders: sortedOrders.length,
    totalAmount,
    usedCredit,
    avgOrderInterval,
    termsDays,
    lastOrderDate: sortedOrders[sortedOrders.length - 1].createdAt.toISOString(),
  };
}

export function buildCustomerPayload(row: CustomerRecord, stats: Partial<CustomerOrderStats> = {}, override: CustomerPayloadOverride = {}) {
  const poolState = normalizePoolStateValue(override.poolState) || normalizePoolState(row);
  const contacts = Array.isArray(override.contacts)
    ? normalizeCustomerContacts(override.contacts)
    : deriveContacts(row);
  const localizedNames = normalizeLocalizedCustomerNames(row);
  const nameAliases = normalizeCustomerAliases(row.nameAliases || row.name_aliases);
  const addresses = deriveAddresses(row, Array.isArray(override.addresses) ? override.addresses : undefined);
  const totalOrders = stats.totalOrders ?? 0;
  const totalAmount = stats.totalAmount ?? 0;
  const usedCredit = stats.usedCredit ?? 0;
  const avgOrderInterval = stats.avgOrderInterval ?? 0;
  const termsDays = stats.termsDays ?? toNumberValue(override.termsDays, 30);
  const lastOrderDate = stats.lastOrderDate ?? null;
  const salesperson = isRecord(row.salesperson) ? row.salesperson : null;

  return {
    id: String(row.id),
    name: toOptionalString(row.name) || '',
    nameZh: localizedNames.nameZh || undefined,
    nameEn: localizedNames.nameEn || undefined,
    nameVi: localizedNames.nameVi || undefined,
    nameAliases,
    contacts,
    addresses,
    termsDays,
    creditLimit: row.creditLimit != null ? toNumberValue(row.creditLimit) : 0,
    usedCredit,
    riskLevel: toOptionalString(row.riskLevel) || 'low',
    segment: normalizeSegmentValue(row.segment || override.segment),
    lastOrderDate,
    status: toOptionalString(row.status) || 'active',
    historicalOrderCount: totalOrders,
    avgOrderInterval,
    salespersonId: row.salespersonId != null ? String(row.salespersonId) : undefined,
    assignedSalespersonId: row.salespersonId != null ? String(row.salespersonId) : undefined,
    salespersonName: toOptionalString(salesperson?.username),
    isPublicPool: poolState === 'public',
    poolState,
    poolReason: toOptionalString(row.poolReason),
    poolUpdatedAt: toDateIso(row.poolUpdatedAt),
    poolUpdatedBy: row.poolUpdatedBy != null ? String(row.poolUpdatedBy) : undefined,
    contactName: toOptionalString(row.contactName),
    contactPhone: toOptionalString(row.contactPhone),
    contactEmail: toOptionalString(row.contactEmail),
    address: getPrimaryCustomerAddress({ addresses, address: toOptionalString(row.address) || null })?.fullAddress || toOptionalString(row.address),
    notes: toOptionalString(row.notes),
    overdueAmount: toNumberValue(row.overdueAmount),
    collectionsStatus: toOptionalString(row.collectionsStatus) || 'normal',
    dunningLevel: toNumberValue(row.dunningLevel),
    nextActionAt: toDateIso(row.nextActionAt),
    creditHold: Boolean(row.creditHold),
    shipmentHold: Boolean(row.shipmentHold),
    statistics: {
      totalOrders,
      totalAmount,
      usedCredit,
      avgOrderInterval,
      termsDays,
      lastOrderDate,
    },
  };
}

export function pickCustomerName(body: CustomerRecord) {
  return body.name || body.nameZh || body.nameEn || body.nameVi;
}

export function isSalesPoolChangeAllowed(existing: CustomerRecord, body: CustomerRecord) {
  const currentPoolState = normalizePoolState(existing);
  const requestedPoolState = body.poolState || currentPoolState;
  const requestedSalespersonId = body.salespersonId ?? body.assignedSalespersonId ?? existing.salespersonId;

  return requestedPoolState === currentPoolState && String(requestedSalespersonId || '') === String(existing.salespersonId || '');
}

export function resolvePoolAuditAction(previousPoolState: CustomerPoolState, nextPoolState: CustomerPoolState): CustomerPoolAction {
  if (nextPoolState === 'private' && previousPoolState !== 'private') {
    return 'POOL_ASSIGN';
  }

  if (nextPoolState === 'public') {
    return 'POOL_RELEASE';
  }

  if (previousPoolState === 'private' && nextPoolState === 'internal') {
    return 'POOL_RECLAIM';
  }

  return 'POOL_TRANSFER';
}
