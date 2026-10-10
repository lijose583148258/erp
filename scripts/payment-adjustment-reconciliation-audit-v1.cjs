const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ensureUiAuditUser, createAuditPrismaClient } = require('./lib/ui-audit-user.cjs');
const { paymentAdjustmentReconciliation } = require('./lib/payment-adjustment-reconciliation.cjs');
const urls = [process.env.APP_URL, process.env.SECONDARY_APP_URL].map(v => String(v || '').replace(/\/$/, ''));
const reportPath = path.resolve(process.env.ROUND2_REPORT_PATH || 'output/audit/payment-adjustment-reconciliation-v1.json');
const actors = {}, runId = `reconcile-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const report = { version: 'payment-adjustment-reconciliation-audit/v1', startedAt: new Date().toISOString(), status: 'running',
  scope: 'Supporting API/database invariant only; no enterprise check or browser acceptance promotion',
  metadata: { commit: process.env.ROUND2_COMMIT, sourceHash: process.env.ROUND2_SOURCE_HASH, dirtySource: process.env.ROUND2_DIRTY,
    builtAt: process.env.ROUND2_BUILT_AT, provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite' } };
async function request(endpoint, { actor = actors.admin, instance = 0, method = 'GET', data, signal } = {}) {
  const r = await fetch(`${urls[instance]}/api${endpoint}`, { method, headers: { 'content-type': 'application/json',
    ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
  const json = await r.json(); return { status: r.status, ok: r.ok, json };
}
function dataOf(r) { assert([200,201].includes(r.status), `HTTP ${r.status}: ${JSON.stringify(r.json)}`); assert(r.json?.data); return r.json.data; }
let prisma;
async function main() {
  assert.equal(process.env.ROUND2_ALLOW_MUTATIONS, 'true');
  assert(process.env.DATABASE_URL || process.env.AUDIT_DATABASE_URL, 'No stable database fallback');
  assert(urls[0] && urls[1] && urls[0] !== urls[1]);
  for (const url of urls) assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname));
  const signal = AbortSignal.timeout(90000), password = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  for (const [job, role] of [['admin','admin'], ['sales','sales'], ['finance1','finance'], ['finance2','finance']]) {
    const username = `${runId}_${job}`;
    await ensureUiAuditUser({ username, password, role, segment: role === 'sales' ? 'direct' : 'mixed' });
    const login = dataOf(await request('/auth/login', { actor: null, method: 'POST', data: { username, password }, signal }));
    assert(login.token && login.user?.id); actors[job] = { id: login.user.id, token: login.token, role };
  }
  prisma = createAuditPrismaClient();
  report.evidence = await paymentAdjustmentReconciliation({ request, dataOf, actors, prisma, runId, urls, reportPath }, signal);
  require('./lib/payment-adjustment-proof.cjs').verifyPaymentAdjustmentProof(report.evidence, { requireBarter: false });
  report.status = 'passed';
}
main().catch(error => { report.status = 'failed'; report.error = error.message; report.evidence = error.evidence; process.exitCode = 1; })
  .finally(async () => { if (prisma) await prisma.$disconnect(); report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, scope: report.scope, reportPath })); });
