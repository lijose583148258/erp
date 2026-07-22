const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ensureUiAuditUser, resolveDefaultAccount } = require('./lib/ui-audit-user.cjs');

const reportPath = path.join(process.cwd(), 'output/audit/cloud-postgres-backup-restore-audit-v1.json');
const appUrl = String(process.env.APP_URL || 'http://127.0.0.1:5006/').replace(/\/?$/, '/');
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const restoreDb = `ailaoda_restore_${runId}`.toLowerCase();
const marker = `BACKUP-RESTORE-${runId}`;
const report = { name: 'Cloud PostgreSQL Logical Backup Restore Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Check failed: ${name}`);
};
const compose = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
const runBinary = (args, input) => {
  const result = spawnSync('docker', ['compose', ...args], { input, maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(Buffer.from(result.stderr || '').toString('utf8') || `docker compose exited ${result.status}`);
  return Buffer.from(result.stdout || '');
};

async function main() {
  const account = resolveDefaultAccount();
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

  const create = await fetch(`${appUrl}api/v1/customers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      nameZh: marker,
      nameEn: `${marker} Customer`,
      nameVi: `${marker} Customer`,
      licenseNumber: `LIC-${runId}`,
      creditLimit: 10000,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'Backup restore audit',
      contactPhone: '0900000000',
      contactEmail: `backup-${runId}@example.com`,
      address: 'Cloud backup restore audit',
      status: 'active',
    }),
    signal: AbortSignal.timeout(8000),
  });
  const createBody = await create.json();
  const markerId = createBody?.data?.id;
  check('marker-created', create.status === 201 && Boolean(markerId), { markerId });

  const dump = runBinary(['exec', '-T', 'postgres', 'pg_dump', '-U', 'ailaoda', '-d', 'ailaoda', '-Fc']);
  check('logical-backup-created', dump.length > 1024, {
    bytes: dump.length,
    sha256: crypto.createHash('sha256').update(dump).digest('hex'),
  });

  compose('exec', '-T', 'postgres', 'psql', '-U', 'ailaoda', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${restoreDb}`);
  runBinary(['exec', '-T', 'postgres', 'pg_restore', '-U', 'ailaoda', '-d', restoreDb, '--no-owner', '--no-privileges'], dump);
  const restoredCount = Number(compose(
    'exec', '-T', 'postgres', 'psql', '-U', 'ailaoda', '-d', restoreDb, '-tAc',
    `SELECT COUNT(*) FROM customers WHERE id = ${Number(markerId)}`,
  ));
  check('restored-business-marker', restoredCount === 1, { markerId, restoredCount });
  report.status = 'passed';
}

main().catch(error => {
  report.error = String(error?.message || error);
  console.error(`Cloud PostgreSQL backup restore failure: ${report.error}`);
  process.exitCode = 1;
}).finally(() => {
  try {
    compose('exec', '-T', 'postgres', 'psql', '-U', 'ailaoda', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${restoreDb} WITH (FORCE)`);
  } catch {}
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Cloud PostgreSQL Logical Backup Restore Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
