const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ensureUiAuditUser, resolveDefaultAccount } = require('./lib/ui-audit-user.cjs');

const reportPath = path.join(process.cwd(), 'output/audit/cloud-degradable-dependency-failover-audit-v1.json');
const shippingReportPath = path.join(process.cwd(), 'output/playwright/shipping-audit-report-v1.json');
const appUrl = String(process.env.APP_URL || 'http://127.0.0.1:5006/').replace(/\/?$/, '/');
const meiliKey = String(process.env.MEILI_MASTER_KEY || '');
const report = { name: 'Cloud Search and Object Storage Failover Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Check failed: ${name}`);
};
const compose = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8' }).trim();
const waitFor = async (probe, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await probe()) return true; } catch {}
    await sleep(500);
  }
  return false;
};
const healthOk = async url => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
};
const directMeiliSearch = async (port, term) => {
  const response = await fetch(`http://127.0.0.1:${port}/indexes/ailaoda_orders/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${meiliKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ q: term, limit: 20 }),
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json();
  return { ok: response.ok, hits: Array.isArray(body?.hits) ? body.hits.length : 0 };
};
const appOrderSearch = async (token, term) => {
  const response = await fetch(`${appUrl}api/v1/orders?page=1&pageSize=25&search=${encodeURIComponent(term)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  const rows = Array.isArray(body?.data) ? body.data : (body?.data?.items || []);
  return { ok: response.ok, rows: rows.length };
};

async function main() {
  const account = resolveDefaultAccount();
  check('meilisearch-key-configured', Boolean(meiliKey));
  await ensureUiAuditUser(account);
  const login = await fetch(`${appUrl}api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
    signal: AbortSignal.timeout(5000),
  });
  const loginBody = await login.json();
  const token = loginBody?.data?.token;
  check('audit-login', login.ok && Boolean(token));

  const primarySearch = await directMeiliSearch(7700, 'SO');
  const secondarySearch = await directMeiliSearch(7710, 'SO');
  check('search-index-replicated-before-failover', primarySearch.ok && secondarySearch.ok && primarySearch.hits > 0 && secondarySearch.hits > 0, {
    primaryHits: primarySearch.hits,
    secondaryHits: secondarySearch.hits,
  });

  compose('stop', 'meilisearch-primary');
  check('search-primary-stopped', await waitFor(async () => !(await healthOk('http://127.0.0.1:7700/health')), 10_000));
  const failoverSearch = await appOrderSearch(token, 'SO');
  check('application-search-uses-secondary', failoverSearch.ok && failoverSearch.rows > 0, failoverSearch);
  compose('start', 'meilisearch-primary');
  check('search-primary-recovered', await waitFor(() => healthOk('http://127.0.0.1:7700/health')));

  compose('stop', 'minio-primary');
  check('object-primary-stopped', await waitFor(async () => !(await healthOk('http://127.0.0.1:9000/minio/health/live')), 10_000));
  execFileSync(process.execPath, ['./scripts/shipping-browser-audit-v1.cjs'], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  const shippingReport = JSON.parse(fs.readFileSync(shippingReportPath, 'utf8'));
  const receiptUrl = shippingReport?.linkedShipment?.signedReceiptUrl;
  check('receipt-upload-succeeded-on-secondary', shippingReport.status === 'passed' && Boolean(receiptUrl), { receiptUrl });

  compose('start', 'minio-primary');
  check('object-primary-recovered', await waitFor(() => healthOk('http://127.0.0.1:9000/minio/health/live')));
  compose('exec', '-T', 'minio-init', 'mc', 'mirror', '--overwrite', 'secondary/ailaoda-files', 'primary/ailaoda-files');

  compose('stop', 'minio-secondary');
  check('object-secondary-stopped', await waitFor(async () => !(await healthOk('http://127.0.0.1:9010/minio/health/live')), 10_000));
  const receiptRead = await fetch(new URL(receiptUrl, appUrl), {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  const receiptBytes = Buffer.from(await receiptRead.arrayBuffer());
  check('repaired-receipt-readable-from-primary', receiptRead.ok && receiptBytes.length > 0, { status: receiptRead.status, bytes: receiptBytes.length });

  compose('start', 'minio-secondary');
  check('object-secondary-recovered', await waitFor(() => healthOk('http://127.0.0.1:9010/minio/health/live')));
  compose('exec', '-T', 'minio-init', 'mc', 'mirror', '--overwrite', 'primary/ailaoda-files', 'secondary/ailaoda-files');
  report.status = 'passed';
}

main().catch(error => {
  report.error = String(error?.message || error);
  console.error(`Cloud dependency failover failure: ${report.error}`);
  process.exitCode = 1;
}).finally(async () => {
  for (const service of ['meilisearch-primary', 'minio-primary', 'minio-secondary']) {
    try { compose('start', service); } catch {}
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Cloud Search and Object Storage Failover Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
