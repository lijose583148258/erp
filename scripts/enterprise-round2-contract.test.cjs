const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('./config/enterprise-round2-v1.json');
const { validateCatalog, summarize, createRound2Runner, synchronizedBurst } = require('./lib/enterprise-round2-runner.cjs');

test('20 positions, 12 chains and unique obligations are frozen', () => {
  assert(validateCatalog(catalog).length >= 24);
  assert.throws(() => validateCatalog({ ...catalog, chains: catalog.chains.slice(1) }));
  const duplicated = structuredClone(catalog);
  duplicated.chains[1].checks.push(duplicated.chains[0].checks[0]);
  assert.throws(() => validateCatalog(duplicated), /Duplicate/);
});

test('presales are allowed without negative physical stock; barter remains mandatory', () => {
  assert.equal(catalog.businessPolicy.salesOverbooking, 'allowed_with_traceable_fulfillment_plan');
  assert.equal(catalog.businessPolicy.physicalStock, 'never_negative');
  const ids = validateCatalog(catalog);
  for (const id of ['presale-with-fulfillment-plan', 'backorder-adjustment-closeout', 'barter-dual-stock-posting-replay', 'barter-offset-cash-difference', 'barter-reversal-conservation']) {
    assert(ids.includes(id), `Missing obligation: ${id}`);
  }
});

test('partial, missing, blocked, unsupported and running checks cannot make a chain green', () => {
  for (const status of ['not_run', 'blocked', 'unsupported', 'running']) {
    const checks = validateCatalog(catalog).map(id => ({ id, status: 'passed' }));
    checks[0].status = status;
    assert.equal(summarize({ checks }, catalog).status, 'incomplete');
    checks.shift();
    assert.equal(summarize({ checks }, catalog).status, 'incomplete');
  }
});

test('only complete fixed-ID evidence can pass, duplicate and unknown IDs fail', () => {
  const checks = validateCatalog(catalog).map(id => ({ id, status: 'passed' }));
  assert.equal(summarize({ checks }, catalog).passedChains, 12);
  assert.throws(() => summarize({ checks: [...checks, checks[0]] }, catalog));
  assert.throws(() => summarize({ checks: [...checks, { id: 'unknown', status: 'passed' }] }, catalog));
});

test('failure and timeout persist without truncating independent checks', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'round2-contract-'));
  const reportPath = path.join(folder, 'report.json');
  const runner = createRound2Runner({ catalog, reportPath });
  await runner.run('stock-20-contention', async () => { throw new Error('injected failure'); });
  await runner.run('payment-duplicate-verification', async signal => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ late: true }), { once: true });
  }), { timeoutMs: 20 });
  await runner.run('transfer-shipping-contention', async () => ({ persistedStock: 40 }));
  const report = runner.finish();
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.failedChecks, 2);
  assert.equal(report.summary.passedChecks, 1);
  assert.equal(JSON.parse(fs.readFileSync(reportPath)).summary.passedChecks, 1);
  assert(path.resolve(folder).startsWith(`${path.resolve(os.tmpdir())}${path.sep}round2-contract-`), 'Cleanup must remain in the generated test directory');
  fs.rmSync(folder, { recursive: true });
});

test('barrier launches distinct actors together and retains each outcome', async () => {
  const actors = Array.from({ length: 20 }, (_, id) => ({ id }));
  const result = await synchronizedBurst(actors, async actor => ({ status: actor.id === 19 ? 409 : 201 }));
  assert.equal(result.length, 20);
  assert.equal(result.filter(row => row.status === 409).length, 1);
  assert(result.every(row => row.finishedMs >= row.startedMs));
  await assert.rejects(synchronizedBurst([{ id: 1 }, { id: 1 }], async () => ({})), /Distinct/);
});

test('requested cloud Round2 is mandatory even when continue-on-error makes its conclusion green', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  const baselineIds = [...source.matchAll(/\['([a-z0-9_]+)',/g)].map(match => match[1]).filter(id => id !== 'round2_business');
  for (const requested of [false, true]) {
    let report;
    let exitCode = 0;
    const steps = Object.fromEntries(baselineIds.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
    steps.round2_business = { outcome: 'failure', conclusion: 'success' };
    vm.runInNewContext(source, {
      require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync(_path, data) { report = JSON.parse(data); } } : require(name),
      process: { env: { BUSINESS_AUDIT_STEPS_JSON: JSON.stringify(steps), ROUND2_REQUESTED: String(requested) }, exit(code) { exitCode = code; } },
      console: { log() {}, error() {} },
    });
    assert.equal(report.status, requested ? 'failed' : 'passed');
    assert.equal(exitCode, requested ? 1 : 0);
  }
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /id: round2_business[\s\S]{0,150}always\(\)[\s\S]{0,150}continue-on-error: true/);
  assert.match(workflow, /ROUND2_REQUESTED: \$\{\{ inputs.round2 \|\| false \}\}/);
});
