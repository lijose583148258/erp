/**
 * Auth account lifecycle API audit.
 *
 * Covers successful /auth/register and /auth/password behavior against the
 * real backend. Uses a unique sales test user and does not modify seeded users.
 */
const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'auth-account-lifecycle-api-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const ADMIN = {
  username: process.env.AUDIT_UI_USERNAME || 'ui_auth_lifecycle_admin',
  password: process.env.AUDIT_UI_PASSWORD || 'AuditSmoke12345!',
  role: 'admin',
};
const USER = {
  username: `auth_lifecycle_${RUN_ID}`,
  password: 'Audit12345',
  nextPassword: 'Audit67890',
  email: `auth_lifecycle_${RUN_ID}@example.com`,
};

const report = {
  appUrl: APP_URL,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  failure: null,
};

let scriptTimer = null;

function recordStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
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
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

async function login(account, label) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: account,
  });
  expectStatus(response, [200], `login:${label}`);
  const data = dataOf(response);
  expect(Boolean(data?.token), `login:${label} missing token`, response.json);
  recordStep({ step: 'login', label, role: data.user?.role, result: 'passed' });
  return data;
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

async function saveReport() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  report.endedAt = new Date().toISOString();
  report.durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  scriptTimer = setTimeout(() => {
    const error = new Error(`Script timeout after ${SCRIPT_TIMEOUT_MS}ms`);
    fail('script-timeout', error);
    saveReport().finally(() => {
      console.error(error.message);
      process.exit(1);
    });
  }, SCRIPT_TIMEOUT_MS);

  try {
    await ensureUiAuditUser(ADMIN);
    const admin = await login(ADMIN, 'admin');

    const registerResponse = await apiFetch('/auth/register', {
      method: 'POST',
      data: {
        username: USER.username,
        password: USER.password,
        email: USER.email,
        role: 'sales',
        segment: 'direct',
      },
    }, admin.token);
    expectStatus(registerResponse, [201], 'register-sales-user');
    const created = dataOf(registerResponse);
    expect(created?.username === USER.username, 'registered username mismatch', registerResponse.json);
    expect(created?.role === 'sales', 'registered user role mismatch', registerResponse.json);
    expect(created?.mustChangePassword === true, 'registered user should require first password change', registerResponse.json);
    recordStep({ step: 'register-sales-user', result: 'passed', userId: created.id });

    const userLogin = await login({ username: USER.username, password: USER.password }, 'new-sales-user');
    expect(userLogin.user?.mustChangePassword === true, 'new user login should require first password change', userLogin.user);
    recordStep({ step: 'first-login-requires-password-change', result: 'passed' });

    const wrongOldPasswordResponse = await apiFetch('/auth/password', {
      method: 'PUT',
      data: {
        oldPassword: 'WrongOldPassword',
        newPassword: USER.nextPassword,
      },
    }, userLogin.token);
    expectStatus(wrongOldPasswordResponse, [400], 'change-password-wrong-old-rejected');
    recordStep({ step: 'change-password-wrong-old-rejected', result: 'passed' });

    const changePasswordResponse = await apiFetch('/auth/password', {
      method: 'PUT',
      data: {
        oldPassword: USER.password,
        newPassword: USER.nextPassword,
      },
    }, userLogin.token);
    expectStatus(changePasswordResponse, [200], 'change-password');
    recordStep({ step: 'change-password', result: 'passed' });

    const oldLoginAttempt = await apiFetch('/auth/login', {
      method: 'POST',
      data: { username: USER.username, password: USER.password },
    });
    expectStatus(oldLoginAttempt, [401], 'old-password-rejected-after-change');
    recordStep({ step: 'old-password-rejected-after-change', result: 'passed' });

    const newLogin = await login({ username: USER.username, password: USER.nextPassword }, 'new-password');
    const meResponse = await apiFetch('/auth/me', {}, newLogin.token);
    expectStatus(meResponse, [200], 'me-after-password-change');
    expect(dataOf(meResponse)?.username === USER.username, 'me-after-password-change user mismatch', meResponse.json);
    expect(dataOf(meResponse)?.mustChangePassword === false, 'me-after-password-change should clear first password change requirement', meResponse.json);
    recordStep({ step: 'me-after-password-change', result: 'passed' });

    const logoutResponse = await apiFetch('/auth/logout', {
      method: 'POST',
      data: { refreshToken: newLogin.refreshToken },
    }, newLogin.token);
    expectStatus(logoutResponse, [200], 'logout-new-user');
    recordStep({ step: 'logout-new-user', result: 'passed' });

    const meAfterLogout = await apiFetch('/auth/me', {}, newLogin.token);
    expectStatus(meAfterLogout, [401], 'token-rejected-after-logout');
    recordStep({ step: 'token-rejected-after-logout', result: 'passed' });

    report.status = 'passed';
  } catch (error) {
    fail('auth-account-lifecycle-api-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Auth account lifecycle API audit failed');
    process.exit(1);
  }

  console.log(`Auth account lifecycle API audit passed. Report: ${REPORT_PATH}`);
}

main();
