import { DataScopeCode } from '../../services/role.service';

export const dataScopeOptions: Array<{ code: DataScopeCode; zh: string; en: string; vi: string }> = [
  { code: 'all', zh: '全公司数据', en: 'All company data', vi: 'Toan bo du lieu cong ty' },
  { code: 'own_customers', zh: '仅本人客户', en: 'Own customers only', vi: 'Chi khach hang cua toi' },
  { code: 'team_customers', zh: '团队客户', en: 'Team customers', vi: 'Khach hang nhom' },
  { code: 'finance_visible', zh: '可见财务数据', en: 'Finance visible', vi: 'Xem du lieu tai chinh' },
  { code: 'warehouse_visible', zh: '可见仓储数据', en: 'Warehouse visible', vi: 'Xem du lieu kho' },
  { code: 'procurement_visible', zh: '可见采购数据', en: 'Procurement visible', vi: 'Xem du lieu mua hang' },
];

export const groupLabels: Record<string, { zh: string; en: string; vi: string }> = {
  dashboard: { zh: '工作台', en: 'Dashboard', vi: 'Bang dieu khien' },
  customers: { zh: '客户与主数据', en: 'Customers & master data', vi: 'Khach hang va du lieu goc' },
  orders: { zh: '销售订单', en: 'Sales orders', vi: 'Don ban hang' },
  collections: { zh: '回款与催收', en: 'Collections', vi: 'Thu tien' },
  finance: { zh: '财务经营', en: 'Finance', vi: 'Tai chinh' },
  contracts: { zh: '合同', en: 'Contracts', vi: 'Hop dong' },
  barter: { zh: '货抵/换货', en: 'Barter settlement', vi: 'Doi tru hang hoa' },
  risk: { zh: '风控', en: 'Risk control', vi: 'Kiem soat rui ro' },
  samples: { zh: '样品', en: 'Samples', vi: 'Mau' },
  shipping: { zh: '出货物流', en: 'Shipping', vi: 'Van chuyen' },
  team: { zh: '组织与权限', en: 'Team & access', vi: 'Nhom va quyen' },
  assets: { zh: '资产', en: 'Assets', vi: 'Tai san' },
  production: { zh: '生产', en: 'Production', vi: 'San xuat' },
  warehouse: { zh: '仓储', en: 'Warehouse', vi: 'Kho' },
  procurement: { zh: '采购', en: 'Procurement', vi: 'Mua hang' },
  audit: { zh: '审计', en: 'Audit', vi: 'Kiem toan' },
};
