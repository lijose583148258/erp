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

test('actual workflow shell runs all nine human audits under Actions bash -e after failures', () => {
  const { spawnSync } = require('node:child_process');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  const section = workflow.split('      - name: Simulate human ERP workflows')[1].split('\n      - name:')[0];
  const script = section.split('        run: |')[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  for (const failAt of [1, 7, 9]) {
    // Only substitute business commands, not run_audit or the workflow's shell options.
    const stub = `calls=0
npm() { calls=$((calls+1)); echo "EXECUTED:$calls:$*"; if (( calls == ${failAt} )); then return 23; fi; }
env() { while [[ "$1" == *=* ]]; do shift; done; "$@"; }
export DATABASE_URL=fixture
`;
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', stub + script], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.equal((result.stdout.match(/^EXECUTED:/gm) || []).length, 9, result.stdout);
    assert.match(result.stdout, /EXECUTED:8:run audit:collection:human-flow/);
    assert.match(result.stdout, /Human ERP workflow failures: .*:23/);
  }
});

test('font preparation failure remains fatal only at the final aggregate even with a green conclusion', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  const ids = [...source.matchAll(/\['([a-z0-9_]+)',/g)].map(match => match[1]).filter(id => id !== 'round2_business');
  assert(ids.includes('browser_fonts'));
  for (const outcome of ['failure', 'skipped', 'cancelled', 'success']) {
    const steps = Object.fromEntries(ids.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
    steps.browser_fonts = { outcome, conclusion: 'success' };
    let report; let exitCode = 0;
    vm.runInNewContext(source, {
      require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync(_path, data) { report = JSON.parse(data); } } : require(name),
      process: { env: { BUSINESS_AUDIT_STEPS_JSON: JSON.stringify(steps) }, exit(code) { exitCode = code; } },
      console: { log() {}, error() {} },
    });
    assert.equal(report.summary.expected, ids.length);
    assert.equal(report.summary.failed, outcome === 'success' ? 0 : 1);
    assert.equal(exitCode, outcome === 'success' ? 0 : 1);
    assert.equal(report.audits.filter(item => item.id !== 'browser_fonts').every(item => item.status === 'passed'), true);
  }
});

test('partial fulfillment audit is independent and fatal at aggregation, without claiming the 37 obligations', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  const ids = [...source.matchAll(/\['([a-z0-9_]+)',/g)].map(match => match[1]).filter(id => id !== 'round2_business');
  assert(ids.includes('sales_partial_fulfillment'));
  for (const outcome of ['failure', 'skipped', 'cancelled', 'success']) {
    const steps = Object.fromEntries(ids.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
    steps.sales_partial_fulfillment = { outcome, conclusion: 'success' };
    let report; let exitCode = 0;
    vm.runInNewContext(source, {
      require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync(_path, data) { report = JSON.parse(data); } } : require(name),
      process: { env: { BUSINESS_AUDIT_STEPS_JSON: JSON.stringify(steps) }, exit(code) { exitCode = code; } },
      console: { log() {}, error() {} },
    });
    assert.equal(exitCode, outcome === 'success' ? 0 : 1);
    assert.equal(report.summary.failed, outcome === 'success' ? 0 : 1);
  }
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /id: sales_partial_fulfillment[\s\S]{0,170}always\(\)[\s\S]{0,160}continue-on-error: true/);
  assert.match(workflow, /run: node \.\/scripts\/sales-partial-fulfillment-audit-v1.cjs/);
  assert.equal(validateCatalog(catalog).length, 37);
});

const { createShippingAuditData } = require('./lib/shipping-browser-audit-fixtures.cjs');
const { createLinkedShipment, seedShipmentStock, verifyShippingIssue } = require('./lib/shipping-browser-data-helpers.cjs');
const fixtureOptions = () => ({
  data: { ...createShippingAuditData('contract'), materialId: 1 },
  report: { linkedShipment: { shipmentNo: 'SHP-contract' } },
  unwrapList: payload => payload.json.data,
  timebox: async (_page, _name, _timeout, action) => action(),
  timeouts: { api: 1000, readBack: 1000 },
});

function linkedFixtureOptions() {
  const options = fixtureOptions();
  options.report.order = { id: '7', customerId: '8' };
  const order = { id: 7, customerId: 8, items: [
    { id: 91, materialId: 1, productName: options.data.linkedProduct, quantity: 12, unit: ' KG ' },
    { id: 92, materialId: 2, productName: 'unrelated', quantity: 500, unit: 'kg' },
    { id: 93, materialId: 1, productName: 'different unit', quantity: 500, unit: 'L' },
  ] };
  const calls = [];
  options.apiFetch = async (_page, route, request) => {
    calls.push({ route, request });
    if (route === '/orders/7') return { ok: true, json: { data: order } };
    assert.equal(route, '/shipping');
    return { ok: true, json: { data: { id: 10, shipmentNo: 'SHP-contract', ...request.data } } };
  };
  return { options, order, calls };
}

test('shipping fixture binds a persisted material/unit line before POST, never a display-name guess', async () => {
  const { options, order, calls } = linkedFixtureOptions();
  options.data.linkedProduct = 'not the persisted canonical name';
  await createLinkedShipment(options);
  assert.deepEqual(calls.map(call => call.route), ['/orders/7', '/shipping']);
  const submitted = calls[1].request.data;
  assert.equal(submitted.orderItemId, 91);
  assert.equal(submitted.productName, order.items[0].productName);
  assert.equal(submitted.materialId, 1);
  assert.equal(submitted.quantity, 12);
  assert.equal(submitted.unit, 'kg');
  assert.equal(options.report.order.orderItemId, '91');
  assert.equal(options.report.linkedShipment.orderItemId, '91');
});

test('shipping fixture rejects absent, ambiguous, cross-unit and oversized lines without POST', async () => {
  const cases = [
    order => { order.items = []; },
    order => { order.items.push({ ...order.items[0], id: 94 }); },
    order => { delete order.items[0].id; },
    order => { order.items[0].materialId = null; },
    order => { order.items[0].unit = 'L'; },
    order => { order.items[0].quantity = 6; },
    order => { order.items[0].quantity = 'not a quantity'; },
    order => { order.customerId = 9; },
    order => { order.id = 9; },
    (_order, options) => { options.data.quantity = 0; },
    (_order, options) => { options.data.quantity = NaN; },
    (_order, options) => { options.data.quantity = 13; },
  ];
  for (const mutate of cases) {
    const { options, order, calls } = linkedFixtureOptions();
    mutate(order, options);
    await assert.rejects(createLinkedShipment(options), /shipping (fixture|order line readback)/);
    assert.deepEqual(calls.map(call => call.route), ['/orders/7']);
  }
});

test('shipping fixture rejects failed order readback and missing persisted shipment linkage', async () => {
  const failedRead = linkedFixtureOptions();
  failedRead.options.apiFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(createLinkedShipment(failedRead.options), /line readback failed: 503/);
  const missingLink = linkedFixtureOptions();
  const originalFetch = missingLink.options.apiFetch;
  missingLink.options.apiFetch = async (...args) => {
    const result = await originalFetch(...args);
    if (args[1] === '/shipping') delete result.json.data.orderItemId;
    return result;
  };
  await assert.rejects(createLinkedShipment(missingLink.options), /did not preserve/);
  assert.equal(missingLink.options.report.order.orderItemId, undefined);
});

test('shipping browser fixture seeds explicit carrying cost through the stock API', async () => {
  const options = fixtureOptions();
  let seeded;
  options.apiFetch = async (_page, route, request) => {
    if (route === '/warehouses') return { ok: true, json: { data: [{ locations: [{ id: 2, code: 'LOC-FG' }] }] } };
    assert.equal(route, '/warehouses/stock-balances');
    seeded = request.data;
    return { ok: true };
  };
  await seedShipmentStock(options);
  assert.equal(seeded.unitCost, 10);
  assert.equal(options.report.seededStock.costAmount, 240);
  options.data.unitCost = undefined;
  await assert.rejects(seedShipmentStock(options), /explicit nonnegative unitCost/);
});

test('shipping browser readback rejects quantity-only and duplicate cost evidence', async () => {
  const options = fixtureOptions();
  const { data } = options;
  const batch = { id: 9, productName: data.linkedProduct, batchNo: data.batchNo, stockQuantity: 12 };
  const costRow = { sourceRef: 'STK-contract', quantityDelta: -12, costAmountDelta: -120 };
  const ledger = { summary: { totalQuantityDelta: 12, currentQuantity: 12, currentCostAmount: 120 }, items: [costRow] };
  options.apiFetch = async (_page, route) => {
    let result;
    if (route.startsWith('/warehouses/stock-balances?')) result = [{ ...batch, locationCode: 'LOC-FG', quantity: 12 }];
    else if (route.startsWith('/warehouses/stock-entries?')) result = [{ sourceType: 'shipping_issue', sourceRef: 'SHP-contract', entryNo: 'STK-contract', movements: [{ ...batch, quantityDelta: -12 }] }];
    else if (route.startsWith('/assets/batches?')) result = [batch];
    else if (route === '/production/batches/9/cost-ledger?pageSize=100') result = ledger;
    else throw new Error(`Unexpected route ${route}`);
    return { ok: true, json: { data: result } };
  };
  await verifyShippingIssue(options);
  assert.equal(options.report.issueEvidence.costAmount, 120);
  ledger.summary.currentCostAmount = 240;
  await assert.rejects(verifyShippingIssue(options), /cost conservation mismatch/);
  ledger.summary.currentCostAmount = 120;
  batch.stockQuantity = 24;
  await assert.rejects(verifyShippingIssue(options), /batch quantity mismatch/);
  batch.stockQuantity = 12;
  ledger.items.push(costRow);
  await assert.rejects(verifyShippingIssue(options), /exactly one matching issue/);
});

test('PO revisions have additive database upgrade paths and explicit cloud browser coverage', () => {
  const root = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(root, 'backend/prisma/models/procurement.prisma'), 'utf8');
  const repair = fs.readFileSync(path.join(root, 'backend/src/database/runtime-schema-core-repair.ts'), 'utf8');
  const { loadMigrations } = require('./postgres-schema-migrate-v1.cjs');
  const upgrade = loadMigrations().find(item => item.id === '202609250001_purchase-order-revision');
  assert.match(schema, /revision\s+Int\s+@default\(0\)/);
  assert.match(repair, /'purchase_orders', 'revision', 'INTEGER NOT NULL DEFAULT 0'/);
  assert.match(upgrade.sql, /ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(upgrade.sql, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /id: round2_business[\s\S]{0,350}ROUND2_BROWSER: "true"/);
});

test('CJK raster evidence rejects tofu/blank glyphs even when DOM Chinese text is correct', () => {
  const { assertCjkRasterEvidence } = require('./lib/browser-cjk-font-guard.cjs');
  const glyphs = Array.from('采购版本变更数量审批').map((character, index) => ({ character, signature: `glyph-${index}`, inkPixels: 100 }));
  const evidence = { missingSignatures: ['tofu', 'tofu-other'], glyphs };
  assert.equal(assertCjkRasterEvidence(evidence), evidence);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, glyphs: glyphs.map(glyph => ({ ...glyph, signature: 'tofu' })) }), /missing-glyph/);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, glyphs: glyphs.map(glyph => ({ ...glyph, signature: 'same' })) }), /identical glyphs/);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, glyphs: glyphs.map(glyph => ({ ...glyph, inkPixels: 0 })) }), /blank/);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, missingSignatures: [] }), /reference signatures/);
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /apt-get install[^\n]*fonts-noto-cjk/);
  assert.match(workflow, /id: browser_fonts\s+continue-on-error: true/);
  assert.match(fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8'), /\['browser_fonts',/);
});
