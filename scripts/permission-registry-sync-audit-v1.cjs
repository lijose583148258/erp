const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'permission-registry-sync-audit-report-v1.json');
const SCRIPT_TIMEOUT_MS = 290_000;

const report = {
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  findings: [],
  failure: null,
};

let scriptTimer = null;

function recordStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function fail(stage, error) {
  report.status = 'failed';
  report.failure = {
    stage,
    message: String(error?.message || error),
    details: error?.details || null,
    stack: error?.stack || null,
  };
}

function expect(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function unique(values) {
  return Array.from(new Set(values)).sort();
}

function extractQuotedPermissionCodes(source) {
  return unique(
    Array.from(source.matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g))
      .map((match) => match[1])
      .filter((code) => code.includes('.')),
  );
}

function extractBackendDefinitions(source) {
  return unique(Array.from(source.matchAll(/code:\s*'([^']+)'/g)).map((match) => match[1]));
}

function extractStandalonePolicyCodes(source) {
  return unique(Array.from(source.matchAll(/^\s*'([^']+)',?\s*$/gm)).map((match) => match[1]));
}

function auditStaticRegistries() {
  const frontendPath = path.join(process.cwd(), 'app', 'permissions.ts');
  const backendPath = path.join(process.cwd(), 'backend', 'src', 'permissions', 'permissionRegistry.ts');
  const frontendSource = fs.readFileSync(frontendPath, 'utf8');
  const backendSource = fs.readFileSync(backendPath, 'utf8');

  const frontendCodes = extractQuotedPermissionCodes(frontendSource);
  const backendDefinitionCodes = extractBackendDefinitions(backendSource);
  const backendAllPolicyCodes = extractStandalonePolicyCodes(backendSource);

  const missingInBackend = frontendCodes.filter((code) => !backendDefinitionCodes.includes(code));
  const undefinedBackendPolicyCodes = backendAllPolicyCodes.filter((code) => !backendDefinitionCodes.includes(code));

  expect(missingInBackend.length === 0, 'frontend permission codes missing in backend permission registry', missingInBackend);
  expect(undefinedBackendPolicyCodes.length === 0, 'backend role policy references undefined permission codes', undefinedBackendPolicyCodes);

  recordStep({
    step: 'static-registry-sync',
    frontendCodeCount: frontendCodes.length,
    backendDefinitionCount: backendDefinitionCodes.length,
    result: 'passed',
  });

  return { frontendCodes, backendDefinitionCodes };
}

async function apiFetch(endpoint, token = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout for ${endpoint}`)), 10_000);
  try {
    const response = await fetch(`http://127.0.0.1:5001/api${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timer);
  }
}

async function apiPost(endpoint, body, token = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout for ${endpoint}`)), 10_000);
  try {
    const response = await fetch(`http://127.0.0.1:5001/api${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timer);
  }
}

async function auditRuntimeRegistry(expectedCodes) {
  const login = await apiPost('/auth/login', { username: 'admin', password: 'admin123' });
  expect(login.status === 200, 'admin login failed for runtime registry audit', login);
  const token = login.json?.data?.token;
  expect(Boolean(token), 'admin login missing token', login);

  const permissions = await apiFetch('/roles/permissions', token);
  expect(permissions.status === 200, 'runtime permissions endpoint failed', permissions);
  const runtimeCodes = unique((permissions.json?.data || []).map((item) => item.code));
  const missingAtRuntime = expectedCodes.filter((code) => !runtimeCodes.includes(code));
  expect(missingAtRuntime.length === 0, 'runtime permission endpoint missing frontend menu permission codes', missingAtRuntime);

  recordStep({
    step: 'runtime-registry-sync',
    runtimeCodeCount: runtimeCodes.length,
    expectedCodeCount: expectedCodes.length,
    result: 'passed',
  });
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
    saveReport().finally(() => process.exit(1));
  }, SCRIPT_TIMEOUT_MS);

  try {
    const { frontendCodes } = auditStaticRegistries();
    await auditRuntimeRegistry(frontendCodes);
    report.status = 'passed';
  } catch (error) {
    fail('permission-registry-sync-audit', error);
  } finally {
    clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Permission registry sync audit failed');
    process.exit(1);
  }

  console.log(`Permission registry sync audit passed. Report: ${REPORT_PATH}`);
}

main();
