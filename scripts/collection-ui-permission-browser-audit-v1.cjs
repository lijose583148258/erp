/**
 * Collection center UI permission audit.
 *
 * This is the browser-level companion to collection-action-permission-scope-audit-v1:
 * backend 403 is not enough; the UI must not show fake-usable action buttons
 * to roles that cannot perform those actions.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';

const FRONT_URL = (process.env.FRONT_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const API_URL = (process.env.API_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'collection-ui-permission-browser-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'collection-ui-permission-browser-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = 'Audit12345';

const DATA = {
  roles: {
    viewer: `coll_ui_view_${RUN_ID}`.slice(0, 48),
    operator: `coll_ui_oper_${RUN_ID}`.slice(0, 48),
    finance: `coll_ui_fin_${RUN_ID}`.slice(0, 48),
  },
  users: {
    viewer: `coll_ui_viewer_${RUN_ID}`.slice(0, 48),
    operator: `coll_ui_operator_${RUN_ID}`.slice(0, 48),
    finance: `coll_ui_finance_${RUN_ID}`.slice(0, 48),
  },
};

const report = {
  frontUrl: FRONT_URL,
  apiUrl: API_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  status: 'running',
  steps: [],
  failure: null,
};

const prisma = new PrismaClient();
let scriptTimer = null;

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function recordStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 800) };
  }
}

function expect(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function expectStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    const error = new Error(`${label}: expected ${expected.join('/')} but got ${response.status}`);
    error.status = response.status;
    error.details = response.json;
    throw error;
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for ${endpoint}`)),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${API_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, json: parseJson(text), text };
  } finally {
    clearTimeout(timer);
  }
}

function dataOf(response) {
  return response?.json?.data ?? null;
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', { method: 'POST', data: { username, password } });
  expectStatus(response, [200], `login:${username}`);
  const data = dataOf(response);
  expect(Boolean(data?.token), `login:${username} missing token`, response.json);
  expect(Array.isArray(data.user?.permissions), `login:${username} missing permission readback`, response.json);
  return { token: data.token, user: data.user };
}

async function createRole(token, { code, dataScopes, permissions }) {
  const response = await apiFetch('/roles', {
    method: 'POST',
    data: {
      code,
      name: code,
      description: `Created by collection-ui-permission-browser-audit-v1 ${RUN_ID}`,
      isActive: true,
      dataScopes,
      permissions,
    },
  }, token);
  expectStatus(response, [201], `create role ${code}`);
  return dataOf(response);
}

async function createTeamMember(token, { username, role, segment = 'direct' }) {
  const response = await apiFetch('/team', {
    method: 'POST',
    data: {
      username,
      password: PASSWORD,
      email: `${username}@example.com`,
      role,
      segment,
    },
  }, token);
  expectStatus(response, [201], `create user ${username}`);
  return dataOf(response);
}

async function createCustomer(token, label) {
  const response = await apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: `${label}-客户`,
      nameEn: `${label} Customer`,
      nameVi: `${label} Khach Hang`,
      licenseNumber: `LIC-${label}`.slice(0, 64),
      creditLimit: 100000,
      riskLevel: 'medium',
      segment: 'direct',
      contactName: `${label} Contact`,
      contactPhone: '0900000000',
      contactEmail: `${label.toLowerCase()}@example.com`,
      address: `${label} audit address`,
      status: 'active',
    },
  }, token);
  expectStatus(response, [201], `create customer ${label}`);
  const customer = dataOf(response);
  expect(Boolean(customer?.id), `create customer ${label} returned no id`, response.json);
  return customer;
}

async function createOrder(token, customerId, label) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName: `${label}-胶水`,
        specification: 'collection-ui-permission-audit',
        quantity: 10,
        unit: 'kg',
        unitPrice: 120,
      }],
      paymentTerms: 30,
      notes: `collection ui permission audit ${RUN_ID}`,
    },
  }, token);
  expectStatus(response, [201], `create order ${label}`);
  const order = dataOf(response);
  expect(Boolean(order?.id), `create order ${label} returned no id`, response.json);
  return order;
}

async function recordPayment(token, orderId, label) {
  const response = await apiFetch(`/orders/${orderId}/payment`, {
    method: 'POST',
    data: {
      amount: 100,
      method: 'cash',
      payerName: `${label} payer`,
      note: `pending payment ${RUN_ID} ${label}`,
    },
  }, token);
  expectStatus(response, [200], `record payment ${label}`);
}

async function makeOrderOverdue(orderId) {
  const createdAt = new Date(Date.now() - 65 * 24 * 3600 * 1000);
  await prisma.order.update({
    where: { id: Number(orderId) },
    data: { createdAt },
  });
}

async function seedBusinessChain(actor, label) {
  const customer = await createCustomer(actor.token, label);
  const order = await createOrder(actor.token, customer.id, label);
  await recordPayment(actor.token, order.id, label);
  await makeOrderOverdue(order.id);
  return { customer, order };
}

async function saveReport() {
  ensureDir(OUTPUT_DIR);
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function safeScreenshot(page, name) {
  ensureDir(SHOT_DIR);
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(label, timeout, task) {
  const started = Date.now();
  let timer = null;
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout}ms`)), timeout);
      }),
    ]);
    recordStep({ step: label, result: 'passed', timeout, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    recordStep({
      step: label,
      result: 'failed',
      timeout,
      durationMs: Date.now() - started,
      error: String(error?.message || error),
      details: error?.details || null,
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toAppUser(user) {
  return {
    id: String(user.id),
    name: user.username,
    role: user.role,
    segment: user.segment || 'direct',
    avatar: user.avatar || '',
    permissions: user.permissions || [],
  };
}

async function openCollectionsAs(browser, actor, label) {
  const consoleErrors = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
  });
  await context.addInitScript(({ token, user }) => {
    window.localStorage.clear();
    window.localStorage.setItem('token', token);
    window.localStorage.setItem('user', JSON.stringify(user));
    window.localStorage.setItem('ailao.activeTab', 'collections');
    window.localStorage.setItem('ailao.language', 'zh');
    window.localStorage.setItem('currency', 'CNY');
  }, { token: actor.token, user: toAppUser(actor.user) });

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(String(error?.message || error));
  });

  await withTimebox(`open-collections-${label}`, 30_000, async () => {
    await page.goto(`${FRONT_URL}#collections`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => document.body.innerText.includes('回款工作台'), null, { timeout: 20_000 });
  });

  const bodyText = await page.locator('body').innerText();
  const forbiddenMojibakeTokens = ['\uFFFD', '\u00ef\u00bf\u00bd', '\u951f\u65a4\u62f7'];
  for (const forbidden of forbiddenMojibakeTokens) {
    expect(!bodyText.includes(forbidden), `${label} page contains mojibake token ${forbidden}`);
  }

  return { context, page, consoleErrors };
}

async function waitForOrder(page, orderNo, label) {
  await withTimebox(`wait-order-${label}`, 25_000, async () => {
    await page.getByText(String(orderNo), { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 });
  });
}

async function selectOrder(page, orderNo, label) {
  await waitForOrder(page, orderNo, label);
  await withTimebox(`select-order-${label}`, 15_000, async () => {
    await page.getByText(String(orderNo), { exact: false }).first().click();
    await page.waitForTimeout(600);
  });
}

async function buttonCount(page, label) {
  return page.getByRole('button', { name: label, exact: true }).count();
}

async function expectButtonVisible(page, label, roleLabel) {
  const count = await buttonCount(page, label);
  expect(count > 0, `${roleLabel}: expected visible button "${label}"`, { count });
  recordStep({ step: 'button-visible', role: roleLabel, label, count, result: 'passed' });
}

async function expectButtonHidden(page, label, roleLabel) {
  const count = await buttonCount(page, label);
  expect(count === 0, `${roleLabel}: expected hidden button "${label}"`, { count });
  recordStep({ step: 'button-hidden', role: roleLabel, label, count, result: 'passed' });
}

async function waitForPromiseReadback(token, note, orderId) {
  const deadline = Date.now() + 20_000;
  let lastPayload = null;
  while (Date.now() < deadline) {
    const response = await apiFetch('/collections/promises', {}, token);
    expectStatus(response, [200], 'operator promise readback');
    const rows = Array.isArray(dataOf(response)) ? dataOf(response) : [];
    const hit = rows.find((row) => String(row.note || '').includes(note) && Number(row.orderId) === Number(orderId));
    if (hit) return hit;
    lastPayload = rows.slice(0, 5);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  const error = new Error('operator promise readback not found after UI submit');
  error.details = { note, orderId, lastPayload };
  throw error;
}

async function auditViewer(browser, actor, seed) {
  const { context, page, consoleErrors } = await openCollectionsAs(browser, actor, 'viewer');
  try {
    await selectOrder(page, seed.order.orderNo, 'viewer');
    for (const label of ['同步逾期', '批量催收', '催收提醒', '承诺付款', '发起争议', '核销', '核销该笔', '释放']) {
      await expectButtonHidden(page, label, 'viewer');
    }
    const screenshot = await safeScreenshot(page, 'viewer-hidden-actions');
    recordStep({ step: 'viewer-evidence', result: 'passed', screenshot, consoleErrors: consoleErrors.slice(0, 8) });
  } finally {
    await context.close().catch(() => {});
  }
}

async function auditOperator(browser, actor, seed) {
  const { context, page, consoleErrors } = await openCollectionsAs(browser, actor, 'operator');
  try {
    await selectOrder(page, seed.order.orderNo, 'operator');
    for (const label of ['同步逾期', '核销', '核销该笔', '释放']) {
      await expectButtonHidden(page, label, 'operator');
    }
    for (const label of ['批量催收', '催收提醒', '承诺付款', '发起争议']) {
      await expectButtonVisible(page, label, 'operator');
    }
    await withTimebox('operator-submit-promise-modal', 30_000, async () => {
      await page.getByRole('button', { name: '承诺付款' }).first().click();
      const modal = page.locator('div.fixed.inset-0').last();
      await modal.getByRole('heading', { name: /承诺/ }).first().waitFor({ state: 'visible', timeout: 10_000 });
      await page.locator('input[type="number"]').first().fill('88');
      const note = `UI-PERM-PROMISE-${RUN_ID}`;
      await modal.locator('input').last().fill(note);
      await modal.getByRole('button', { name: /提交|承诺/ }).last().click();
      await waitForPromiseReadback(actor.token, note, seed.order.id);
    });
    const screenshot = await safeScreenshot(page, 'operator-action-visible-and-promise-submitted');
    recordStep({ step: 'operator-evidence', result: 'passed', screenshot, consoleErrors: consoleErrors.slice(0, 8) });
  } finally {
    await context.close().catch(() => {});
  }
}

async function auditFinance(browser, actor, seed) {
  const { context, page, consoleErrors } = await openCollectionsAs(browser, actor, 'finance');
  try {
    await selectOrder(page, seed.order.orderNo, 'finance');
    for (const label of ['同步逾期', '核销该笔', '释放']) {
      await expectButtonVisible(page, label, 'finance');
    }
    await withTimebox('finance-click-verify-payment', 25_000, async () => {
      await page.getByRole('button', { name: '核销该笔' }).first().click();
      await page.waitForTimeout(1200);
    });
    const orderResponse = await apiFetch(`/orders/${seed.order.id}`, {}, actor.token);
    expectStatus(orderResponse, [200], 'finance order readback after verify');
    const order = dataOf(orderResponse);
    expect(Number(order?.paidAmount || 0) >= 100, 'finance verify did not update paidAmount', order);
    expect(['partial', 'paid'].includes(order?.paymentStatus), 'finance verify did not update paymentStatus', order);
    const screenshot = await safeScreenshot(page, 'finance-visible-actions-and-verify-readback');
    recordStep({
      step: 'finance-evidence',
      result: 'passed',
      screenshot,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
      consoleErrors: consoleErrors.slice(0, 8),
    });
  } finally {
    await context.close().catch(() => {});
  }
}

function fail(stage, error) {
  report.status = 'failed';
  report.failure = {
    stage,
    name: error?.name || null,
    message: error?.message || String(error),
    status: error?.status || null,
    details: error?.details || null,
    stack: error?.stack || null,
  };
}

async function main() {
  ensureDir(OUTPUT_DIR);
  ensureDir(SHOT_DIR);

  scriptTimer = setTimeout(() => {
    const error = new Error(`Script timeout after ${SCRIPT_TIMEOUT_MS}ms`);
    fail('script-timeout', error);
    saveReport().finally(() => {
      console.error(error.message);
      process.exit(1);
    });
  }, SCRIPT_TIMEOUT_MS);

  let browser = null;
  try {
    const admin = await login('admin', 'admin123');
    recordStep({ step: 'admin-login', result: 'passed', adminUserId: admin.user.id });

    await createRole(admin.token, {
      code: DATA.roles.viewer,
      dataScopes: ['own_customers'],
      permissions: [
        'dashboard.read',
        'customers.read',
        'customers.create',
        'orders.read',
        'orders.create',
        'orders.payment.record',
        'collections.read',
      ],
    });
    await createRole(admin.token, {
      code: DATA.roles.operator,
      dataScopes: ['own_customers'],
      permissions: [
        'dashboard.read',
        'customers.read',
        'customers.create',
        'orders.read',
        'orders.create',
        'orders.payment.record',
        'collections.read',
        'collections.reminder.write',
        'collections.promise.write',
        'collections.dispute.write',
      ],
    });
    await createRole(admin.token, {
      code: DATA.roles.finance,
      dataScopes: ['finance_visible'],
      permissions: [
        'dashboard.read',
        'orders.read',
        'orders.payment.verify',
        'collections.read',
        'collections.sync',
        'collections.hold.manage',
      ],
    });
    recordStep({ step: 'roles-created', result: 'passed' });

    await createTeamMember(admin.token, { username: DATA.users.viewer, role: DATA.roles.viewer });
    await createTeamMember(admin.token, { username: DATA.users.operator, role: DATA.roles.operator });
    await createTeamMember(admin.token, { username: DATA.users.finance, role: DATA.roles.finance, segment: 'mixed' });
    recordStep({ step: 'users-created', result: 'passed' });

    const viewer = await login(DATA.users.viewer, PASSWORD);
    const operator = await login(DATA.users.operator, PASSWORD);
    const finance = await login(DATA.users.finance, PASSWORD);
    recordStep({
      step: 'custom-logins',
      result: 'passed',
      permissions: {
        viewer: viewer.user.permissions,
        operator: operator.user.permissions,
        finance: finance.user.permissions,
      },
    });

    const viewerSeed = await seedBusinessChain(viewer, `UI-PERM-VIEW-${RUN_ID}`);
    const operatorSeed = await seedBusinessChain(operator, `UI-PERM-OPER-${RUN_ID}`);
    await apiFetch('/collections/sync-overdue', { method: 'POST' }, finance.token).then((response) => {
      expectStatus(response, [200], 'finance sync overdue for UI seed');
    });
    await apiFetch(`/collections/orders/${operatorSeed.order.id}/shipment-hold`, {
      method: 'POST',
      data: { reason: `UI permission hold ${RUN_ID}` },
    }, finance.token).then((response) => {
      expectStatus(response, [200], 'finance set order hold for UI seed');
    });
    recordStep({
      step: 'business-seed-created',
      result: 'passed',
      viewerOrderNo: viewerSeed.order.orderNo,
      operatorOrderNo: operatorSeed.order.orderNo,
    });

    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;

    await auditViewer(browser, viewer, viewerSeed);
    await auditOperator(browser, operator, operatorSeed);
    await auditFinance(browser, finance, operatorSeed);

    report.status = 'passed';
  } catch (error) {
    if (error?.auditKind) {
      markReportFromLaunchError(report, error);
      if (report.status !== 'blocked_env') process.exitCode = 1;
    } else {
      fail('main', error);
      process.exitCode = 1;
    }
  } finally {
    clearTimeout(scriptTimer);
    if (browser) await browser.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    await saveReport();
  }
}

main()
  .then(() => {
    if (report.status === 'passed') {
      console.log(`Collection UI permission browser audit passed. Report: ${REPORT_PATH}`);
    } else {
      console.error(`Collection UI permission browser audit ${report.status}. Report: ${REPORT_PATH}`);
      process.exitCode = process.exitCode || 1;
    }
  })
  .catch((error) => {
    console.error(error?.stack || error);
    console.error(`Report: ${REPORT_PATH}`);
    process.exit(1);
  });
