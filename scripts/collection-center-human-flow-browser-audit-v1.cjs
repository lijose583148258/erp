/**
 * Collection center browser human-flow audit.
 *
 * Main controller only. Detailed seed and browser actions live in scripts/lib
 * so the audit itself does not become another oversized maintenance script.
 */
const path = require('path');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');
const { createAuditRuntime, ensureDir } = require('./lib/audit-runtime-utils.cjs');
const { loginAdmin, seedBusinessChain } = require('./lib/collection-human-flow-seed.cjs');
const { createAuditPrismaClient } = require('./lib/ui-audit-user.cjs');
const {
  assertNoBrowserRuntimeErrors,
  clickTabsAndSelectOrder,
  exerciseExports,
  exerciseFilters,
  openCollectionsRoute,
  setupBrowserContext,
  submitDisputeByUi,
  submitPromiseByUi,
  verifyLedgerPaymentByUi,
} = require('./lib/collection-human-flow-browser.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright', 'collection-center-human-flow-browser-audit-v1');
const REPORT_PATH = path.join(process.cwd(), 'output', 'playwright', 'collection-center-human-flow-browser-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const STEP_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const ADMIN = {
  username: `hf_admin_${RUN_ID.slice(-8)}`,
  password: `Audit${RUN_ID.slice(-6)}!A`,
  role: 'admin',
};

const runtimeDbPath = process.env.AILAODA_RUNTIME_DB_PATH || 'D:/AilaoDaRuntime/stable.db';
process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${runtimeDbPath.replace(/\\/g, '/')}`;

const copy = {
  workbench: '\u56de\u6b3e\u5de5\u4f5c\u53f0',
  overdue: '\u903e\u671f\u6e05\u5355',
  ledger: '\u6536\u6b3e\u53f0\u8d26',
  milestone: '\u5408\u540c\u8282\u70b9',
  currentTarget: '\u5f53\u524d\u52a8\u4f5c\u5bf9\u8c61',
  promiseNav: '\u627f\u8bfa\u8ddf\u8fdb',
  receivableNav: '\u5e94\u6536\u4efb\u52a1',
  riskNav: '\u4e89\u8bae / \u62e6\u622a',
  promiseTable: '\u627f\u8bfa\u4ed8\u6b3e\u6267\u884c\u8868',
  disputeTable: '\u4e89\u8bae\u5904\u7406\u8868',
  holdTable: '\u62e6\u622a\u63a7\u5236\u8868',
};
const forbiddenTokens = ['\ufffd', 'undefined', 'NaN', '\u935a', '\u9359', '\u95ab', '\u93c0', '\u9428', '\u7035', '\u93c6', '\u941c', '\u8216', '\u20ac'];
const testData = {
  customerNameZh: `HF-${RUN_ID}-\u5ba2\u6237`,
  customerNameEn: `HF-${RUN_ID} Customer`,
  customerNameVi: `HF-${RUN_ID} Khach Hang`,
  productName: `HF-${RUN_ID}-\u80f6\u6c34`,
  paymentNote: `HF-PAY-${RUN_ID}`,
  promiseAmount: 567.89,
  promiseNote: `HF-PROMISE-${RUN_ID}`,
  disputeReason: `HF-DISPUTE-REASON-${RUN_ID}`,
  disputeNote: `HF-DISPUTE-NOTE-${RUN_ID}`,
  holdReason: `HF-HOLD-${RUN_ID}`,
};

const report = {
  name: 'collection-center-human-flow-browser-audit-v1',
  appUrl: APP_URL,
  runtimeDbPath,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  testData,
  status: 'running',
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  seeded: {},
  downloads: [],
};
const runtime = createAuditRuntime({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  report,
  reportPath: REPORT_PATH,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

async function main() {
  ensureDir(OUTPUT_DIR);
  let browser = null;
  let context = null;
  let prisma = null;
  const scriptTimer = setTimeout(() => {
    report.status = 'failed';
    report.failure = { stage: 'script-timeout', message: `Script timeout after ${SCRIPT_TIMEOUT_MS}ms` };
    runtime.saveReport().finally(() => process.exit(1));
  }, SCRIPT_TIMEOUT_MS);

  try {
    prisma = createAuditPrismaClient();
    const admin = await loginAdmin(runtime, { admin: ADMIN, stepTimeoutMs: STEP_TIMEOUT_MS });
    const seed = await seedBusinessChain(runtime, { token: admin.token, prisma, runId: RUN_ID, testData, report, stepTimeoutMs: STEP_TIMEOUT_MS });
    const launched = await launchBrowserWithGuard({ recordStep: runtime.recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const browserSetup = await setupBrowserContext(browser, admin, report);
    context = browserSetup.context;
    const page = browserSetup.page;
    const common = { copy, forbiddenTokens, stepTimeoutMs: STEP_TIMEOUT_MS };

    await openCollectionsRoute(runtime, page, { appUrl: APP_URL, ...common });
    await clickTabsAndSelectOrder(runtime, page, seed, common);
    await submitPromiseByUi(runtime, page, seed, admin.token, { testData, ...common });
    await submitDisputeByUi(runtime, page, seed, admin.token, { testData, ...common });
    await exerciseFilters(runtime, page, common);
    await exerciseExports(runtime, page, { outputDir: OUTPUT_DIR, report, downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS, ...common });
    await verifyLedgerPaymentByUi(runtime, page, seed, admin.token, common);
    assertNoBrowserRuntimeErrors(runtime, report);
    report.status = 'passed';
  } catch (error) {
    markReportFromLaunchError(report, error);
    if (!report.status || report.status === 'running') report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      status: error?.status || null,
      details: error?.details || null,
      stack: error?.stack || null,
    };
    if (report.status !== 'blocked_env') process.exitCode = 1;
  } finally {
    clearTimeout(scriptTimer);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (prisma) await prisma.$disconnect().catch(() => {});
    await runtime.saveReport();
    if (report.status !== 'passed' && report.failure) {
      console.error(`Collection center failure: ${JSON.stringify(report.failure)}`);
    }
    console.log(`Collection center human-flow audit ${report.status}. Report: ${REPORT_PATH}`);
  }
}

main();
