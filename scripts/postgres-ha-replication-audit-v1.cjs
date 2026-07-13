const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const RUNTIME_ROOT = process.env.AILAODA_HA_RUNTIME_ROOT || 'C:\\AilaoDaPostgresRehearsal';
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'postgres-ha-replication-audit-v1.json');
const clientModule = path.join(ROOT, 'output', 'postgres-server-artifact', 'backend', 'prisma', 'generated-client');
const { PrismaClient } = require(clientModule);

const passwordPath = path.join(RUNTIME_ROOT, '.pg-password.txt');
const password = process.env.PG_HA_PASSWORD || (fs.existsSync(passwordPath) ? fs.readFileSync(passwordPath, 'utf8').trim() : '');
if (!password) throw new Error('PG_HA_PASSWORD or the sandbox PostgreSQL password file is required.');

const makeUrl = port => `postgresql://ailaoda:${encodeURIComponent(password)}@127.0.0.1:${port}/ailaoda?schema=public`;
const primary = new PrismaClient({ datasources: { db: { url: process.env.PG_HA_PRIMARY_URL || makeUrl(55432) } } });
const standby = new PrismaClient({ datasources: { db: { url: process.env.PG_HA_STANDBY_URL || makeUrl(55433) } } });

const report = {
  name: 'PostgreSQL HA Replication Audit', version: '1.0', status: 'failed',
  startedAt: new Date().toISOString(), primaryPort: 55432, standbyPort: 55433,
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const serialize = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));

async function main() {
  const [primaryRecovery] = await primary.$queryRawUnsafe('select pg_is_in_recovery() as value');
  const [standbyRecovery] = await standby.$queryRawUnsafe('select pg_is_in_recovery() as value');
  if (primaryRecovery.value !== false || standbyRecovery.value !== true) {
    throw new Error('Primary/standby recovery roles are not correct.');
  }

  const user = await primary.user.findFirst({ where: { username: 'ui_perf_market_admin' }, select: { id: true } });
  if (!user) throw new Error('HA audit user is missing.');
  const marker = `HA-REPLICATION-${crypto.randomUUID()}`;
  const created = await primary.auditLog.create({
    data: { userId: user.id, action: 'HA_REPLICATION_PROBE', resource: 'SYSTEM', details: marker, ipAddress: '127.0.0.1', userAgent: 'postgres-ha-replication-audit-v1' },
    select: { id: true, createdAt: true },
  });

  const deadline = Date.now() + 15000;
  let replicated = null;
  while (Date.now() < deadline) {
    replicated = await standby.auditLog.findUnique({ where: { id: created.id }, select: { id: true, details: true, createdAt: true } });
    if (replicated?.details === marker) break;
    await sleep(250);
  }
  if (!replicated || replicated.details !== marker) throw new Error('Replication marker was not replayed on the standby within 15 seconds.');

  const replication = await primary.$queryRawUnsafe(`
    select application_name, state, sync_state, client_addr::text as client_addr,
      sent_lsn::text, write_lsn::text, flush_lsn::text, replay_lsn::text
    from pg_stat_replication
  `);
  if (!replication.some(row => row.state === 'streaming' && row.replay_lsn)) {
    throw new Error('Primary does not report a streaming standby with replay progress.');
  }

  report.roles = { primaryInRecovery: primaryRecovery.value, standbyInRecovery: standbyRecovery.value };
  report.marker = { auditLogId: created.id, replicated: true, createdAt: created.createdAt, replayedAt: replicated.createdAt };
  report.replication = serialize(replication);
  report.status = 'passed';
}

main().catch(error => {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}).finally(async () => {
  await Promise.allSettled([primary.$disconnect(), standby.$disconnect()]);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`PostgreSQL HA Replication Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${REPORT_PATH}`);
});
