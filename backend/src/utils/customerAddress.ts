export type CustomerAddressType = 'legal' | 'shipping' | 'office' | 'billing' | 'other';

export interface CustomerAddress {
  id?: string;
  type: CustomerAddressType;
  label?: string;
  fullAddress: string;
  isPrimary?: boolean;
  note?: string;
}

type CustomerAddressSource = {
  addresses?: CustomerAddress[] | string | null;
  address?: string | null;
};

const ADDRESS_TYPES: CustomerAddressType[] = ['legal', 'shipping', 'office', 'billing', 'other'];

const normalizeType = (value: any): CustomerAddressType => {
  if (typeof value !== 'string') return 'other';
  const normalized = value.trim().toLowerCase();
  return ADDRESS_TYPES.includes(normalized as CustomerAddressType) ? (normalized as CustomerAddressType) : 'other';
};

const normalizeAddressItem = (value: any, fallbackType: CustomerAddressType = 'other'): CustomerAddress | null => {
  if (!value) return null;

  if (typeof value === 'string') {
    const fullAddress = value.trim();
    return fullAddress ? { type: fallbackType, fullAddress, isPrimary: false } : null;
  }

  if (typeof value === 'object') {
    const fullAddress = String(value.fullAddress || value.address || value.line1 || '').trim();
    if (!fullAddress) return null;
    return {
      id: value.id ? String(value.id) : undefined,
      type: normalizeType(value.type || fallbackType),
      label: value.label ? String(value.label).trim() : undefined,
      fullAddress,
      isPrimary: Boolean(value.isPrimary),
      note: value.note ? String(value.note).trim() : undefined,
    };
  }

  return null;
};

const buildAddressKey = (item: CustomerAddress) => [
  item.id ? `id:${item.id}` : '',
  `type:${item.type}`,
  `label:${item.label || ''}`,
  `address:${item.fullAddress.trim().toLowerCase()}`,
  `note:${item.note || ''}`,
].join('|');

export const normalizeCustomerAddresses = (source?: CustomerAddressSource | CustomerAddress[] | string | null): CustomerAddress[] => {
  if (!source) return [];

  const objectSource = typeof source === 'object' && source !== null && !Array.isArray(source)
    ? source
    : null;

  const raw = Array.isArray(source)
    ? source
    : objectSource
      ? objectSource.addresses
      : source;

  if (!raw) {
    if (objectSource?.address) {
      const legacy = normalizeAddressItem(objectSource.address, 'legal');
      return legacy ? [{ ...legacy, isPrimary: true }] : [];
    }
    return [];
  }

  let items: any[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return objectSource?.address
        ? normalizeCustomerAddresses({ addresses: [], address: objectSource.address })
        : [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        items = parsed;
      } else {
        items = trimmed.split(/[\n,;，、]+/);
      }
    } catch {
      items = trimmed.split(/[\n,;，、]+/);
    }
  }

  const normalized = Array.from(
    new Map(
      items
        .map(item => normalizeAddressItem(item))
        .filter((item): item is CustomerAddress => Boolean(item))
        .map(item => [buildAddressKey(item), item]),
    ).values(),
  );

  if (normalized.length === 0 && objectSource?.address) {
    const legacy = normalizeAddressItem(objectSource.address, 'legal');
    if (legacy) {
      normalized.push({ ...legacy, isPrimary: true });
    }
  }

  if (normalized.length > 0) {
    const firstPrimaryIndex = normalized.findIndex(item => item.isPrimary);
    if (firstPrimaryIndex >= 0) {
      normalized.forEach((item, index) => {
        normalized[index] = index === firstPrimaryIndex ? { ...item, isPrimary: true } : { ...item, isPrimary: false };
      });
    } else {
      normalized[0] = { ...normalized[0], isPrimary: true };
    }
  }

  return normalized;
};

export const serializeCustomerAddresses = (value?: CustomerAddress[] | string | null) => {
  const normalized = normalizeCustomerAddresses(value || null);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
};

export const getPrimaryCustomerAddress = (customer: CustomerAddressSource) => {
  const addresses = normalizeCustomerAddresses(customer);
  return addresses.find(address => address.isPrimary) || addresses[0] || null;
};
