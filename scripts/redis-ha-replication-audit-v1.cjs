const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Redis = require('../backend/node_modules/ioredis');

const ROOT = process.cwd();
const RUNTIME_ROOT = process.env.AILAODA_HA_RUNTIME_ROOT || 'C:\\AilaoDaPostgresRehearsal';
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'redis-ha-replication-audit-v1.json');
const password = fs.readFileSync(path.join(RUNTIME_ROOT, '.redis-password.txt'), 'utf8').trim();
const promotionEnabled = !['1', 'true', 'yes'].includes(String(process.env.REDIS_HA_SKIP_PROMOTION || '').toLowerCase());
const options = port => ({ host: '127.0.0.1', port, password, lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000 });
const primary = new Redis(options(6380));
const replica = new Redis(options(6381));
const report = { name: 'Redis HA Replication Audit', version: '1.1', status: 'failed', mode: promotionEnabled ? 'promotion-rejoin' : 'replication-only', startedAt: new Date().toISOString(), primaryPort: 6380, replicaPort: 6381, checks: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let replicaPromoted = false;

const waitFor = async (predicate, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(200);
  }
  return false;
};

const replicationFields = info => Object.fromEntries(info.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
  const index = line.indexOf(':');
  return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, ''];
}));

async function main() {
  await Promise.all([primary.connect(), replica.connect()]);
  const primaryInfo = replicationFields(await primary.info('replication'));
  const replicaInfo = replicationFields(await replica.info('replication'));
  if (primaryInfo.role !== 'master' || Number(primaryInfo.connected_slaves) < 1) throw new Error('Redis primary does not report an online replica.');
  if (!['slave', 'replica'].includes(replicaInfo.role) || replicaInfo.master_link_status !== 'up') throw new Error('Redis replica link is not up.');
  report.checks.push({ name: 'replication-link', status: 'passed', lag: Number(primaryInfo.master_repl_offset) - Number(replicaInfo.slave_repl_offset) });

  const marker = crypto.randomUUID();
  const replicatedKey = `ailaoda:ha-probe:replicated:${marker}`;
  const promotedKey = `ailaoda:ha-probe:promoted:${marker}`;
  await primary.set(replicatedKey, marker, 'EX', 120);
  const replicated = await waitFor(async () => await replica.get(replicatedKey) === marker);
  if (!replicated) throw new Error('Redis probe key did not replicate within 10 seconds.');
  report.checks.push({ name: 'key-replication', status: 'passed' });

  let readOnlyRejected = false;
  try {
    await replica.set(promotedKey, marker, 'EX', 120);
  } catch (error) {
    readOnlyRejected = String(error.message || error).includes('READONLY');
  }
  if (!readOnlyRejected) throw new Error('Redis replica accepted a write before promotion.');
  report.checks.push({ name: 'replica-read-only', status: 'passed' });

  if (promotionEnabled) {
    await replica.replicaof('NO', 'ONE');
    replicaPromoted = true;
    const promoted = await waitFor(async () => replicationFields(await replica.info('replication')).role === 'master');
    if (!promoted) throw new Error('Redis replica did not promote to master.');
    await replica.set(promotedKey, marker, 'EX', 120);
    if (await replica.get(promotedKey) !== marker) throw new Error('Promoted Redis replica failed write/readback.');
    report.checks.push({ name: 'promotion-write-readback', status: 'passed' });

    await replica.del(promotedKey);
    await replica.replicaof('127.0.0.1', 6380);
    const rejoined = await waitFor(async () => {
      const info = replicationFields(await replica.info('replication'));
      return ['slave', 'replica'].includes(info.role) && info.master_link_status === 'up';
    }, 15000);
    if (!rejoined) throw new Error('Promoted Redis node did not rejoin the primary.');
    replicaPromoted = false;
    if (await replica.get(replicatedKey) !== marker) throw new Error('Rejoined Redis replica lost the primary probe key.');
    report.checks.push({ name: 'rejoin-primary', status: 'passed' });
  }

  await primary.del(replicatedKey);
  report.status = 'passed';
}

main().catch(error => {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}).finally(async () => {
  if (replicaPromoted) {
    try {
      await replica.replicaof('127.0.0.1', 6380);
      await waitFor(async () => {
        const info = replicationFields(await replica.info('replication'));
        return ['slave', 'replica'].includes(info.role) && info.master_link_status === 'up';
      }, 15000);
      report.recovery = { status: 'passed', action: 'replica-rejoined-primary-after-failure' };
    } catch (error) {
      report.recovery = { status: 'failed', error: String(error.message || error) };
      process.exitCode = 1;
    }
  }
  await Promise.allSettled([primary.quit(), replica.quit()]);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Redis HA Replication Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${REPORT_PATH}`);
});
