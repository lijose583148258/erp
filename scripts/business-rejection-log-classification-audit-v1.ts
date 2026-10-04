import { createRequire } from 'module';

const requireFromScript = createRequire(import.meta.url);
const { isExpectedBusinessRejection } = requireFromScript('../backend/src/utils/logger.ts') as {
  isExpectedBusinessRejection: (...args: unknown[]) => boolean;
};

type Case = {
  label: string;
  args: unknown[];
  expected: boolean;
};

const productionCompletionError = new Error('CHEM-001 has no confirmed consumption record');
productionCompletionError.name = 'ProductionCompletionValidationError';

const cases: Case[] = [
  {
    label: 'receivable-adjustment-business-limit',
    args: ['Failed to post receivable adjustment', new Error('RECEIVABLE_ADJUSTMENT_EXCEEDS_AVAILABLE')],
    expected: true,
  },
  {
    label: 'procurement-invalid-status',
    args: ['创建采购单错误:', new Error('PURCHASE_ORDER_DIRECT_RECEIVE_NOT_ALLOWED')],
    expected: true,
  },
  {
    label: 'production-bom-validation',
    args: ['Failed to update work order status', productionCompletionError],
    expected: true,
  },
  {
    label: 'stock-business-guard',
    args: ['更新物流状态错误:', new Error('No available stock for shipment SHP-TEST: ITEM / BATCH')],
    expected: true,
  },
  {
    label: 'barter-duplicate-submit',
    args: ['过账货抵单失败', new Error('Duplicate barter batch submission detected. Please refresh settlement batches before submitting again.')],
    expected: true,
  },
  {
    label: 'finance-adjustment-below-zero',
    args: ['Failed to create adjustment', new Error('FINANCE_ADJUSTMENT_BELOW_ZERO_PAID_AMOUNT')],
    expected: true,
  },
  {
    label: 'barter-duplicate-submit-localized',
    args: ['创建货抵执行批次失败', new Error('检测到重复提交货抵批次，请刷新执行批次后再提交。')],
    expected: true,
  },
  {
    label: 'barter-already-posted-localized',
    args: ['货抵过账失败', new Error('该货抵批次已过账，请刷新页面后再核对。')],
    expected: true,
  },
  {
    label: 'collection-promise-illegal-transition',
    args: ['Failed to update promise status', new Error('Promise status cannot transition from kept to cancelled')],
    expected: true,
  },
  {
    label: 'collection-dispute-illegal-transition',
    args: ['Failed to update dispute status', new Error('Dispute status cannot transition from rejected to resolved')],
    expected: true,
  },
  {
    label: 'prisma-system-error',
    args: ['获取客户列表错误:', Object.assign(new Error('Query parameter limit exceeded'), { name: 'PrismaClientKnownRequestError' })],
    expected: false,
  },
  {
    label: 'type-error-system-error',
    args: ['Unexpected runtime failure', new TypeError('Cannot read properties of undefined')],
    expected: false,
  },
  {
    label: 'database-connection-system-error',
    args: ['数据库连接失败', new Error('database connection failed')],
    expected: false,
  },
];

const failures = cases
  .map(item => ({
    ...item,
    actual: isExpectedBusinessRejection(...item.args),
  }))
  .filter(item => item.actual !== item.expected);

const report = {
  status: failures.length === 0 ? 'passed' : 'failed',
  total: cases.length,
  passed: cases.length - failures.length,
  failed: failures.length,
  failures: failures.map(item => ({
    label: item.label,
    expected: item.expected,
    actual: item.actual,
  })),
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
