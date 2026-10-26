const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
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

test('pure report context loads in a real bare process with no browser dependencies', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-payment-context-bare-'));
  const file = path.join(temp, 'payment-adjustment-browser.cjs');
  try {
    fs.copyFileSync(path.join(__dirname, 'lib/payment-adjustment-browser.cjs'), file);
    const result = execFileSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),path=require('node:path');
      assert.throws(()=>require.resolve('playwright/test'),e=>e.code==='MODULE_NOT_FOUND');
      const {paymentAdjustmentEvidenceFolder}=require('./payment-adjustment-browser.cjs');
      const reportPath=path.resolve('proof/report.json');
      assert.equal(paymentAdjustmentEvidenceFolder({reportPath,runId:'bare-cloud-123'}),path.join(path.dirname(reportPath),'bare-cloud-123-payment-adjustment'));
      console.log(JSON.stringify({bare:true,pureContext:true}));
    `], { cwd: temp, timeout: 10000, windowsHide: true, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.deepEqual(JSON.parse(result), { bare: true, pureContext: true });
  } finally {
    // Only the single copied file and our now-empty unique directory are removed.
    assert.equal(path.dirname(file), temp);
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    assert(path.basename(temp).startsWith('ailaoda-payment-context-bare-'));
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(temp);
  }
});
