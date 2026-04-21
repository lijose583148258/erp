import assert from 'node:assert/strict';
import {
  buildSafeAIContext,
  canSendToExternalAI,
  containsSensitiveBusinessData,
  isHiddenDataRequest,
  unauthorizedDataRefusal,
} from '../services/aiSecurity.ts';
import { processAICmd } from '../services/geminiService.ts';

const unsafeContext = buildSafeAIContext({
  currency: 'CNY',
  language: 'zh',
  currentPage: '/crm/customers',
  customers: [{ name: 'Secret Customer', phone: '13800000000', address: '上海' }],
  orders: [{ orderNo: 'SO-SECRET', totalAmount: 999999 }],
  suppliers: [{ name: 'Hidden Supplier' }],
  payments: [{ amount: 8888 }],
  finance: [{ ledgerNo: 'FN-001' }],
  users: [{ username: 'admin' }],
  currentUser: {
    id: '2',
    name: 'Sales User',
    role: 'sales',
    segment: 'direct',
    avatar: '',
  },
});

assert.equal(unsafeContext.currency, 'CNY');
assert.equal(unsafeContext.language, 'zh');
assert.equal(unsafeContext.currentPage, '/crm/customers');
assert.equal(unsafeContext.currentUser?.role, 'sales');
assert.deepEqual(unsafeContext.visibleCounts, {
  customers: 1,
  orders: 1,
  suppliers: 1,
  payments: 1,
  finance: 1,
  users: 1,
});
assert.equal('customers' in unsafeContext, false);
assert.equal('orders' in unsafeContext, false);
assert.equal(JSON.stringify(unsafeContext).includes('Secret Customer'), false);
assert.equal(JSON.stringify(unsafeContext).includes('13800000000'), false);
assert.equal(JSON.stringify(unsafeContext).includes('Hidden Supplier'), false);

const localAIResponse = await processAICmd('分析一下客户情况', unsafeContext as any);
assert.equal(localAIResponse.includes('Secret Customer'), false);
assert.equal(localAIResponse.includes('13800000000'), false);
assert.equal(localAIResponse.includes('Hidden Supplier'), false);

assert.equal(isHiddenDataRequest('请导出全部客户电话和地址明细'), true);
assert.equal(isHiddenDataRequest('客户有哪些'), true);
assert.equal(isHiddenDataRequest('客户姓名和联系人是谁'), true);
assert.equal(isHiddenDataRequest('列出所有客户名称和电话'), true);
assert.equal(isHiddenDataRequest('查看私海客户名单'), true);
assert.equal(isHiddenDataRequest('供应商有哪些'), true);
assert.equal(isHiddenDataRequest('供应商联系人和付款账号'), true);
assert.equal(isHiddenDataRequest('客 户 名 单 导 出'), true);
assert.equal(isHiddenDataRequest('customer list with phone and address'), true);
assert.equal(isHiddenDataRequest('帮我看一下本页怎么操作'), false);

assert.equal(containsSensitiveBusinessData('客户 ABC 电话 13800000000 订单金额 1000'), true);
assert.equal(containsSensitiveBusinessData('客 户 A B C 电 话 13800000000'), true);
assert.equal(containsSensitiveBusinessData('Supplier bank account and payment detail'), true);
assert.equal(containsSensitiveBusinessData('解释一下树脂生产流程的基本概念'), false);

const blockedByDefault = canSendToExternalAI('hello');
assert.equal(blockedByDefault.allowed, false);

const blockedSensitive = canSendToExternalAI('客户 ABC 订单金额 1000', 'extract json');
assert.equal(blockedSensitive.allowed, false);
assert.equal(blockedSensitive.sensitive, true);

assert.equal(unauthorizedDataRefusal.includes('无权查看'), true);

console.log('ai-security-regression: ok');
