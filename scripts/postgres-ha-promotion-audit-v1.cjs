const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.cwd();
const RUNTIME_ROOT = path.resolve(process.env.AILAODA_HA_RUNTIME_ROOT || 'C:\\AilaoDaPostgresRehearsal');
const BIN = path.join(RUNTIME_ROOT, 'portable', 'pgsql', 'bin');
const CANDIDATE = path.join(RUNTIME_ROOT, 'promotion-candidate-data');
const LOG_PATH = path.join(RUNTIME_ROOT, 'logs', 'postgres-promotion-candidate.log');
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'postgres-ha-promotion-audit-v1.json');
const PRIMARY_PORT = 55432;
const STANDBY_PORT = 55433;
const CANDIDATE_PORT = 55434;
const { PrismaClient } = require(path.join(ROOT, 'output', 'postgres-server-artifact', 'backend', 'prisma', 'generated-client'));

const password = fs.readFileSync(path.join(RUNTIME_ROOT, '.pg-password.txt'), 'utf8').trim();
const makeUrl = port => `postgresql://ailaoda:${encodeURIComponent(password)}@127.0.0.1:${port}/ailaoda?schema=public`;
const report = {
  name: 'PostgreSQL HA Promotion Audit', version: '1.0', status: 'failed',
  startedAt: new Date().toISOString(), primaryPort: PRIMARY_PORT, standbyPort: STANDBY_PORT, candidatePort: CANDIDATE_PORT, checks: [],
};
let candidateStarted = false;
const clients = [];

const command = (name, executable, args, timeout = 30000) => {
  execFileSync(executable, args, { cwd: ROOT, timeout, windowsHide: true, stdio: 'ignore', env: { ...process.env, PGPASSWORD: password } });
  report.checks.push({ name, status: 'passed' });
};

const connect = port => {
  const client = new PrismaClient({ datasources: { db: { url: makeUrl(port) } } });
  clients.push(client);
  return client;
};

async function main() {
  const resolvedCandidate = path.resolve(CANDIDATE);
  if (!resolvedCandidate.startsWith(`${RUNTIME_ROOT}${path.sep}`)) throw new Error('Candidate path escaped the sandbox runtime root.');
  fs.rmSync(CANDIDATE, { recursive: true, force: true });
  fs.mkdirSync(CANDIDATE, { recursive: true });

  command('basebackup', path.join(BIN, 'pg_basebackup.exe'), [
    '-h', '127.0.0.1', '-p', String(PRIMARY_PORT), '-U', 'ailaoda', '-D', CANDIDATE, '-R', '-X', 'stream', '-c', 'fast',
  ], 60000);
  candidateStarted = true;
  command('candidate-start', path.join(BIN, 'pg_ctl.exe'), [
    '-D', CANDIDATE, '-l', LOG_PATH, '-o', `-p ${CANDIDATE_PORT} -h 127.0.0.1`, '-w', '-t', '15', 'start',
  ], 20000);

  const candidate = connect(CANDIDATE_PORT);
  const [before] = await candidate.$queryRawUnsafe('select pg_is_in_recovery() as value');
  if (before.value !== true) throw new Error('Candidate did not start in recovery.');
  report.checks.push({ name: 'candidate-starts-in-recovery', status: 'passed' });

  command('candidate-promote', path.join(BIN, 'pg_ctl.exe'), ['-D', CANDIDATE, '-w', '-t', '15', 'promote'], 20000);
  const [after] = await candidate.$queryRawUnsafe('select pg_is_in_recovery() as value');
  if (after.value !== false) throw new Error('Candidate remained in recovery after promotion.');
  report.checks.push({ name: 'candidate-promoted', status: 'passed' });

  await candidate.$executeRawUnsafe('create table if not exists ha_promotion_probe(id bigint primary key, created_at timestamptz default now())');
  await candidate.$executeRawUnsafe('insert into ha_promotion_probe(id) values (2026071301) on conflict (id) do nothing');
  const [probe] = await candidate.$queryRawUnsafe('select count(*)::int as count from ha_promotion_probe where id=2026071301');
  if (probe.count !== 1) throw new Error('Promoted candidate failed write/readback.');
  report.checks.push({ name: 'promoted-write-readback', status: 'passed', rows: probe.count });

  const primary = connect(PRIMARY_PORT);
  const standby = connect(STANDBY_PORT);
  const [[primaryRole], [standbyRole]] = await Promise.all([
    primary.$queryRawUnsafe('select pg_is_in_recovery() as value'),
    standby.$queryRawUnsafe('select pg_is_in_recovery() as value'),
  ]);
  if (primaryRole.value !== false || standbyRole.value !== true) throw new Error('Durable primary/standby roles changed during isolated promotion.');
  report.checks.push({ name: 'durable-primary-standby-preserved', status: 'passed' });
  report.status = 'passed';
}

main().catch(error => {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}).finally(async () => {
  await Promise.allSettled(clients.map(client => client.$disconnect()));
  if (candidateStarted) {
    try {
      execFileSync(path.join(BIN, 'pg_ctl.exe'), ['-D', CANDIDATE, '-m', 'fast', '-w', '-t', '15', 'stop'], { timeout: 20000, windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      report.cleanupError = error instanceof Error ? error.message : String(error);
      report.status = 'failed';
      process.exitCode = 1;
    }
  }
  const resolvedCandidate = path.resolve(CANDIDATE);
  if (resolvedCandidate.startsWith(`${RUNTIME_ROOT}${path.sep}`) && !report.cleanupError) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(CANDIDATE, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`PostgreSQL HA Promotion Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${REPORT_PATH}`);
});
