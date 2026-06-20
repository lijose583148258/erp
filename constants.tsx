
import { Customer, RiskLevel, Invoice, Shipment, SampleRecord, SampleStatus, RmaRecord, SalesOrder, OrderStatus, RmaStatus, TeamMember } from './types';

export const MOCK_CUSTOMERS: Customer[] = [
  { 
    id: 'C-001', 
    name: '浙江化工集团 (Zhejiang Chemical)', 
    contacts: [
      { name: '李伟', position: '采购总监', phone: '138-1111-2222', email: 'li@zjchem.com', isPrimary: true }
    ],
    termsDays: 30, 
    creditLimit: 500000, 
    usedCredit: 320000, 
    riskLevel: RiskLevel.MEDIUM, 
    lastOrderDate: '2024-03-15', 
    status: 'active',
    historicalOrderCount: 12,
    avgOrderInterval: 25,
    assignedSalespersonId: 'T-001',
    salespersonName: '张志诚',
    isPublicPool: false,
    licenseUrl: 'https://picsum.photos/800/600?random=101',
    licenseStatus: 'verified'
  },
  { 
    id: 'C-002', 
    name: 'Vietnam Tech Polymers', 
    contacts: [
      { name: 'Nguyen Van A', position: 'Director', phone: '+84-90-123456', email: 'a.nguyen@vntech.vn', isPrimary: true }
    ],
    termsDays: 45, 
    creditLimit: 200000, 
    usedCredit: 195000, 
    riskLevel: RiskLevel.HIGH, 
    lastOrderDate: '2023-08-10', 
    status: 'inactive',
    historicalOrderCount: 4,
    avgOrderInterval: 60,
    isPublicPool: true,
    licenseStatus: 'pending'
  },
  { 
    id: 'C-003', 
    name: '上海精细化工 (Shanghai Fine Chem)', 
    contacts: [
      { name: '王勇', position: '采购员', phone: '139-0000-1111', email: 'wang@shchem.com', isPrimary: true }
    ],
    termsDays: 30, 
    creditLimit: 1000000, 
    usedCredit: 0, 
    riskLevel: RiskLevel.LOW, 
    lastOrderDate: '2022-12-01', 
    status: 'inactive',
    historicalOrderCount: 20,
    avgOrderInterval: 15,
    isPublicPool: true,
    licenseStatus: 'expired'
  },
];

export const MOCK_TEAM_MEMBERS: TeamMember[] = [
  { id: 'T-001', name: '张志诚', isActive: true, type: 'direct', role: '华东区大客户经理', region: '上海', performance: 4500000, customerCount: 15, commissionRate: 0.03, totalCommission: 135000 },
  { id: 'T-002', name: '刘美玲', isActive: true, type: 'direct', role: '华南销售主管', region: '广州', performance: 2800000, customerCount: 22, commissionRate: 0.025, totalCommission: 70000 },
  { id: 'T-003', name: '南方化工分销公司', isActive: true, type: 'channel', role: '核心经销商', region: '深圳', performance: 12000000, customerCount: 84, commissionRate: 0.08, totalCommission: 960000 },
  { id: 'T-004', name: 'Nguyen Logistics', isActive: true, type: 'channel', role: '海外渠道商', region: '胡志明市', performance: 5600000, customerCount: 31, commissionRate: 0.07, totalCommission: 392000 },
];

export const MOCK_ORDERS: SalesOrder[] = [
  {
    id: 'SO-2024-001',
    customerId: 'C-001',
    customerName: '浙江化工集团 (Zhejiang Chemical)',
    orderDate: '2024-03-01',
    items: [
      // Fix: Added packagingSpec, unit, and taxAmount. Calculated amount as net (8.5*2000 - 500 = 16500)
      { sku: 'MEK-01', productName: '丁酮 (MEK)', packagingSpec: '165kg/桶', quantity: 2000, unit: 'kg', unitPrice: 8.5, amount: 16500, discount: 500, taxAmount: 0 },
      // Fix: Added packagingSpec, unit, and taxAmount. Calculated amount as net (9.2*1000 - 0 = 9200)
      { sku: 'IPA-99', productName: '异丙醇 (IPA)', packagingSpec: '160kg/桶', quantity: 1000, unit: 'kg', unitPrice: 9.2, amount: 9200, discount: 0, taxAmount: 0 }
    ],
    taxInclusive: true,
    discountTotal: 500,
    // Fix: Added missing taxTotal field required by SalesOrder interface
    taxTotal: 0,
    paymentTermsDays: 30,
    totalAmount: 25700,
    paidAmount: 25700,
    status: OrderStatus.DELIVERED,
    paymentStatus: 'paid',
    commissionAmount: 771 // 基于 3% 计算
  }
];

export const MOCK_INVOICES: Invoice[] = [
  { 
    id: 'INV-1002', 
    orderId: 'SO-2024-001', 
    customerName: '浙江化工集团 (Zhejiang Chemical)', 
    amount: 25700, 
    dueDate: '2024-03-31', 
    status: 'paid',
    payments: [
      { id: 'P-003', date: '2024-03-25', amount: 25700, method: 'Bank Transfer', isProxy: false, status: 'verified' }
    ]
  },
];

export const MOCK_SHIPMENTS: Shipment[] = [
  { id: 'SHP-101', orderId: 'SO-2024-001', customerName: '浙江化工集团 (Zhejiang Chemical)', sku: 'MEK-01', qty: 2000, shippedAt: '2024-03-05', status: 'delivered', signedReceiptUrl: 'https://picsum.photos/400/600?random=1' },
];

export const MOCK_SAMPLES: SampleRecord[] = [
  { id: 'SMP-001', customerName: '浙江化工集团 (Zhejiang Chemical)', productName: 'MEK 高纯级', specifications: '含量 > 99.9%, 水分 < 100ppm', quantity: '500ml', requestDate: '2024-03-19', status: SampleStatus.SENT, trackingNo: 'SF1425633', needsFollowUp: true, followUpDate: '2024-03-22' },
];

export const MOCK_RMAS: RmaRecord[] = [
  { id: 'RMA-501', orderNo: 'SO-9800', customerName: 'Anhui Dyestuffs Co.', reason: 'Quality not meeting TDS', status: RmaStatus.IN_REVIEW, type: 'return', createdAt: '2024-03-12' },
];
