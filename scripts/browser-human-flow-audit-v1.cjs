const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');
const {
  createBrowserHumanFlowAuditContext,
  createBrowserHumanFlowData,
} = require('./lib/browser-human-flow-audit-utils.cjs');
const { createBrowserHumanFlowModules } = require('./lib/browser-human-flow-modules.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'browser-human-flow-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'browser-human-flow-audit-report-v1.json');
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 240000);

const TIMEOUTS = {
  pageLoad: 15000,
  login: 20000,
  route: 12000,
  action: 18000,
  save: 20000,
  readBack: 15000,
  screenshot: 5000,
  close: 5000,
};

const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const DATA = createBrowserHumanFlowData(RUN_ID);
const FLOW_STATE = {
  salesOrderId: null,
};

function parseCliArgs(argv) {
  const args = {
    listModules: false,
    selectedModules: [],
  };

  for (const arg of argv) {
    if (arg === '--list-modules') {
      args.listModules = true;
      continue;
    }
    if (arg.startsWith('--module=')) {
      args.selectedModules.push(...arg.slice('--module='.length).split(',').map(item => item.trim()).filter(Boolean));
      continue;
    }
    if (arg.startsWith('--modules=')) {
      args.selectedModules.push(...arg.slice('--modules='.length).split(',').map(item => item.trim()).filter(Boolean));
    }
  }

  return args;
}

const CLI_ARGS = parseCliArgs(process.argv.slice(2));

const {
  ensureDir,
  ensureRole,
  getBodyText,
  openHash,
  recordStep,
  report,
  resetRuntimeCaches,
  runModule,
  safeScreenshot,
  selectOptionContaining,
  waitForVisibleText,
  withTimeout,
  writeReport,
} = createBrowserHumanFlowAuditContext({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  shotDir: SHOT_DIR,
  reportPath: REPORT_PATH,
  runId: RUN_ID,
  data: DATA,
  timeouts: TIMEOUTS,
});

const { moduleDefinitions: MODULE_DEFINITIONS } = createBrowserHumanFlowModules({
  DATA,
  FLOW_STATE,
  RUN_ID,
  TIMEOUTS,
  ensureRole,
  getBodyText,
  openHash,
  recordStep,
  safeScreenshot,
  selectOptionContaining,
  waitForVisibleText,
  withTimeout,
});
function resolveExecutionPlan(selectedModules) {
  const byName = new Map(MODULE_DEFINITIONS.map(item => [item.name, item]));
  const selected = selectedModules.length > 0 ? new Set(selectedModules) : new Set(MODULE_DEFINITIONS.map(item => item.name));
  const unknown = [...selected].filter(name => !byName.has(name));
  if (unknown.length > 0) {
    throw new Error(`unknown module(s): ${unknown.join(', ')}. Use --list-modules.`);
  }

  const ordered = [];
  const seen = new Set();

  function addWithDependencies(name) {
    if (seen.has(name)) return;
    const item = byName.get(name);
    for (const dependency of item.dependencies) addWithDependencies(dependency);
    seen.add(name);
    ordered.push({
      ...item,
      targeted: selectedModules.length === 0 || selected.has(name),
    });
  }

  for (const item of MODULE_DEFINITIONS) {
    if (selected.has(item.name)) addWithDependencies(item.name);
  }

  return ordered;
}

function listModulesAndExit() {
  console.log(JSON.stringify({
    status: 'module-list',
    modules: MODULE_DEFINITIONS.map(({ name, role, dependencies, purpose }) => ({
      name,
      role,
      dependencies,
      purpose,
    })),
  }, null, 2));
  process.exit(0);
}

async function run() {
  if (CLI_ARGS.listModules) listModulesAndExit();

  const executionPlan = resolveExecutionPlan(CLI_ARGS.selectedModules);
  report.selection = {
    requestedModules: CLI_ARGS.selectedModules,
    executionPlan: executionPlan.map(({ name, role, dependencies, targeted, purpose }) => ({
      name,
      role,
      dependencies,
      targeted,
      purpose,
    })),
  };

  ensureDir(SHOT_DIR);
  let browser = null;
  let context = null;
  let page = null;
  let launcher = null;
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `browser human flow audit exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    writeReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  try {
    const launched = await connectOrLaunchBrowser({
      recordStep,
      retryLimit: 1,
      waitMs: 800,
      cdpRequired: process.env.BROWSER_CDP_REQUIRED === '1',
    });
    browser = launched.browser;
    launcher = launched.launcher;
    report.launcher = launcher;
    report.endpoint = launched.endpoint || null;

    context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1440, height: 980 } });
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.__humanFlowConsoleErrors = report.consoleErrors;
    page.on('console', (message) => {
      if (message.type() === 'error') {
        report.consoleErrors.push({ at: new Date().toISOString(), text: message.text(), url: page.url() });
      }
    });
    page.on('pageerror', (error) => {
      report.consoleErrors.push({ at: new Date().toISOString(), text: String(error.message || error), url: page.url() });
    });

    await page.addInitScript(({ language }) => {
      try {
        window.localStorage.setItem('ailao.language', language);
        window.localStorage.setItem('language', language);
        window.localStorage.setItem('ailao.activeTab', 'dashboard');
        window.localStorage.setItem('currency', 'CNY');
      } catch {
        /* noop */
      }
    }, { language: 'zh' });

    await resetRuntimeCaches(page);

    let activeRole = null;
    for (const moduleDef of executionPlan) {
      if (activeRole !== moduleDef.role) {
        await ensureRole(page, moduleDef.role);
        activeRole = moduleDef.role;
        const loginShot = await safeScreenshot(page, `role-${moduleDef.role}-ready`);
        recordStep({
          step: `role-${moduleDef.role}-ready`,
          result: 'passed',
          evidence: loginShot,
          notes: `Role ${moduleDef.role} is ready for ${moduleDef.name}.`,
        });
      }
      await runModule(page, moduleDef.name, () => moduleDef.run(page));
    }

    const failed = report.modules.filter((module) => module.status !== 'passed');
    if (failed.length > 0 || report.consoleErrors.length > 0) {
      report.status = 'failed';
      const reasons = [];
      if (failed.length > 0) {
        reasons.push(`modules not passed: ${failed.map((item) => `${item.name}:${item.status}`).join(', ')}`);
      }
      if (report.consoleErrors.length > 0) {
        reasons.push(`console errors: ${report.consoleErrors.length}`);
      }
      report.error = reasons.join('; ');
      process.exitCode = 1;
    } else {
      report.status = 'passed';
    }
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    process.exitCode = 1;
  } finally {
    if (page) {
      await withTimeout('page-close', TIMEOUTS.close, async () => page.close()).catch(() => {});
    }
    if (context) {
      await withTimeout('context-close', TIMEOUTS.close, async () => context.close()).catch(() => {});
    }
    if (browser && launcher !== 'cdp') {
      await withTimeout('browser-close', TIMEOUTS.close, async () => browser.close()).catch(() => {});
    }
    clearTimeout(watchdog);
    writeReport();
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'browser human flow audit failed');
    process.exit(process.exitCode || 1);
  }

  console.log(`browser human flow audit passed. Report: ${REPORT_PATH}`);
  process.exit(0);
}

run();
