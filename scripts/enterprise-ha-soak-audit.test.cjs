const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'enterprise-ha-soak-audit-v1.cjs'), 'utf8');

async function simulate({ suspend = false, restart = false, businessStatus = 200, duration = '30000' } = {}) {
  let wall = Date.parse('2026-10-24T00:00:00Z');
  let monotonic = 0;
  let requests = 0;
  let metricRequests = 0;
  const files = new Map();
  const writes = [];
  const fakeProcess = { cwd: () => __dirname, env: { HA_SOAK_DURATION_MS: duration, HA_SOAK_CONCURRENCY: '1', GITHUB_SHA: 'synthetic-test-only' }, exitCode: 0 };
  const fakeFs = { mkdirSync() {}, writeFileSync(file, text) { files.set(file, text); writes.push(JSON.parse(text)); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); } };
  const fakeFetch = async url => {
    if (url.endsWith('/api/auth/login')) return { ok: true, json: async () => ({ data: { token: 'synthetic-token' } }) };
    if (url.endsWith('/metrics')) {
      metricRequests += 1;
      const startedAt = restart && metricRequests > 2 ? 200 : 100;
      return { text: async () => `ailaoda_process_resident_memory_bytes 104857600\nailaoda_process_heap_used_bytes 20971520\nailaoda_process_started_at_seconds ${startedAt}\n` };
    }
    requests += 1;
    if (suspend && requests === 10) { wall += 120000; monotonic += 120000; }
    return { status: businessStatus, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const fakeDate = class extends Date { constructor(value) { super(value === undefined ? wall : value); } static now() { return wall; } };
  await vm.runInNewContext(source, { require: name => name === 'fs' ? fakeFs : name === 'path' ? path :
    name === './lib/ui-audit-user.cjs' ? { ensureUiAuditUser: async () => ({ username: 'synthetic', password: 'not-real' }) } : null,
    process: fakeProcess, Date: fakeDate, performance: { now: () => monotonic }, fetch: fakeFetch,
    AbortSignal: { timeout: () => undefined }, console: { log() {} },
    setTimeout(callback, milliseconds) { wall += milliseconds; monotonic += milliseconds; queueMicrotask(callback); } });
  return { report: writes.at(-1), writes, exitCode: fakeProcess.exitCode };
}

test('soak writes running checkpoints and only passes a complete uninterrupted lifetime', async () => {
  const { report, writes, exitCode } = await simulate();
  assert.equal(writes[0].status, 'running');
  assert(writes.some(row => row.status === 'running' && row.progress?.requests > 0));
  assert.equal(report.status, 'passed');
  assert(report.observedDurationMs >= 30000);
  assert.equal(exitCode, 0);
});

test('suspended time cannot silently count as continuous observation', async () => {
  const { report, exitCode } = await simulate({ suspend: true });
  assert.equal(report.status, 'failed');
  assert(report.checks.some(row => row.name === 'uninterrupted-sampling' && row.status === 'failed'));
  assert.equal(exitCode, 1);
});

test('a replaced application process cannot reuse the prior observation window', async () => {
  const { report, exitCode } = await simulate({ restart: true });
  assert.equal(report.status, 'failed');
  assert(report.checks.some(row => row.name === 'same-process-lifetime' && row.status === 'failed'));
  assert.equal(exitCode, 1);
});

test('authentication failure remains a failed soak despite otherwise healthy metrics', async () => {
  const { report, exitCode } = await simulate({ businessStatus: 401 });
  assert.equal(report.status, 'failed');
  assert(report.checks.some(row => row.name === 'all-requests-succeeded' && row.status === 'failed'));
  assert.equal(exitCode, 1);
});

test('invalid observation duration is rejected before any run', async () => {
  await assert.rejects(simulate({ duration: 'not-a-duration' }), /Invalid soak duration/);
});
