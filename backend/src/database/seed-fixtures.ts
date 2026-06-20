export const demoUsers = [
  { username: 'admin', role: 'admin', segment: 'mixed', password: 'admin123' },
  { username: 'manager', role: 'manager', segment: 'mixed', password: 'manager123' },
  { username: 'sales', role: 'sales', segment: 'direct', password: 'sales123' },
  { username: 'warehouse', role: 'warehouse', segment: 'mixed', password: 'warehouse123' },
  { username: 'finance', role: 'finance', segment: 'mixed', password: 'finance123' },
] as const;

export const demoCustomers = [
  {
    name: 'Demo Chemicals Co.',
    nameZh: '演示化工有限公司',
    nameEn: 'Demo Chemicals Co.',
    nameVi: 'Công ty Hóa chất Demo',
    licenseNumber: 'DEMO-001',
    creditLimit: 500000,
    riskLevel: 'low',
    contactName: 'Zhang San',
    contactPhone: '13800138001',
    contactEmail: 'zhangsan@example.com',
    segment: 'direct',
  },
  {
    name: 'Sample Trade Ltd.',
    nameZh: '示例贸易有限公司',
    nameEn: 'Sample Trade Ltd.',
    nameVi: 'Công ty Thương mại Mẫu',
    licenseNumber: 'DEMO-002',
    creditLimit: 300000,
    riskLevel: 'medium',
    contactName: 'Li Si',
    contactPhone: '13800138002',
    contactEmail: 'lisi@example.com',
    segment: 'channel',
  },
] as const;

export const demoAssetTypes = ['IBC Tank', 'Wooden Pallet', 'Plastic Drum 200L'] as const;
