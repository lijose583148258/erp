const fs = require('fs');
const path = require('path');
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'browser-cdp-probe-report.json');
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const GLOBAL_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 30000);

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  cdpUrl: process.env.BROWSER_CDP_URL || null,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function writeReport() {
  report.finishedAt = report.finishedAt || new Date().toISOString();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function run() {
  let browser;
  const watchdog = setTimeout(() => {
    report.status = 'stuck';
    report.error = `browser cdp probe exceeded ${GLOBAL_TIMEOUT_MS}ms`;
    report.blockerCode = 'BROWSER_CDP_PROBE_TIMEOUT';
    report.blockerVerdict = 'script_stuck';
    writeReport();
    console.error(report.error);
    process.exit(124);
  }, GLOBAL_TIMEOUT_MS);

  try {
    const launched = await connectOrLaunchBrowser({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    report.endpoint = launched.endpoint || null;

    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await page.title();
    report.title = title;
    report.status = 'passed';
    recordStep({ step: 'open-app', result: 'passed', title });
  } catch (error) {
    report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
    report.error = String(error?.message || error);
    report.blockerCode = error?.auditCode || null;
    report.blockerVerdict = error?.auditVerdict || null;
    if (Array.isArray(error?.launchFailures)) report.launchFailures = error.launchFailures;
  } finally {
    clearTimeout(watchdog);
    writeReport();
    if (browser && report.launcher !== 'cdp') {
      await browser.close();
    }
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'browser cdp probe failed');
    process.exit(1);
  }

  console.log(`Browser CDP probe passed. Report: ${REPORT_PATH}`);
  process.exit(0);
}

run();
