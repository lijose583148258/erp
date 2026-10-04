const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { paymentAdjustmentEvidenceFolder: folder } = require('./lib/payment-adjustment-browser.cjs');

test('cloud default report path works when ROUND2_REPORT_PATH is absent', () => {
  const saved = process.env.ROUND2_REPORT_PATH;
  delete process.env.ROUND2_REPORT_PATH;
  try {
    const reportPath = path.resolve('output/audit/enterprise-round2-v1.json');
    assert.equal(folder({ reportPath, runId: 'r2-cloud-123' }), path.join(path.dirname(reportPath), 'r2-cloud-123-payment-adjustment'));
  } finally {
    if (saved === undefined) delete process.env.ROUND2_REPORT_PATH;
    else process.env.ROUND2_REPORT_PATH = saved;
  }
});

test('explicit context wins over an unrelated ambient report path', () => {
  const saved = process.env.ROUND2_REPORT_PATH;
  process.env.ROUND2_REPORT_PATH = path.resolve('output/wrong/report.json');
  try {
    const reportPath = path.resolve('output/correct/report.json');
    assert.equal(folder({ reportPath, runId: 'local-123' }), path.join(path.dirname(reportPath), 'local-123-payment-adjustment'));
    assert.throws(() => folder({ runId: 'local-123' }), /explicit absolute reportPath/);
    assert.throws(() => folder({ reportPath: 'relative.json', runId: 'local-123' }), /explicit absolute reportPath/);
    assert.throws(() => folder({ reportPath, runId: '../escape' }), /safe runId/);
  } finally {
    if (saved === undefined) delete process.env.ROUND2_REPORT_PATH;
    else process.env.ROUND2_REPORT_PATH = saved;
  }
});

test('both execution owners supply resolved report context, not env fallback', () => {
  for (const file of ['enterprise-round2-audit-v1.cjs', 'payment-adjustment-reconciliation-audit-v1.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source, /paymentAdjustmentReconciliation\(\{ request, dataOf, actors, prisma, runId, urls, reportPath \}, signal\)/);
  }
  const browser = fs.readFileSync(path.join(__dirname, 'lib/payment-adjustment-browser.cjs'), 'utf8');
  assert.doesNotMatch(browser, /process\.env\.ROUND2_REPORT_PATH/);
});
