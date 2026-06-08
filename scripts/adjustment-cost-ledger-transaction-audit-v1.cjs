const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';

const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001';
const API_BASE = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'adjustment-cost-ledger-transaction-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const prisma = new PrismaClient();

const report = {
  appUrl: APP_URL,
  databaseUrl: process.env.DATABASE_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
  findings: [],
  artifacts: {
    batchId: null,
    batchNo: `ADJ-TX-BATCH-${RUN_ID}`,
    adjustmentIds: [],
    ledgerIds: [],
  },
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function addFinding(entry) {
  report.findings.push({ at: new Date().toISOString(), ...entry });
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    recordStep({ step: name, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({
      step: name,
      result: 'failed',
      durationMs: Date.now() - started,
      timeoutMs,
      error: String(error.message || error),
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.data ? JSON.stringify(options.data) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message, evidence = {}) {
  if (!condition) {
    addFinding({ status: 'finding', message, evidence });
    throw new Error(message);
  }
}

function closeTo(actual, expected, tolerance = 0.000001) {
  return Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

async function loginAdmin() {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: 'admin', password: 'admin123' },
    timeoutMs: 10000,
  });
  assert(response.ok && response.json?.data?.token, 'admin login failed', {
    status: response.status,
    body: response.json,
  });
  return response.json.data;
}

async function seedBatch() {
  const batch = await prisma.productBatch.create({
    data: {
      batchNo: report.artifacts.batchNo,
      productName: `Adjustment Tx Resin ${RUN_ID}`,
      productionDate: new Date(),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      stockQuantity: 100,
      unit: 'kg',
      notes: `adjustment-cost-ledger-transaction-audit ${RUN_ID}`,
    },
  });
  report.artifacts.batchId = batch.id;
  return batch;
}

async function getBatch(batchId) {
  return prisma.productBatch.findUnique({
    where: { id: Number(batchId) },
    select: { id: true, batchNo: true, stockQuantity: true, unit: true },
  });
}

async function getLedgerByAdjustment(adjustmentId) {
  return prisma.inventoryCostLedger.findUnique({
    where: { adjustmentId: Number(adjustmentId) },
    select: {
      id: true,
      batchId: true,
      sourceType: true,
      sourceRef: true,
      adjustmentId: true,
      quantityBefore: true,
      quantityDelta: true,
      quantityAfter: true,
      costAmountDelta: true,
      createdBy: true,
    },
  });
}

async function createPostedInventoryAdjustment(token, batch) {
  const response = await apiFetch('/adjustments', {
    method: 'POST',
    data: {
      domain: 'inventory',
      targetType: 'productBatch',
      targetId: batch.id,
      batchId: batch.id,
      quantityDelta: -12,
      reason: `ADJ-TX-DECREASE-${RUN_ID}`,
      reasonCategory: 'inventory_discrepancy',
      lossType: 'count_difference',
      status: 'posted',
      note: `cost ledger transaction create ${RUN_ID}`,
    },
    timeoutMs: 15000,
  }, token);

  assert(response.status === 201 && response.json?.data?.adjustment?.id, 'posted inventory adjustment failed', {
    status: response.status,
    body: response.json,
  });
  const adjustmentId = Number(response.json.data.adjustment.id);
  report.artifacts.adjustmentIds.push(adjustmentId);
  return { response, adjustmentId };
}

async function reverseInventoryAdjustment(token, adjustmentId) {
  const response = await apiFetch(`/adjustments/${adjustmentId}/reverse`, {
    method: 'POST',
    data: { note: `cost ledger transaction reverse ${RUN_ID}` },
    timeoutMs: 15000,
  }, token);

  assert(response.ok && response.json?.data?.reverse?.id, 'inventory adjustment reverse failed', {
    status: response.status,
    body: response.json,
  });
  const reverseAdjustmentId = Number(response.json.data.reverse.id);
  report.artifacts.adjustmentIds.push(reverseAdjustmentId);
  return { response, reverseAdjustmentId };
}

async function assertCreateLedger(batchId, adjustmentId) {
  const batchAfterCreate = await getBatch(batchId);
  const ledger = await getLedgerByAdjustment(adjustmentId);
  assert(batchAfterCreate && closeTo(batchAfterCreate.stockQuantity, 88), 'batch quantity after posted adjustment is wrong', {
    batchAfterCreate,
  });
  assert(ledger, 'inventory cost ledger missing after posted adjustment', { adjustmentId });
  report.artifacts.ledgerIds.push(ledger.id);
  assert(ledger.batchId === batchId, 'posted adjustment ledger points to wrong batch', { ledger, batchId });
  assert(ledger.sourceType === 'inventory_adjustment', 'posted adjustment ledger sourceType is wrong', { ledger });
  assert(ledger.adjustmentId === adjustmentId, 'posted adjustment ledger points to wrong adjustment', { ledger, adjustmentId });
  assert(closeTo(ledger.quantityBefore, 100), 'posted adjustment ledger quantityBefore is wrong', { ledger });
  assert(closeTo(ledger.quantityDelta, -12), 'posted adjustment ledger quantityDelta is wrong', { ledger });
  assert(closeTo(ledger.quantityAfter, 88), 'posted adjustment ledger quantityAfter is wrong', { ledger });
  return { batchAfterCreate, ledger };
}

async function assertReverseLedger(batchId, reverseAdjustmentId) {
  const batchAfterReverse = await getBatch(batchId);
  const ledger = await getLedgerByAdjustment(reverseAdjustmentId);
  assert(batchAfterReverse && closeTo(batchAfterReverse.stockQuantity, 100), 'batch quantity after reverse is wrong', {
    batchAfterReverse,
  });
  assert(ledger, 'inventory cost ledger missing after reverse adjustment', { reverseAdjustmentId });
  report.artifacts.ledgerIds.push(ledger.id);
  assert(ledger.batchId === batchId, 'reverse ledger points to wrong batch', { ledger, batchId });
  assert(ledger.sourceType === 'inventory_reversal', 'reverse ledger sourceType is wrong', { ledger });
  assert(ledger.adjustmentId === reverseAdjustmentId, 'reverse ledger points to wrong adjustment', { ledger, reverseAdjustmentId });
  assert(closeTo(ledger.quantityBefore, 88), 'reverse ledger quantityBefore is wrong', { ledger });
  assert(closeTo(ledger.quantityDelta, 12), 'reverse ledger quantityDelta is wrong', { ledger });
  assert(closeTo(ledger.quantityAfter, 100), 'reverse ledger quantityAfter is wrong', { ledger });
  return { batchAfterReverse, ledger };
}

async function cleanupArtifacts() {
  const adjustmentIds = [...new Set(report.artifacts.adjustmentIds.filter(Boolean).map(Number))];
  const batchId = report.artifacts.batchId ? Number(report.artifacts.batchId) : null;

  await prisma.$transaction(async tx => {
    if (adjustmentIds.length > 0) {
      await tx.inventoryCostLedger.deleteMany({ where: { adjustmentId: { in: adjustmentIds } } });
      await tx.adjustmentRecord.deleteMany({ where: { id: { in: adjustmentIds } } });
    }
    if (batchId) {
      await tx.inventoryCostLedger.deleteMany({ where: { batchId } });
      await tx.productBatch.deleteMany({ where: { id: batchId, batchNo: report.artifacts.batchNo } });
    }
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let cleanupResult = 'not-started';
  try {
    const admin = await withTimeout('login-admin', 15000, loginAdmin);
    const batch = await withTimeout('seed-product-batch', 15000, seedBatch);
    await withTimeout('create-posted-inventory-adjustment', 20000, async () => {
      const { adjustmentId } = await createPostedInventoryAdjustment(admin.token, batch);
      const evidence = await assertCreateLedger(batch.id, adjustmentId);
      recordStep({
        step: 'posted-adjustment-ledger-readback',
        result: 'passed',
        adjustmentId,
        batchQuantity: Number(evidence.batchAfterCreate.stockQuantity),
        ledgerId: evidence.ledger.id,
        sourceType: evidence.ledger.sourceType,
      });
    });
    await withTimeout('reverse-inventory-adjustment', 20000, async () => {
      const originalAdjustmentId = report.artifacts.adjustmentIds[0];
      const { reverseAdjustmentId } = await reverseInventoryAdjustment(admin.token, originalAdjustmentId);
      const evidence = await assertReverseLedger(batch.id, reverseAdjustmentId);
      recordStep({
        step: 'reverse-adjustment-ledger-readback',
        result: 'passed',
        reverseAdjustmentId,
        batchQuantity: Number(evidence.batchAfterReverse.stockQuantity),
        ledgerId: evidence.ledger.id,
        sourceType: evidence.ledger.sourceType,
      });
    });
    await withTimeout('cleanup-own-artifacts', 20000, async () => {
      await cleanupArtifacts();
      cleanupResult = 'passed';
    });
    report.status = report.findings.length === 0 ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    try {
      await cleanupArtifacts();
      cleanupResult = 'passed-after-failure';
    } catch (cleanupError) {
      cleanupResult = 'failed';
      report.cleanupError = String(cleanupError.message || cleanupError);
    }
    process.exitCode = 1;
  } finally {
    report.cleanupResult = cleanupResult;
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    await prisma.$disconnect();
    console.log(JSON.stringify({
      status: report.status,
      runId: RUN_ID,
      steps: report.steps.length,
      findings: report.findings.length,
      cleanupResult,
      reportPath: REPORT_PATH,
      error: report.error || null,
      cleanupError: report.cleanupError || null,
    }, null, 2));
  }
}

main();
