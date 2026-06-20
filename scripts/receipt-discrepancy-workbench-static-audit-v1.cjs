const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'receipt-discrepancy-workbench-static-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const RULE_NAME = `WB-STATIC-TOL-RULE-${RUN_ID}`;

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  ruleName: RULE_NAME,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json, text };
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function expectOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response;
}

async function login(username, password) {
  const response = await expectOk(`login ${username}`, apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  }));
  return response.json.data;
}

function scanNoMojibake(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const badTokens = [
    0xfffd,
    0x7019,
    0x7481,
    0x93c0,
    0x95b2,
    0x9347,
    0x74a7,
    0x748b,
    0x7490,
    0x93b9,
    0x7edb,
    0x9427,
    0x7db7,
    0x951b,
    0x697c,
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const hit = badTokens.find((token) => text.includes(token));
  assert(!hit, `${filePath} contains mojibake token ${hit}`);
}

function verifySourceRegistration() {
  const checks = [
    ['app/activePathRegistry.ts', 'discrepancies'],
    ['app/appContent.tsx', 'ReceiptDiscrepancyWorkbench'],
    ['components/Layout.tsx', '收发货差异'],
    ['components/CommandPalette.tsx', 'nav-discrepancies'],
    ['pages/ReceiptDiscrepancyWorkbench.tsx', '收发货差异工作台'],
  ];
  for (const [filePath, expected] of checks) {
    const text = fs.readFileSync(filePath, 'utf8');
    assert(text.includes(expected), `${filePath} missing ${expected}`);
    scanNoMojibake(filePath);
  }
  recordStep({ step: 'source-registration', result: 'passed', files: checks.map(([filePath]) => filePath) });
}

function verifyBuiltChunk() {
  const distAssets = path.join(process.cwd(), 'dist', 'assets');
  const chunk = fs.readdirSync(distAssets).find((name) => /^ReceiptDiscrepancyWorkbench-.*\.js$/.test(name));
  assert(chunk, 'ReceiptDiscrepancyWorkbench chunk missing from dist/assets');
  const chunkPath = path.join(distAssets, chunk);
  scanNoMojibake(chunkPath);
  const text = fs.readFileSync(chunkPath, 'utf8');
  assert(text.includes('收发货差异工作台'), 'workbench built chunk missing expected title');
  recordStep({ step: 'built-chunk', result: 'passed', chunk });
}

async function verifyHttpAndApi() {
  const health = await expectOk('health', fetch(`${APP_URL}api/health`).then(async (response) => ({
    ok: response.ok,
    status: response.status,
    json: await response.json(),
  })));
  assert(health.json.status === 'ok', 'health status is not ok');

  const indexResponse = await fetch(APP_URL);
  const indexText = await indexResponse.text();
  assert(indexResponse.ok, `index failed: ${indexResponse.status}`);
  assert(indexText.includes('<div id="root">'), 'index missing root element');

  const manager = await login('manager', 'manager123');
  await expectOk('list discrepancy cases', apiFetch('/receipt-discrepancies?pageSize=5', {}, manager.token));
  await expectOk('list tolerance rules', apiFetch('/receipt-discrepancies/tolerance-rules?pageSize=5', {}, manager.token));

  const created = await expectOk('create workbench tolerance rule', apiFetch('/receipt-discrepancies/tolerance-rules', {
    method: 'POST',
    data: {
      name: RULE_NAME,
      sourceType: 'all',
      discrepancyType: 'all',
      counterpartyType: 'all',
      quantityTolerancePercent: 0,
      quantityToleranceAbs: 0,
      actionWithinTolerance: 'warn',
      actionOutsideTolerance: 'manual_review',
      priority: 120,
      note: 'static workbench audit',
    },
  }, manager.token));
  assert(created.json.data?.ruleNo, 'created rule missing ruleNo');

  const readback = await expectOk('readback workbench tolerance rules', apiFetch('/receipt-discrepancies/tolerance-rules?pageSize=100', {}, manager.token));
  const found = unwrapList(readback).find((rule) => String(rule.name) === RULE_NAME);
  assert(found, 'created workbench rule not found by API readback');
  recordStep({
    step: 'http-api-readback',
    result: 'passed',
    ruleNo: created.json.data.ruleNo,
    ruleName: RULE_NAME,
  });
}

async function run() {
  try {
    verifySourceRegistration();
    verifyBuiltChunk();
    await verifyHttpAndApi();
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'receipt discrepancy workbench static audit failed');
    process.exit(1);
  }

  console.log(`Receipt discrepancy workbench static audit passed. Report: ${REPORT_PATH}`);
}

run();
