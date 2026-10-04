const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { ensureUiAuditUser, createAuditPrismaClient } = require('./lib/ui-audit-user.cjs');
const urls = [process.env.APP_URL, process.env.SECONDARY_APP_URL].map(v => String(v || '').replace(/\/$/, ''));
const reportPath = path.resolve(process.env.ROUND2_REPORT_PATH || 'output/audit/payment-reversal-api-v1.json');
const runId = `rv-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, actors = {};
const browserMode = process.env.ROUND2_REVERSAL_BROWSER === 'true';
const report = { version: browserMode ? 'payment-reversal-browser-audit/v1' : 'payment-reversal-api-audit/v1', status: 'running', startedAt: new Date().toISOString(),
  scope: 'API/database prerequisite only, not 37-check browser acceptance', metadata: { commit: process.env.ROUND2_COMMIT,
    sourceHash: process.env.ROUND2_SOURCE_HASH, dirtySource: process.env.ROUND2_DIRTY, provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite' } };
async function request(endpoint, { actor = actors.admin, instance = 0, method = 'GET', data, signal } = {}) {
  const r = await fetch(`${urls[instance]}/api${endpoint}`, { method, headers: { 'content-type': 'application/json', ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
  return { status: r.status, ok: r.ok, json: await r.json() };
}
function dataOf(r) { assert([200,201].includes(r.status), `HTTP ${r.status}: ${JSON.stringify(r.json)}`); assert(r.json?.data); return r.json.data; }
let prisma;
async function main() {
  assert.equal(process.env.ROUND2_ALLOW_MUTATIONS, 'true'); assert(process.env.DATABASE_URL || process.env.AUDIT_DATABASE_URL);
  assert(urls[0] && urls[1] && urls[0] !== urls[1]); for (const url of urls) assert(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname));
  const signal = AbortSignal.timeout(browserMode ? 210000 : 120000), password = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  for (const [job, role] of [['admin','admin'],['sales','sales'],['finance1','finance'],['finance2','finance']]) {
    const username = `${runId}_${job}`; await ensureUiAuditUser({ username, password, role, segment: role === 'sales' ? 'direct' : 'mixed' });
    const login = dataOf(await request('/auth/login', { actor: null, method: 'POST', data: { username, password }, signal }));
    assert(login.token && login.user?.id); actors[job] = { id: login.user.id, token: login.token, role, job,
      loginUser: { id: login.user.id, role: login.user.role, permissions: login.user.permissions, dataScopes: login.user.dataScopes } };
  }
  prisma = createAuditPrismaClient(); report.evidence = await require('./lib/payment-reversal-api-probe.cjs').paymentReversalApiProbe({ request, dataOf, actors, prisma, runId, urls, reportPath }, signal);
  report.proof = require('./lib/payment-reversal-api-proof.cjs').verifyPaymentReversalApiProof(report.evidence);
  if (browserMode) {
    report.scope = 'API/database concurrency + real finance browser reversal + original-intent lost-ack recovery + signed event/app crash; not full catalog or DB-server restart';
    report.browser = await require('./lib/payment-reversal-browser-probe.cjs').paymentReversalBrowserProbe({ request, dataOf, actors, prisma, runId, urls, reportPath }, signal);
    report.browserProof = require('./lib/payment-reversal-browser-proof.cjs').verifyPaymentReversalBrowserProof(report.browser, report.metadata.provider);
  }
  report.status = 'passed';
}
main().catch(error => { report.status = 'failed'; report.error = error.message;
    if (error.evidence?.version?.startsWith('payment-reversal-browser/')) report.browser = error.evidence;
    else if (error.evidence) report.evidence = error.evidence;
    process.exitCode = 1; })
  .finally(async () => { if (prisma) await prisma.$disconnect(); report.finishedAt = new Date().toISOString(); fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, scope: report.scope, reportPath })); });
