import { matchCustomer, parseOcrDocument } from '../services/smartFormService';

type CustomerFixture = {
  id: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  nameVi?: string;
  nameAliases?: string[];
  displayName?: string;
};

const customer: CustomerFixture = {
  id: 'ship-ocr-customer-1',
  name: 'Ailaoda Adhesive Trading',
  nameZh: '爱劳达胶水贸易有限公司',
  nameEn: 'Ailaoda Adhesive Trading Co., Ltd.',
  nameVi: 'Cong ty Thuong mai Keo Ailaoda',
  nameAliases: ['AILAODA-ADHESIVE', '爱劳达胶粘剂'],
};

const cases = [
  {
    name: 'zh-customer-label',
    text: [
      `客户名称: ${customer.nameZh}`,
      '产品: 水性胶水',
      '数量: 12 件',
      '追踪号: OCR-ZH-001',
    ].join('\n'),
    expectedCustomer: customer.nameZh,
    expectedTracking: 'OCR-ZH-001',
  },
  {
    name: 'zh-company-label',
    text: [
      `公司名称: ${customer.nameZh}`,
      '产品: 树脂',
      '数量: 800 kg',
      '追踪号: OCR-ZH-002',
    ].join('\n'),
    expectedCustomer: customer.nameZh,
    expectedTracking: 'OCR-ZH-002',
  },
  {
    name: 'en-ship-to-label',
    text: [
      `Ship To: ${customer.nameEn}`,
      'Product: Coating Resin',
      'Quantity: 25 kg',
      'Tracking No: OCR-EN-001',
    ].join('\n'),
    expectedCustomer: customer.nameEn,
    expectedTracking: 'OCR-EN-001',
  },
];

const failures: string[] = [];

for (const item of cases) {
  const parsed = parseOcrDocument(item.text, 'shipment');
  if (parsed.customerName !== item.expectedCustomer) {
    failures.push(`${item.name}: expected customer ${item.expectedCustomer}, got ${parsed.customerName || '<empty>'}`);
  }
  if (parsed.trackingNo !== item.expectedTracking) {
    failures.push(`${item.name}: expected tracking ${item.expectedTracking}, got ${parsed.trackingNo || '<empty>'}`);
  }
  const matched = matchCustomer(parsed.customerName || '', [customer]);
  if (!matched || matched.id !== customer.id) {
    failures.push(`${item.name}: customer match failed for ${parsed.customerName || '<empty>'}`);
  }
}

const labelResidueInputs = [
  `客户名称: ${customer.nameZh}`,
  `名称: ${customer.nameZh}`,
  `customer: ${customer.nameEn}`,
  `ship to: ${customer.nameEn}`,
  `公司名称: ${customer.nameZh}`,
];

for (const input of labelResidueInputs) {
  const matched = matchCustomer(input, [customer]);
  if (!matched || matched.id !== customer.id) {
    failures.push(`label residue match failed: ${input}`);
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    status: 'failed',
    gate: 'shipping-ocr-regression-v1',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'passed',
  gate: 'shipping-ocr-regression-v1',
  cases: cases.length,
  labelResidueInputs: labelResidueInputs.length,
}, null, 2));
