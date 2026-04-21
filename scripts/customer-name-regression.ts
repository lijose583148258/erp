import assert from 'node:assert/strict';
import { getCustomerDisplayName } from '../utils/customerName.ts';

const fallback = getCustomerDisplayName(
  {
    name: '????_20260414081543',
    nameZh: '????_20260414081543',
    nameEn: 'SmokeCustomer_20260414081543',
    nameVi: '',
  },
  'zh',
);
assert.equal(fallback, 'SmokeCustomer_20260414081543');

const localized = getCustomerDisplayName(
  {
    name: 'Demo Chemicals',
    nameZh: '演示化工有限公司',
    nameEn: 'Demo Chemicals Co.',
    nameVi: 'Cong ty Hoa chat Demo',
  },
  'zh',
);
assert.equal(localized, '演示化工有限公司');

console.log('customer-name-regression: ok');
