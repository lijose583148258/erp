const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

function validateCatalog(catalog) {
  assert.equal(catalog.roles.reduce((sum, role) => sum + role.count, 0), 20, 'Exactly 20 workforce positions are required');
  assert.equal(catalog.chains.length, 12, 'Exactly 12 business chains are required');
  const jobs = catalog.roles.map(role => role.job);
  assert.equal(new Set(jobs).size, jobs.length, 'Duplicate workforce role');
  assert(catalog.roles.every(role => Number.isInteger(role.count) && role.count > 0));
  const ids = catalog.chains.map(chain => chain.id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate chain ID');
  const checks = catalog.chains.flatMap(chain => chain.checks);
  assert(catalog.chains.every(chain => chain.checks.length > 0), 'Empty chain');
  assert.equal(new Set(checks).size, checks.length, 'Duplicate check ID');
  return checks;
}

function summarize(report, catalog) {
  const expected = validateCatalog(catalog);
  const actual = report.checks.map(check => check.id);
  assert.equal(new Set(actual).size, actual.length, 'Duplicate evidence ID');
  assert(actual.every(id => expected.includes(id)), 'Unknown evidence ID');
  const byId = new Map(report.checks.map(check => [check.id, check]));
  const chains = catalog.chains.map(chain => {
    const states = chain.checks.map(id => byId.get(id)?.status || 'not_run');
    return { ...chain, status: states.every(state => state === 'passed') ? 'passed'
      : states.some(state => ['failed', 'timed_out'].includes(state)) ? 'failed' : 'incomplete' };
  });
  return {
    expectedChecks: expected.length,
    passedChecks: expected.filter(id => byId.get(id)?.status === 'passed').length,
    failedChecks: expected.filter(id => ['failed', 'timed_out'].includes(byId.get(id)?.status)).length,
    remainingChecks: expected.filter(id => !['passed', 'failed', 'timed_out'].includes(byId.get(id)?.status)).length,
    passedChains: chains.filter(chain => chain.status === 'passed').length,
    status: chains.every(chain => chain.status === 'passed') ? 'passed'
      : chains.some(chain => chain.status === 'failed') ? 'failed' : 'incomplete',
    chains,
  };
}

function createRound2Runner({ catalog, reportPath, metadata = {} }) {
  const ids = validateCatalog(catalog);
  const report = {
    name: 'Enterprise Round 2 Business Acceptance', version: catalog.version,
    startedAt: new Date().toISOString(), metadata,
    workforce: catalog.roles,
    checks: ids.map(id => ({ id, status: 'not_run', reason: 'No execution evidence yet' })),
  };
  const save = () => {
    report.summary = summarize(report, catalog);
    report.status = report.summary.status;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const temp = `${reportPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`);
    fs.renameSync(temp, reportPath);
  };
  const run = async (id, action, { timeoutMs = 60_000 } = {}) => {
    const check = report.checks.find(item => item.id === id);
    assert(check, `Unknown check: ${id}`);
    assert.equal(check.status, 'not_run', `Check already executed: ${id}`);
    const controller = new AbortController();
    const started = performance.now();
    let timer;
    Object.assign(check, { status: 'running', startedAt: new Date().toISOString(), timeoutMs });
    delete check.reason;
    save();
    try {
      const evidence = await Promise.race([
        Promise.resolve().then(() => action(controller.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(() => { reject(new Error(`Check timeout after ${timeoutMs}ms`)); controller.abort(); }, timeoutMs);
        }),
      ]);
      assert(evidence && typeof evidence === 'object', 'A passing check requires read-back evidence');
      Object.assign(check, { status: 'passed', evidence });
      return evidence;
    } catch (error) {
      Object.assign(check, {
        status: controller.signal.aborted ? 'timed_out' : 'failed',
        error: String(error.message || error), evidence: error.evidence || null,
      });
      return null;
    } finally {
      clearTimeout(timer);
      check.durationMs = Math.round(performance.now() - started);
      check.finishedAt = new Date().toISOString();
      save();
    }
  };
  const block = (id, reason) => {
    const check = report.checks.find(item => item.id === id);
    assert(check && check.status === 'not_run', `Cannot block ${id}`);
    Object.assign(check, { status: 'blocked', reason });
    save();
  };
  save();
  return { report, run, block, save, finish() { report.finishedAt = new Date().toISOString(); save(); return report; } };
}

// All actors rendezvous before any write is issued. Timing proves client-side
// overlap, not database-lock overlap; assertions still examine persisted state.
async function synchronizedBurst(actors, action, signal) {
  assert(actors.length > 1 && new Set(actors.map(actor => actor.id)).size === actors.length, 'Distinct actors required');
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const queuedAt = performance.now();
  const promises = actors.map(async actor => {
    await barrier;
    signal?.throwIfAborted();
    const startedMs = performance.now() - queuedAt;
    try {
      const result = await action(actor);
      return { actorId: actor.id, startedMs, finishedMs: performance.now() - queuedAt, ...result };
    } catch (error) {
      return { actorId: actor.id, startedMs, finishedMs: performance.now() - queuedAt, status: 0, error: String(error.message || error) };
    }
  });
  release();
  return Promise.all(promises);
}

module.exports = { validateCatalog, summarize, createRound2Runner, synchronizedBurst };
