import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Browser, Page } from 'playwright';
import {
  getModuleDescription,
  getModuleLabel,
  getModuleTitle,
  type ModuleId,
} from '../components/navigation/moduleRegistry';

const require = createRequire(import.meta.url);
const { connectOrLaunchBrowser } = require('./lib/browser-connect-or-launch.cjs') as {
  connectOrLaunchBrowser: (options?: {
    recordStep?: (entry: Record<string, unknown>) => void;
    retryLimit?: number;
    waitMs?: number;
  }) => Promise<{ browser: Browser; launcher?: unknown }>;
};
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs') as {
  loginUiAuditUser: (page: Page, appUrl: string, options?: {
    account?: { username: string; password: string; role: string };
    storage?: Record<string, string>;
    defaultStorage?: Record<string, string>;
  }) => Promise<{ token: string; user: unknown; account: unknown }>;
};

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'module-registry-title-probe-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'module-registry-title-probe-v1.json');

const TIMEOUTS = {
  login: 15000,
  route: 15000,
  text: 15000,
  action: 12000,
  screenshot: 5000,
};

const PAGE_CHECKS: Array<{ id: ModuleId; hash: string }> = [
  { id: 'crm', hash: '#crm' },
  { id: 'procurement', hash: '#procurement' },
  { id: 'warehouse', hash: '#warehouse' },
  { id: 'production', hash: '#production' },
  { id: 'barter', hash: '#barter' },
];

const BAD_VISIBLE_TOKENS = [
  'undefined',
  '\uFFFD',
  '\u7f01\u5fd9\u60c0',
  '\u7019\u3221\u57db',
  '\u95b2\u56c1\u5598',
  '\u6d60\u6493\u504d',
  '\u7480\u6cd5\u59f7',
  '\u00c3',
  '\u00c2',
];

type AuditStep = {
  at: string;
  step: string;
  result: 'running' | 'passed' | 'failed';
  durationMs?: number;
  timeoutMs?: number;
  [key: string]: unknown;
};

const report: {
  appUrl: string;
  startedAt: string;
  status: 'running' | 'passed' | 'failed';
  launcher?: unknown;
  steps: AuditStep[];
  pages: Array<Record<string, unknown>>;
  roleChecks: Array<Record<string, unknown>>;
  commandChecks: Array<Record<string, unknown>>;
  error?: string;
  finishedAt?: string;
} = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  pages: [],
  roleChecks: [],
  commandChecks: [],
};

function ensureDir(target: string) {
  fs.mkdirSync(target, { recursive: true });
}

function recordStep(entry: Omit<AuditStep, 'at'>) {
  report.steps.push({ at: new Date().toISOString(), ...entry } as AuditStep);
}

function writeReport() {
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function withTimebox<T>(step: string, timeoutMs: number, task: () => Promise<T>): Promise<T> {
  const started = Date.now();
  recordStep({ step, result: 'running', timeoutMs });
  try {
    const result = await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${step} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    recordStep({ step, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({
      step,
      result: 'failed',
      durationMs: Date.now() - started,
      timeoutMs,
      error: String(error instanceof Error ? error.message : error),
    });
    throw error;
  }
}

async function login(page: Page, username: string, _password: string) {
  return withTimebox(`login-${username}`, TIMEOUTS.login, async () => {
    const role = username === 'sales' ? 'sales' : 'admin';
    const account = {
      username: username === 'sales' ? 'ui_smoke_sales' : 'ui_smoke_admin',
      password: 'AuditSmoke12345!',
      role,
    };
    return loginUiAuditUser(page, APP_URL, {
      account,
      storage: {
        'ailao.language': 'zh',
        language: 'zh-CN',
        currency: 'CNY',
      },
    });
  });
}

async function getBodyText(page: Page, scope: string): Promise<string> {
  const bodyText = await page.locator('body').innerText({ timeout: TIMEOUTS.text });
  const badToken = BAD_VISIBLE_TOKENS.find((token) => bodyText.includes(token));
  if (badToken) {
    throw new Error(`${scope} contains bad visible token`);
  }
  return bodyText;
}

async function screenshot(page: Page, name: string) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false, timeout: TIMEOUTS.screenshot });
  return filePath;
}

async function checkModulePages(page: Page) {
  for (const item of PAGE_CHECKS) {
    const title = getModuleTitle(item.id, 'zh');
    const description = getModuleDescription(item.id, 'zh');
    await withTimebox(`open-${item.id}`, TIMEOUTS.route, async () => {
      await page.goto(`${APP_URL}${item.hash}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
      await page.waitForFunction((expectedTitle) => {
        return document.body.innerText.includes(expectedTitle);
      }, title, { timeout: TIMEOUTS.text });
      const bodyText = await getBodyText(page, item.id);
      if (!bodyText.includes(description)) {
        throw new Error(`${item.id} description is not visible`);
      }
      const image = await screenshot(page, item.id);
      report.pages.push({
        moduleId: item.id,
        hash: item.hash,
        title,
        description,
        result: 'passed',
        screenshot: image,
      });
    });
  }
}

async function checkCommandPalette(page: Page) {
  await withTimebox('command-palette-barter-alias', TIMEOUTS.action, async () => {
    await page.goto(`${APP_URL}#dashboard`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
    await page.locator('header input[readonly]').first().click({ timeout: TIMEOUTS.action });
    const searchInput = page.locator('.fixed.inset-0 input').first();
    await searchInput.waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    await searchInput.fill('barter');
    const barterLabel = getModuleLabel('barter', 'zh');
    await page.locator('button').filter({ hasText: barterLabel }).first().waitFor({ state: 'visible', timeout: TIMEOUTS.action });
    report.commandChecks.push({
      query: 'barter',
      expected: barterLabel,
      result: 'passed',
    });
  });
}

async function checkSalesRole(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await login(page, 'sales', 'sales123');
    await withTimebox('sales-role-navigation-scope', TIMEOUTS.route, async () => {
      await page.goto(`${APP_URL}#dashboard`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.route });
      await page.waitForTimeout(800);
      const bodyText = await getBodyText(page, 'sales-shell');
      const forbidden = [
        getModuleLabel('warehouse', 'zh'),
        getModuleLabel('audit', 'zh'),
        getModuleLabel('team', 'zh'),
      ];
      const visibleForbidden = forbidden.filter((label) => bodyText.includes(label));
      if (visibleForbidden.length > 0) {
        throw new Error(`sales role sees forbidden nav labels: ${visibleForbidden.join(', ')}`);
      }
      const requiredVisible = getModuleLabel('crm', 'zh');
      if (!bodyText.includes(requiredVisible)) {
        throw new Error(`sales role cannot see ${requiredVisible}`);
      }
      report.roleChecks.push({
        role: 'sales',
        hidden: forbidden,
        requiredVisible,
        result: 'passed',
      });
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main() {
  ensureDir(SHOT_DIR);
  let browser: Browser | null = null;
  try {
    const launched = await connectOrLaunchBrowser({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;

    const adminPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await login(adminPage, 'admin', 'admin123');
      await checkModulePages(adminPage);
      await checkCommandPalette(adminPage);
    } finally {
      await adminPage.close().catch(() => undefined);
    }

    await checkSalesRole(browser);

    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
    writeReport();
    console.log(JSON.stringify({
      status: report.status,
      pages: report.pages.length,
      roleChecks: report.roleChecks.length,
      commandChecks: report.commandChecks.length,
      report: REPORT_PATH,
      screenshots: SHOT_DIR,
    }, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = String(error instanceof Error ? error.message : error);
    report.finishedAt = new Date().toISOString();
    writeReport();
    console.error(JSON.stringify({
      status: report.status,
      error: report.error,
      report: REPORT_PATH,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

void main();
