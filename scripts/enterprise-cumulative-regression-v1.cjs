const fs = require('node:fs');
const path = require('node:path');
const { beginRegression, headCommit, sourceFingerprint, evaluateRegression } = require('./lib/enterprise-regression.cjs');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.REGRESSION_REPORT_PATH || 'output/audit/enterprise-cumulative-regression-v1.json');
const contextPath = path.resolve(process.env.REGRESSION_CONTEXT_PATH || 'output/audit/enterprise-regression-context.json');
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); }
try {
  if (process.argv[2] === 'begin') {
    if (fs.existsSync(contextPath)) throw new Error('Context already exists; use a fresh run directory, do not restamp old evidence');
    const context = beginRegression(root, process.argv[3] || 'cloud'); write(contextPath, context);
    console.log(JSON.stringify({ contextPath, key: context.key, sourceHash: context.sourceHash }));
  } else {
    const errors = [];
    const safeRead = file => { try { return read(file); } catch (e) { errors.push({ file, error: e.message }); return null; } };
    const report = evaluateRegression({ baseline: read(path.join(root, 'scripts/config/enterprise-regression-baseline-v1.json')),
      context: read(contextPath), currentCommit: headCommit(root), currentSourceHash: sourceFingerprint(root),
      reports: { round2: safeRead(process.env.REGRESSION_ROUND2_PATH || 'output/audit/enterprise-round2-v1.json'),
        sales: safeRead(process.env.REGRESSION_SALES_PATH || 'output/audit/sales-partial-fulfillment/report.json'),
        salesPlan: safeRead(process.env.REGRESSION_SALES_PLAN_PATH || 'output/audit/sales-fulfillment-plan/report.json'),
        authorization: safeRead('output/audit/authorization-dual-node-v1.json'),
        legacy: safeRead(process.env.REGRESSION_LEGACY_PATH || 'output/audit/barter-cash-legacy-upgrade.json') },
      steps: JSON.parse(process.env.BUSINESS_AUDIT_STEPS_JSON || '{}') });
    report.readErrors = errors; write(output, report);
    console.log(JSON.stringify({ status: report.status, summary: report.summary, fullAcceptanceStatus: report.fullAcceptanceStatus, output }));
    for (const check of report.checks.filter(c => c.status !== 'passed')) console.error(`${check.id}: ${check.error}`);
    process.exitCode = report.status === 'passed' ? 0 : 1;
  }
} catch (error) {
  write(output, { status: 'failed', error: error.stack, finishedAt: new Date().toISOString() });
  console.error(error.message); process.exitCode = 1;
}
