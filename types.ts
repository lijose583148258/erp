export type Language = 'zh' | 'en' | 'vi';
export type Theme = 'light' | 'dark';
export type Currency = 'CNY' | 'USD' | 'VND';
export type BuiltInUserRole = 'admin' | 'manager' | 'sales' | 'warehouse' | 'finance';
export type UserRole = BuiltInUserRole | (string & {});

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  role: UserRole;
  segment?: 'direct' | 'channel' | 'mixed';
  avatar: string;
  mustChangePassword?: boolean;
  permissions?: string[];
  dataScopes?: string[];
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum SampleStatus {
  REQUESTED = 'requested',
  SENT = 'sent',
  TESTING = 'testing',
  FEEDBACK = 'feedback',
  REJECTED = 'rejected'
}

export enum RmaStatus {
  PENDING = 'pending',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled'
}

export type OrderFulfillmentStatus =
  | 'pending_release'
  | 'ready_to_ship'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type OrderFinancialStatus =
  | 'unpaid'
  | 'payment_submitted'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export enum CommissionStatus {
  NOT_SUBMITTED = 'not_submitted',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

export interface Contact {
  name: string;
  position: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  role?: string;
  department?: string;
  language?: Language;
  mobile?: string;
  whatsapp?: string;
  wechat?: string;
  addressId?: string;
  siteLabel?: string;
}

export type CustomerAddressType = 'legal' | 'shipping' | 'office' | 'billing' | 'other';

export interface CustomerAddress {
  id?: string;
  type: CustomerAddressType;
  label?: string;
  fullAddress: string;
  isPrimary?: boolean;
  note?: string;
  registeredName?: string;
  registrationNo?: string;
  taxNo?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  postalCode?: string;
}

export interface CustomerPoolHistoryEntry {
  id: number;
  action: 'POOL_ASSIGN' | 'POOL_RELEASE' | 'POOL_RECLAIM' | 'POOL_TRANSFER';
  previousPoolState: 'public' | 'internal' | 'private' | null;
  nextPoolState: 'public' | 'internal' | 'private' | null;
  salespersonId: string | null;
  salespersonName?: string | null;
  reason: string | null;
  operatorName: string;
  operatorRole: UserRole;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  nameVi?: string;
  nameAliases?: string[];
  displayName?: string;
  contacts: Contact[];
  addresses?: CustomerAddress[];
  licenseNumber?: string;
  termsDays: number;
  creditLimit: number;
  usedCredit: number;
  riskLevel: RiskLevel;
  segment?: 'direct' | 'channel' | 'mixed';
  lastOrderDate: string;
  status: 'active' | 'inactive';
  historicalOrderCount: number;
  avgOrderInterval: number;
  salespersonId?: string;
  assignedSalespersonId?: string;
  salespersonName?: string;
  isPublicPool: boolean;
  poolState?: 'public' | 'internal' | 'private';
  poolReason?: string;
  poolUpdatedAt?: string;
  poolUpdatedBy?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  notes?: string;
  overdueAmount?: number;
  collectionsStatus?: string;
  dunningLevel?: number;
  nextActionAt?: string;
  creditHold?: boolean;
  creditHoldReason?: string;
  creditHoldSource?: string;
  creditHoldUpdatedAt?: string;
  shipmentHold?: boolean;
  shipmentHoldReason?: string;
  shipmentHoldSource?: string;
  shipmentHoldUpdatedAt?: string;
  licenseUrl?: string;
  licenseStatus?: 'pending' | 'verified' | 'expired';
  hazardousLicenseExpiry?: string;
  historicalCreditLimit?: number;
  statistics?: {
    totalOrders?: number;
    totalAmount?: number;
    usedCredit?: number;
    avgOrderInterval?: number;
    termsDays?: number;
    lastOrderDate?: string | null;
  };
}

export interface ExtraItem {
  productName: string;
  quantity: number;
  type: 'gift' | 'compensation';
  note?: string;
}

export interface PaymentRecord {
  id: string;
  orderId?: string;
  date: string;
  amount: number;
  /** 交易币种（ISO 4217），如 CNY / USD / VND / EUR / HKD */
  currency?: string;
  /** 执行汇率：下单时 1 CNY = X 外币的快照 */
  exchangeRate?: number;
  /** 本位币金额（CNY 折算） */
  baseAmount?: number;
  method: string;
  isProxy: boolean;
  payerName?: string;
  note?: string;
  recordedBy?: string;
  status: 'pending' | 'verified';
  createdByRole?: UserRole;
  milestoneId?: string;
}

export interface HistoryLog {
  id: string;
  date: string;
  action: string;
  user: string;
  details: string;
}

export interface CollectionPromiseSnapshot {
  id: string;
  promiseNo?: string;
  promisedAmount: number;
  promisedAt: string;
  channel?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  note?: string | null;
  status?: string;
  createdAt?: string;
}

export interface SalesOrderItem {
  sku: string;
  productName: string;
  packagingSpec: string;
  casNo?: string;
  purity?: string;
  batchNo?: string;
  grade?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  taxAmount: number;
  amount: number;
  notes?: string;
  isDimensional?: boolean;
  dimLength?: number;
  dimWidth?: number;
  dimHeight?: number;
  totalVolume?: number;
  totalWeight?: number;
}

export interface SalesOrder {
  id: string;
  orderNo?: string;
  contractId?: string;
  customerId: string;
  customerName: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  orderDate: string;
  items: SalesOrderItem[];
  extraItems?: ExtraItem[];
  notes?: string;
  taxInclusive: boolean;
  discountTotal: number;
  taxTotal: number;
  paymentTermsDays: number;
  totalAmount: number;
  /** 交易币种（ISO 4217），如 CNY / USD / VND / EUR / HKD，缺省为 CNY */
  currency?: string;
  /** 下单时锁定的汇率快照：1 CNY = X 外币 */
  lockedExchangeRate?: number;
  /** 本位币（CNY）折算金额 */
  baseAmount?: number;
  finalAmount?: number;
  paidAmount: number;
  receivableAdjustmentAmount?: number;
  effectiveReceivableAmount?: number;
  outstandingAmount?: number;
  paymentRecords?: PaymentRecord[];
  dueDate?: string;
  status: OrderStatus;
  paymentStatus: 'unpaid' | 'partial' | 'paid' | 'overdue';
  fulfillmentStatus?: OrderFulfillmentStatus;
  financialStatus?: OrderFinancialStatus;
  commissionAmount?: number;
  commissionRateSubmitted?: number;
  commissionStatus?: CommissionStatus;
  commissionNote?: string;
  salespersonId?: string;
  creatorName?: string;
  createdBy?: number;
  createdAt?: string;
  updatedAt?: string;
  historyLogs?: HistoryLog[];
  collectionPromises?: CollectionPromiseSnapshot[];
}

export interface TeamMember {
  id: string;
  name: string;
  isActive: boolean;
  type: 'direct' | 'channel' | 'mixed';
  role: string;
  region: string;
  performance: number;
  customerCount: number;
  commissionRate: number;
  totalCommission: number;
  managerId?: string;
}

export interface Invoice {
  id: string;
  orderId: string;
  customerName: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  amount: number;
  dueDate: string;
  status: 'paid' | 'unpaid' | string;
  payments: PaymentRecord[];
}

export interface Shipment {
  id: string;
  shipmentNo?: string;
  orderId: string;
  orderNo?: string;
  customerId?: string;
  customerName: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  productName?: string;
  casNo?: string;
  msdsStatus?: 'valid' | 'missing' | 'expired' | string;
  msdsUrl?: string;
  sku: string;
  qty: number;
  quantity?: number;
  unit?: string;
  carrier?: string;
  trackingNo?: string;
  shippedAt: string;
  deliveredAt?: string;
  status: 'delivered' | 'in_transit' | 'exception' | 'pending' | string;
  signedReceiptUrl?: string;
  route?: string;
  isColdChain?: boolean;
  temperature?: number;
  batchNo?: string;
}

export interface Contract {
  id: string;
  contractNo: string;
  type: 'sales' | 'purchase';
  customerId: string;
  customerName?: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  title: string;
  totalAmount: number;
  currency: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  signedAt?: string;
  expiredAt?: string;
  fileUrl?: string;
  ocrMetadata?: any;
  notes?: string;
  createdBy: number;
  creatorName?: string;
  createdAt: string;
  updatedAt: string;
  linkedOrdersCount?: number;
  totalLinkedAmount?: number;
  milestones?: ContractMilestone[];
}

export interface ContractMilestone {
  id: string;
  contractId: string;
  title: string;
  percentage: number;
  amount?: number;
  dueDate?: string;
  status: 'pending' | 'paid';
}

export interface SampleRecord {
  id: string;
  sampleNo?: string;
  customerId?: string;
  customerName: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  productName: string;
  specifications: string;
  quantity: string;
  requestDate: string;
  status: SampleStatus;
  trackingNo?: string;
  needsFollowUp: boolean;
  followUpDate: string;
}

export interface RmaRecord {
  id: string;
  orderNo: string;
  customerName: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  productName?: string;
  quantity?: string | number;
  unit?: string;
  reason: string;
  status: RmaStatus;
  type: 'return' | 'refund' | 'exchange' | string;
  createdAt: string;
  orderId?: string;
  refundAmount?: number;
  requestDate?: string;
}

export type AssetType = 'IBC Tank' | 'Iron Drum 200L' | 'Plastic Drum 200L' | 'Wooden Pallet' | 'Plastic Pallet';

export interface AssetTransaction {
  id: string;
  date: string;
  customerId: string;
  customerName: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  type: AssetType;
  quantity: number;
  action: 'outbound' | 'return';
  relatedOrderNo?: string;
  note?: string;
}

export interface AssetSummary {
  customerId: string;
  customerName: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  balances: Record<AssetType, number>;
  lastActivity: string;
}

export interface AppContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  theme: Theme;
  toggleTheme: () => void;
  currency: Currency;
  setCurrency: (cur: Currency) => void;
  formatPrice: (amount: number, fromCurrency?: Currency) => string;
  currentUser: CurrentUser;
  switchUser: (role: UserRole, segment?: 'direct' | 'channel' | 'mixed') => void;
  notify: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  t: any;
  setIsCommandPaletteOpen: (open: boolean) => void;
  registerUnsavedChanges: (sourceId: string, label: string, dirty: boolean) => void;
  confirmDiscardChanges: () => boolean;
}
