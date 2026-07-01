/**
 * Auth session token API audit.
 *
 * Proves login, /auth/me, refresh-token rotation, logout blacklisting, and
 * optional refresh-token revocation work together through the real backend.
 */
const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'auth-session-token-api-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const ADMIN = {
  username: process.env.AUDIT_UI_USERNAME || 'ui_auth_session_admin',
  password: process.env.AUDIT_UI_PASSWORD || 'AuditSmoke12345!',
  role: 'admin',
};

const report = {
  appUrl: APP_URL,
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
    const loginResponse = await apiFetch('/auth/login', {
      method: 'POST',
      data: { username: ADMIN.username, password: ADMIN.password },
    });
    expectStatus(loginResponse, [200], 'login');
    const loginData = dataOf(loginResponse);
    expect(Boolean(loginData?.token), 'login missing access token', loginResponse.json);
    expect(Boolean(loginData?.refreshToken), 'login missing refresh token', loginResponse.json);
    expect(Boolean(loginData?.user?.permissions?.length), 'login missing permission list', loginResponse.json);
    recordStep({ step: 'login', result: 'passed', permissionCount: loginData.user.permissions.length });

    const meBeforeRefresh = await apiFetch('/auth/me', {}, loginData.token);
    expectStatus(meBeforeRefresh, [200], 'me-before-refresh');
    expect(dataOf(meBeforeRefresh)?.username === ADMIN.username, 'me-before-refresh user mismatch', meBeforeRefresh.json);
    recordStep({ step: 'me-before-refresh', result: 'passed' });

    const refreshResponse = await apiFetch('/auth/refresh', {
      method: 'POST',
      data: { refreshToken: loginData.refreshToken },
    });
    expectStatus(refreshResponse, [200], 'refresh');
    const refreshData = dataOf(refreshResponse);
    expect(Boolean(refreshData?.token), 'refresh missing new access token', refreshResponse.json);
    expect(Boolean(refreshData?.refreshToken), 'refresh missing new refresh token', refreshResponse.json);
    expect(refreshData.refreshToken !== loginData.refreshToken, 'refresh token was not rotated', refreshResponse.json);
    recordStep({ step: 'refresh-token-rotated', result: 'passed' });

    const oldRefreshAttempt = await apiFetch('/auth/refresh', {
      method: 'POST',
      data: { refreshToken: loginData.refreshToken },
    });
    expectStatus(oldRefreshAttempt, [401], 'old-refresh-token-rejected');
    recordStep({ step: 'old-refresh-token-rejected', result: 'passed' });

    const meAfterRefresh = await apiFetch('/auth/me', {}, refreshData.token);
    expectStatus(meAfterRefresh, [200], 'me-after-refresh');
    recordStep({ step: 'me-after-refresh', result: 'passed' });

    const logoutResponse = await apiFetch('/auth/logout', {
      method: 'POST',
      data: { refreshToken: refreshData.refreshToken },
    }, refreshData.token);
    expectStatus(logoutResponse, [200], 'logout');
    recordStep({ step: 'logout', result: 'passed' });

    const meAfterLogout = await apiFetch('/auth/me', {}, refreshData.token);
    expectStatus(meAfterLogout, [401], 'access-token-blacklisted-after-logout');
    recordStep({ step: 'access-token-blacklisted-after-logout', result: 'passed' });

    const refreshAfterLogout = await apiFetch('/auth/refresh', {
      method: 'POST',
      data: { refreshToken: refreshData.refreshToken },
    });
    expectStatus(refreshAfterLogout, [401], 'refresh-token-revoked-after-logout');
    recordStep({ step: 'refresh-token-revoked-after-logout', result: 'passed' });

    report.status = 'passed';
  } catch (error) {
    fail('auth-session-token-api-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Auth session token API audit failed');
    process.exit(1);
  }

  console.log(`Auth session token API audit passed. Report: ${REPORT_PATH}`);
}

main();
