/**
 * Collection center API performance audit.
 *
 * Read-only probe for the collection workspace. It measures the same API fan-out
 * the browser page performs and writes machine-readable evidence for timeout
 * decisions. This is intentionally data-preserving: no seed, no mutation.
 */
const fs = require('fs');
const path = require('path');
const { applyAuditDatabaseContext } = require('./lib/audit-runtime-context.cjs');
const { ensureUiAuditAccounts } = require('./lib/ui-audit-user.cjs');
applyAuditDatabaseContext(process.env);
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const API_URL = (process.env.API_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'collection-performance-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 10_000);
const SCRIPT_TIMEOUT_MS = Number(process.env.SCRIPT_TIMEOUT_MS || 290_000);
let ADMIN;

const ENDPOINTS = [
  ['/collections/summary', 'summary'],
  ['/collections/ledger?pageSize=20', 'ledger'],
  ['/collections/overdue?pageSize=100', 'overdue'],
  ['/collections/milestones', 'milestones'],
  ['/collections/promises', 'promises'],
  ['/collections/disputes', 'disputes'],
  ['/collections/holds', 'holds'],
];
const WORKBENCH_ENDPOINT = ['/collections/workbench', 'workbench'];

const prisma = new PrismaClient();
const report = {
  apiUrl: API_URL,
  startedAt: new Date().toISOString(),
  timeoutMs: {
    request: REQUEST_TIMEOUT_MS,
    script: SCRIPT_TIMEOUT_MS,
  },
  status: 'running',
  database: null,
  workbench: [],
  sequential: [],
  concurrent: [],
  summary: null,
  failure: null,
};

let scriptTimer = null;

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 800) };
  }
}

function payloadCount(json) {
  if (!json) return null;
  if (Array.isArray(json.data)) return json.data.length;
  if (Array.isArray(json.data?.items)) return json.data.items.length;
  if (Array.isArray(json.items)) return json.items.length;
  if (Array.isArray(json.data?.priorityActions)) return json.data.priorityActions.length;
  return null;
}

function getMeta(json) {
  return json?.meta || json?.data?.meta || null;
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const started = Date.now();
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
    const json = parseJson(text);
    return {
      endpoint,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - started,
      count: payloadCount(json),
      meta: getMeta(json),
      message: json?.message || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function login() {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for /auth/login`)),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${API_URL}api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN),
      signal: controller.signal,
    });
    const json = await response.json();
    const token = json?.data?.token;
    if (response.status !== 200 || !token) {
      throw new Error(`admin login failed: ${JSON.stringify({ status: response.status, message: json?.message })}`);
    }
    return token;
  } finally {
    clearTimeout(timer);
  }
}

async function databaseSnapshot() {
  const [
    customers,
    orders,
    unpaidOrders,
    paymentRecords,
    pendingPayments,
    promises,
    disputes,
    auditLogs,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.order.count(),
    prisma.order.count({ where: { paymentStatus: { not: 'paid' }, status: { not: 'cancelled' } } }),
    prisma.paymentRecord.count(),
    prisma.paymentRecord.count({ where: { status: 'pending' } }),
    prisma.collectionPromise.count(),
    prisma.collectionDispute.count(),
    prisma.auditLog.count(),
  ]);

  return {
    customers,
    orders,
    unpaidOrders,
    paymentRecords,
    pendingPayments,
    promises,
    disputes,
    auditLogs,
  };
}

function summarizeResults(results) {
  const durations = results.map(row => row.durationMs).sort((a, b) => a - b);
  const max = durations[durations.length - 1] || 0;
  const total = durations.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
  return {
    requestCount: results.length,
    failedCount: results.filter(row => !row.ok).length,
    maxDurationMs: max,
    avgDurationMs: durations.length ? Math.round(total / durations.length) : 0,
    p95DurationMs: durations[p95Index] || 0,
    slowest: [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
  };
}

async function saveReport() {
  ensureDir(OUTPUT_DIR);
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  ensureDir(OUTPUT_DIR);
  scriptTimer = setTimeout(() => {
    throw new Error(`collection-performance-audit-v1 exceeded ${SCRIPT_TIMEOUT_MS}ms`);
  }, SCRIPT_TIMEOUT_MS);

  try {
    const accounts = await ensureUiAuditAccounts('collection_performance', ['admin']);
    ADMIN = accounts.admin;
    report.database = await databaseSnapshot();
    const token = await login();

    for (let round = 1; round <= 3; round += 1) {
      const [endpoint, label] = WORKBENCH_ENDPOINT;
      const result = await apiFetch(endpoint, {}, token);
      report.workbench.push({ round, label, ...result });
    }

    for (let round = 1; round <= 3; round += 1) {
      for (const [endpoint, label] of ENDPOINTS) {
        const result = await apiFetch(endpoint, {}, token);
        report.sequential.push({ round, label, ...result });
      }
    }

    const concurrentStartedAt = Date.now();
    const concurrent = await Promise.all(ENDPOINTS.map(([endpoint, label]) =>
      apiFetch(endpoint, {}, token).then(result => ({ label, ...result })),
    ));
    report.concurrent.push({
      round: 1,
      durationMs: Date.now() - concurrentStartedAt,
      results: concurrent,
    });

    const flatConcurrent = report.concurrent.flatMap(group => group.results);
    report.summary = {
      workbench: summarizeResults(report.workbench),
      sequential: summarizeResults(report.sequential),
      concurrent: summarizeResults(flatConcurrent),
      concurrentWallClockMs: report.concurrent[0]?.durationMs || 0,
    };

    const failed = report.workbench.some(row => !row.ok)
      || report.sequential.some(row => !row.ok)
      || flatConcurrent.some(row => !row.ok);
    report.status = failed ? 'failed' : 'passed';
    if (failed) {
      throw new Error('One or more collection endpoints returned non-2xx status');
    }
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    };
    throw error;
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await prisma.$disconnect();
    await saveReport();
  }
}

main()
  .then(() => {
    console.log(JSON.stringify({
      status: report.status,
      durationMs: report.durationMs,
      summary: report.summary,
      reportPath: REPORT_PATH,
    }, null, 2));
  })
  .catch(error => {
    console.error(error);
    console.error(`Report written to ${REPORT_PATH}`);
    process.exit(1);
  });
