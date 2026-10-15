const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRound2Supervisor, ROUND2_MAX_RUNTIME_MS, ROUND2_PARENT_RUNTIME_MS } = require('./lib/enterprise-round2-supervision.cjs');
const catalog = require('./config/enterprise-round2-v1.json');
const report = () => ({ checks: catalog.chains.flatMap(chain => chain.checks).map(id => ({ id, status: 'not_run' })) });
test('real case transitions permit the growing full suite beyond the old 420s without raising per-case timeouts', () => {
  const inspect = createRound2Supervisor(0), r = report();
  for (let i = 0; i < 32; i++) {
    const start = i * 20_000; Object.assign(r.checks[i], { status: 'running', timeoutMs: 180_000, startedAt: String(i) });
    assert.equal(inspect(r, start), null); r.checks[i].status = 'passed'; r.checks[i].finishedAt = String(i); assert.equal(inspect(r, start + 19_000), null);
  }
  r.finishedAt = 'complete'; assert.equal(inspect(r, 640_000), null);
});
test('log/JSON heartbeats cannot extend a stuck case beyond its own budget', () => {
  const inspect = createRound2Supervisor(0), r = report(); Object.assign(r.checks[0], { status: 'running', timeoutMs: 30_000 });
  assert.equal(inspect(r, 0), null); r.heartbeat = 40_000; r.checks[0].startedAt = 'rewritten';
  assert.match(inspect(r, 45_000), /^round2-check-deadline:/);
});

test('the existing 240s payment reversal deadline is not shortened by the outer supervisor', () => {
  const inspect = createRound2Supervisor(0), r = report();
  Object.assign(r.checks[0], { status: 'running', timeoutMs: 240_000 });
  assert.equal(inspect(r, 0), null); assert.equal(inspect(r, 195_000), null);
  assert.equal(inspect(r, 254_999), null); assert.match(inspect(r, 255_000), /^round2-check-deadline:/);
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'enterprise-round2-audit-v1.cjs'), 'utf8');
  for (const match of source.matchAll(/timeoutMs:\s*(\d+)/g)) assert(Number(match[1]) <= 240_000, 'A new longer case needs explicit supervisor review');
});
test('missing/corrupt report and an inter-case stall remain bounded', () => {
  assert.equal(createRound2Supervisor(0)(null, 90_000), 'round2-no-case-progress');
  const inspect = createRound2Supervisor(0), r = report(); assert.equal(inspect(r, 0), null);
  assert.equal(inspect({ checks: [] }, 90_000), 'round2-no-case-progress');
});
test('an exited report cannot hide a wedged process, or reset the absolute deadline', () => {
  const inspect = createRound2Supervisor(0), r = report(); r.finishedAt = 'done';
  assert.equal(inspect(r, 1), null); assert.equal(inspect(r, 10_001), 'round2-process-did-not-exit');
  assert.equal(inspect(r, ROUND2_MAX_RUNTIME_MS), 'round2-overall-deadline');
  assert(ROUND2_PARENT_RUNTIME_MS > ROUND2_MAX_RUNTIME_MS);
});
test('multiple simultaneous audit cases are not accepted as serial progress', () => {
  const r = report(); r.checks[0].status = r.checks[1].status = 'running';
  assert.equal(createRound2Supervisor(0)(r, 0), 'round2-multiple-active-checks');
});
test('cloud and local wrap the same fixed37 audit with bounded external supervision', () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '..');
  const local = fs.readFileSync(path.join(__dirname, 'enterprise-round2-local-v1.cjs'), 'utf8');
  assert.match(local, /ROUND2_PARENT_RUNTIME_MS/); assert.doesNotMatch(local, /420000/);
  assert.match(require('../package.json').scripts['audit:enterprise:round2'], /enterprise-round2-supervised/);
  const wrapper = fs.readFileSync(path.join(__dirname, 'enterprise-round2-supervised.cjs'), 'utf8');
  assert.match(wrapper, /report\.metadata\?\.supervisionKey === key/);
  assert.match(wrapper, /message\.key === key/); assert.match(wrapper, /inspect\(progress, performance\.now\(\)\)/);
  assert.doesNotMatch(wrapper, /inspect\(read\(\)/);
  assert.match(local, /await killSpawnedProcessTree\(child\.pid\)/);
  assert.match(local, /Promise\.allSettled\(owned\.map\(stopOwned\)\)/);
  assert.match(wrapper, /killSpawnedProcessTree\(child\.pid\)/);
  assert.match(wrapper, /!report\?\.finishedAt/); assert.doesNotMatch(wrapper, /report\.finishedAt\s*=/);
  const cloud = fs.readFileSync(path.join(root, '.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(cloud, /id: round2_business[\s\S]*?timeout-minutes: 16/);
});

const { publishRound2Report } = require('./lib/enterprise-round2-runner.cjs');

test('native report publication repeatedly replaces an existing complete report with exact complete bytes', () => {
  const fs = require('node:fs'), path = require('node:path');
  const file = path.join(__dirname, '../output/review/purchase-quality-payables', `publication-native-${process.pid}.json`);
  try {
    for (let i = 0; i < 40; i++) {
      const actual = { revision: i, finishedAt: new Date().toISOString(), facts: ['实收应付', i] };
      publishRound2Report(file, actual);
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), actual);
      assert.equal(fs.existsSync(`${file}.${process.pid}.tmp`), false);
    }
  } finally {
    for (const owned of [file, `${file}.${process.pid}.tmp`]) if (fs.existsSync(owned)) fs.unlinkSync(owned);
  }
});
test('Windows transient publication lease retries the same bytes without replaying business work or deleting the last report', () => {
  const calls = [], waits = []; let attempts = 0;
  const io = { mkdirSync() {}, writeFileSync: (...args) => calls.push(args), renameSync: () => {
    if (++attempts <= 2) throw Object.assign(new Error('reader lease'), { code: 'EPERM' });
  } };
  publishRound2Report('output/round2.json', { actual: 'immutable result' }, { io, platform: 'win32', wait: ms => waits.push(ms) });
  assert.equal(calls.length, 1); assert.equal(attempts, 3); assert.deepEqual(waits, [25, 50]);
  assert.equal(calls[0][1], '{\n  "actual": "immutable result"\n}\n');
});
for (const [code, platform, expectedAttempts] of [['EPERM', 'win32', 5], ['EIO', 'win32', 1], ['EPERM', 'linux', 1]]) {
  test(`report publication ${platform}/${code} remains bounded and fails instead of manufacturing a finish`, () => {
    let attempts = 0, writes = 0;
    const io = { mkdirSync() {}, writeFileSync: () => writes++, renameSync: () => { attempts++; throw Object.assign(new Error('publication failure'), { code }); } };
    assert.throws(() => publishRound2Report('output/round2.json', { actual: true }, { io, platform, wait() {} }), /publication failure/);
    assert.equal(writes, 1); assert.equal(attempts, expectedAttempts);
  });
}
