export type CustomerPoolState = 'public' | 'internal' | 'private';
export type CustomerSegment = 'direct' | 'channel' | 'mixed';
export type CustomerPoolAction = 'POOL_ASSIGN' | 'POOL_RELEASE' | 'POOL_RECLAIM' | 'POOL_TRANSFER' | 'CREATE' | 'UPDATE';

export interface CustomerOrderStats {
  totalOrders: number;
  totalAmount: number;
  usedCredit: number;
  avgOrderInterval: number;
  termsDays: number;
  lastOrderDate: string | null;
}

export interface NormalizedCustomerContact {
  name: string;
  position: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  role?: string;
  department?: string;
  language?: string;
  mobile?: string;
  whatsapp?: string;
  wechat?: string;
  addressId?: string;
  siteLabel?: string;
}

export const MAX_CUSTOMER_PAGE_SIZE = 1000;
