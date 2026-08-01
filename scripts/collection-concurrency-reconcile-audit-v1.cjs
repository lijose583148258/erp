const path = require('path');
const { createAuditRuntime, ensureDir } = require('./lib/audit-runtime-utils.cjs');
const { loginAdmin, seedBusinessChain } = require('./lib/collection-human-flow-seed.cjs');
const { applyAuditDatabaseContext } = require('./lib/audit-runtime-context.cjs');
const { ensureUiAuditAccounts } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'collection-concurrency-reconcile-audit-report-v1.json');
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const STEP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
applyAuditDatabaseContext(process.env);
const { PrismaClient } = require(path.join(process.cwd(), 'backend', 'node_modules', '@prisma', 'client'));

const report = {
  name: 'collection-concurrency-reconcile-audit-v1',
  appUrl: APP_URL,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  findings: [],
  seeded: {},
};
const runtime = createAuditRuntime({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  report,
  reportPath: REPORT_PATH,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

const testData = {
  customerNameZh: `CC-${RUN_ID}-客户`,
  customerNameEn: `CC-${RUN_ID} Customer`,
  customerNameVi: `CC-${RUN_ID} Khách hàng`,
  productName: `CC-${RUN_ID}-胶水`,
  paymentNote: `CC-PAY-${RUN_ID}`,
  promiseNote: `CC-PROMISE-${RUN_ID}`,
  disputeNote: `CC-DISPUTE-${RUN_ID}`,
  holdReason: `CC-HOLD-${RUN_ID}`,
  promiseAmount: 321.45,
};

function summarizeStatuses(results) {
  return results.map((item) => item.status);
}

function successCount(results) {
  return results.filter((item) => item.status >= 200 && item.status < 300).length;
}

async function postPromise(token, seed) {
  const response = await runtime.apiFetch('/collections/promises', {
    method: 'POST',
    data: {
      customerId: seed.customer.id,
      orderId: seed.order.id,
      promisedAmount: testData.promiseAmount,
      promisedAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      channel: 'phone',
      note: testData.promiseNote,
    },
  }, token);
  runtime.expectStatus(response, [201], 'create race promise');
  return runtime.dataOf(response);
}

async function postDispute(token, seed) {
  const response = await runtime.apiFetch('/collections/disputes', {
    method: 'POST',
    data: {
      customerId: seed.customer.id,
      orderId: seed.order.id,
      disputedAmount: 99,
      reasonCategory: 'billing',
      reason: `race-dispute-${RUN_ID}`,
      note: testData.disputeNote,
    },
  }, token);
  runtime.expectStatus(response, [201], 'create race dispute');
  return runtime.dataOf(response);
}

async function auditConcurrentSync(token) {
  await runtime.withTimeout('collection-concurrent-sync-overdue', STEP_TIMEOUT_MS, async () => {
    const started = Date.now();
    const results = await Promise.all(Array.from({ length: 6 }, () => runtime.apiFetch('/collections/sync-overdue', { method: 'POST' }, token)));
    const statuses = summarizeStatuses(results);
    runtime.expect(statuses.every((status) => status === 200), 'concurrent sync-overdue returned non-200', statuses);
    const updatedCounts = results.map((item) => Number(runtime.dataOf(item)?.updatedCustomers || 0));
    runtime.expect(updatedCounts.every((count) => count > 0), 'concurrent sync-overdue returned empty updated count', updatedCounts);
    report.steps.push({
      at: new Date().toISOString(),
      step: 'collection-concurrent-sync-overdue-evidence',
      result: 'passed',
      durationMs: Date.now() - started,
      statuses,
      updatedCounts,
    });
  });
}

async function auditConcurrentVerify(token, seed) {
  await runtime.withTimeout('collection-concurrent-payment-verify', STEP_TIMEOUT_MS, async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => (
      runtime.apiFetch(`/collections/payments/${seed.paymentId}/verify`, { method: 'POST' }, token)
    )));
    const statuses = summarizeStatuses(results);
    runtime.expect(statuses.every((status) => status === 200), 'concurrent payment verify returned non-200', statuses);

    const orderResponse = await runtime.apiFetch(`/orders/${seed.order.id}`, {}, token);
    runtime.expectStatus(orderResponse, [200], 'order readback after concurrent verify');
    const order = runtime.dataOf(orderResponse);
    const matchingPayments = (order.paymentRecords || []).filter((record) => String(record.note || '').includes(testData.paymentNote));
    runtime.expect(matchingPayments.length === 1, 'payment record count drift after concurrent verify', matchingPayments);
    runtime.expect(matchingPayments[0].status === 'verified', 'payment not verified after concurrent verify', matchingPayments[0]);
    runtime.expect(Math.abs(Number(order.paidAmount || 0) - 100) < 0.01, 'paidAmount drift after concurrent verify', order);
    runtime.expect(['partial', 'paid'].includes(String(order.paymentStatus)), 'paymentStatus not updated after concurrent verify', order);

    report.steps.push({
      at: new Date().toISOString(),
      step: 'collection-concurrent-payment-verify-evidence',
      result: 'passed',
      statuses,
      paidAmount: order.paidAmount,
      paymentStatus: order.paymentStatus,
      paymentRecordId: matchingPayments[0].id,
    });
  });
}

async function auditCollectionAmountGuards(token, seed) {
  await runtime.withTimeout('collection-promise-dispute-amount-guards', STEP_TIMEOUT_MS, async () => {
    const excessivePromiseNote = `${testData.promiseNote}-OVER`;
    const excessiveDisputeNote = `${testData.disputeNote}-OVER`;
    const promiseResponse = await runtime.apiFetch('/collections/promises', {
      method: 'POST',
      data: {
        customerId: seed.customer.id,
        orderId: seed.order.id,
        promisedAmount: 999999,
        promisedAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        channel: 'phone',
        note: excessivePromiseNote,
      },
    }, token);
    runtime.expectStatus(promiseResponse, [409], 'promise amount guard');

    const disputeResponse = await runtime.apiFetch('/collections/disputes', {
      method: 'POST',
      data: {
        customerId: seed.customer.id,
        orderId: seed.order.id,
        disputedAmount: 999999,
        reasonCategory: 'billing',
        reason: `over-dispute-${RUN_ID}`,
        note: excessiveDisputeNote,
      },
    }, token);
    runtime.expectStatus(disputeResponse, [409], 'dispute amount guard');

    const [promises, disputes] = await Promise.all([
      runtime.apiFetch('/collections/promises', {}, token),
      runtime.apiFetch('/collections/disputes', {}, token),
    ]);
    runtime.expectStatus(promises, [200], 'promise readback after amount guard');
    runtime.expectStatus(disputes, [200], 'dispute readback after amount guard');
    const createdPromise = runtime.listOf(promises).find((row) => String(row.note || '').includes(excessivePromiseNote));
    const createdDispute = runtime.listOf(disputes).find((row) => String(row.note || '').includes(excessiveDisputeNote));
    runtime.expect(!createdPromise, 'excessive promise should not be created', createdPromise);
    runtime.expect(!createdDispute, 'excessive dispute should not be created', createdDispute);

    report.steps.push({
      at: new Date().toISOString(),
      step: 'collection-promise-dispute-amount-guards-evidence',
      result: 'passed',
      promiseStatus: promiseResponse.status,
      disputeStatus: disputeResponse.status,
      orderId: seed.order.id,
    });
  });
}

async function auditPromiseTerminalRace(token, seed) {
  await runtime.withTimeout('collection-promise-terminal-race', STEP_TIMEOUT_MS, async () => {
    const promise = await postPromise(token, seed);
    const results = await Promise.all(['kept', 'missed', 'cancelled'].map((status) => (
      runtime.apiFetch(`/collections/promises/${promise.id}/status`, { method: 'PATCH', data: { status } }, token)
    )));
    const statuses = summarizeStatuses(results);
    const okCount = successCount(results);
    const readback = await runtime.apiFetch('/collections/promises', {}, token);
    runtime.expectStatus(readback, [200], 'promise readback after terminal race');
    const row = runtime.listOf(readback).find((item) => Number(item.id) === Number(promise.id));
    runtime.expect(Boolean(row), 'promise missing after terminal race', readback.json);
    runtime.expect(okCount === 1, 'promise terminal race accepted more than one winning transition', { statuses, row });
    runtime.expect(['kept', 'missed', 'cancelled'].includes(String(row.status)), 'promise terminal race ended in invalid status', row);
    report.steps.push({
      at: new Date().toISOString(),
      step: 'collection-promise-terminal-race-evidence',
      result: 'passed',
      promiseId: promise.id,
      statuses,
      finalStatus: row.status,
    });
  });
}

async function auditDisputeTerminalRace(token, seed) {
  await runtime.withTimeout('collection-dispute-terminal-race', STEP_TIMEOUT_MS, async () => {
    const dispute = await postDispute(token, seed);
    const results = await Promise.all(['resolved', 'rejected', 'withdrawn'].map((status) => (
      runtime.apiFetch(`/collections/disputes/${dispute.id}/status`, { method: 'PATCH', data: { status } }, token)
    )));
    const statuses = summarizeStatuses(results);
    const okCount = successCount(results);
    const readback = await runtime.apiFetch('/collections/disputes', {}, token);
    runtime.expectStatus(readback, [200], 'dispute readback after terminal race');
    const row = runtime.listOf(readback).find((item) => Number(item.id) === Number(dispute.id));
    runtime.expect(Boolean(row), 'dispute missing after terminal race', readback.json);
    runtime.expect(okCount === 1, 'dispute terminal race accepted more than one winning transition', { statuses, row });
    runtime.expect(['resolved', 'rejected', 'withdrawn'].includes(String(row.status)), 'dispute terminal race ended in invalid status', row);
    report.steps.push({
      at: new Date().toISOString(),
      step: 'collection-dispute-terminal-race-evidence',
      result: 'passed',
      disputeId: dispute.id,
      statuses,
      finalStatus: row.status,
    });
  });
}

async function main() {
  ensureDir(OUTPUT_DIR);
  const prisma = new PrismaClient();
  try {
    const accounts = await ensureUiAuditAccounts('collection_concurrency', ['admin']);
    const admin = await loginAdmin(runtime, { admin: accounts.admin, stepTimeoutMs: STEP_TIMEOUT_MS });
    const seed = await seedBusinessChain(runtime, { token: admin.token, prisma, runId: RUN_ID, testData, report, stepTimeoutMs: STEP_TIMEOUT_MS });
    report.seeded = { ...report.seeded, orderId: seed.order.id, paymentId: seed.paymentId };
    await auditConcurrentSync(admin.token);
    await auditConcurrentVerify(admin.token, seed);
    await auditCollectionAmountGuards(admin.token, seed);
    await auditPromiseTerminalRace(admin.token, seed);
    await auditDisputeTerminalRace(admin.token, seed);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.message || error);
    report.details = error?.details || null;
    report.stack = error?.stack || null;
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
    await runtime.saveReport();
    console.log(JSON.stringify({ status: report.status, reportPath: REPORT_PATH, error: report.error || null }, null, 2));
  }
}

main();
