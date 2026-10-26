const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const migration = path.join(root, 'backend/prisma/postgres-migrations/202610020001_payment-event-outbox/migration.sql');
const { Client } = require(path.join(root, 'backend/node_modules/pg'));

async function run() {
  assert.equal(process.env.PAYMENT_MIGRATION_ALLOW_FIXTURES, 'true', 'Explicit isolated schema fixture opt-in required');
  const baseUrl = new URL(process.env.PAYMENT_MIGRATION_DATABASE_URL || '');
  assert(['postgres:', 'postgresql:'].includes(baseUrl.protocol));
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname), 'Only loopback sandbox PostgreSQL is permitted');
  const runId = crypto.randomBytes(6).toString('hex');
  const folder = path.join(root, 'output/payment-event-migration', runId);
  fs.mkdirSync(folder, { recursive: true });
  const sql = fs.readFileSync(migration, 'utf8');
  const report = { status: 'running', startedAt: new Date().toISOString(), runId,
    migrationSha256: crypto.createHash('sha256').update(sql).digest('hex'), cases: [] };
  const auditPath = path.join(root, 'output/audit/payment-event-migration-v1.json');
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  const save = () => {
    const json = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(folder, 'report.json'), json);
    fs.writeFileSync(auditPath, json);
  };
  save();
  // Copy only source schema into a unique fixture folder; never rewrite the active client.
  const schemaDir = path.join(folder, 'prisma');
  fs.mkdirSync(schemaDir);
  const modelsDir = path.join(schemaDir, 'models');
  fs.mkdirSync(modelsDir);
  for (const entry of fs.readdirSync(path.join(root, 'backend/prisma/models'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;
    fs.writeFileSync(path.join(modelsDir, entry.name), fs.readFileSync(path.join(root, 'backend/prisma/models', entry.name)));
  }
  const entry = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
  assert(entry.includes('provider = "sqlite"'));
  fs.writeFileSync(path.join(schemaDir, 'schema.prisma'), entry.replace('provider = "sqlite"', 'provider = "postgresql"'));
  for (const scenario of ['bootstrap', 'upgrade']) {
    const schema = `payment_event_${scenario}_${runId}`;
    assert(/^payment_event_(bootstrap|upgrade)_[a-f0-9]{12}$/.test(schema));
    const url = new URL(baseUrl); url.searchParams.set('schema', schema); url.searchParams.set('options', `-c search_path=${schema}`);
    const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    const result = { scenario, schema, status: 'running', checks: [] };
    report.cases.push(result); let created = false;
    try {
      await client.connect();
      await client.query("SET statement_timeout = '30s'");
      await client.query(`CREATE SCHEMA "${schema}"`); created = true;
      assert.equal((await client.query('SELECT current_schema() AS name')).rows[0].name, schema);
      if (scenario === 'bootstrap') {
        const log = execFileSync(process.execPath, [path.join(root, 'backend/node_modules/prisma/build/index.js'), 'db', 'push', '--schema', schemaDir, '--skip-generate'], {
          cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 60000, windowsHide: true, encoding: 'utf8', stdio: 'pipe',
        });
        fs.writeFileSync(path.join(folder, 'bootstrap.log'), log);
        result.checks.push('real-prisma-db-push');
      } else {
        // Exact pre-outbox BusinessEvent table: old events must stay byte-for-byte unchanged.
        await client.query(`CREATE TABLE business_events (
          id SERIAL PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL,
          aggregate_id TEXT NOT NULL, payload_json TEXT, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
      }
      await client.query(`INSERT INTO business_events(event_type, aggregate_type, aggregate_id, payload_json) VALUES ('legacy.event', 'payment', '7', '{"legacy":true}')`);
      const before = (await client.query('SELECT id,event_type,aggregate_type,aggregate_id,payload_json,created_at FROM business_events')).rows;
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      assert.deepEqual((await client.query('SELECT id,event_type,aggregate_type,aggregate_id,payload_json,created_at FROM business_events')).rows, before);
      assert.equal((await client.query('SELECT event_key FROM business_events')).rows[0].event_key, null);
      await client.query(sql);
      result.checks.push('migration-and-replay', 'historical-event-preserved-without-invented-key');
      const event = (await client.query(`INSERT INTO business_events(event_key,event_type,aggregate_type,aggregate_id) VALUES ('payment.verified:9','payment.verified','payment','9') RETURNING id`)).rows[0];
      await client.query(`INSERT INTO business_event_deliveries(event_id,channel,destination_key) VALUES ($1,'webhook','test-hash')`, [event.id]);
      await assert.rejects(client.query(`INSERT INTO business_events(event_key,event_type,aggregate_type,aggregate_id) VALUES ('payment.verified:9','payment.verified','payment','9')`), { code: '23505' });
      await assert.rejects(client.query(`INSERT INTO business_event_deliveries(event_id,channel,destination_key) VALUES ($1,'webhook','test-hash')`, [event.id]), { code: '23505' });
      for (const [field, value] of [['channel', 'invalid'], ['status', 'invalid'], ['attempts', -1]]) {
        await assert.rejects(client.query(`UPDATE business_event_deliveries SET "${field}"=$1`, [value]), { code: '23514' });
      }
      await assert.rejects(client.query('DELETE FROM business_events WHERE id=$1', [event.id]), { code: '23503' });
      const constraints = (await client.query(`SELECT conname,contype,convalidated FROM pg_constraint WHERE conrelid='business_event_deliveries'::regclass ORDER BY conname`)).rows;
      assert(constraints.filter(c => c.contype === 'c').length >= 3 && constraints.every(c => c.convalidated));
      result.checks.push('event-and-destination-unique', 'check-constraints-enforced', 'event-delete-restricted');
      result.constraints = constraints; result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.error = error.message; result.sqlState = error.code || null;
    } finally {
      if (created) {
        // Only the exact random schema created above can be removed; no caller-supplied schema names.
        try { await client.query(`DROP SCHEMA "${schema}" CASCADE`); result.fixtureRemoved = true; }
        catch { result.fixtureRemoved = false; result.status = 'failed'; }
      }
      await client.end(); save();
    }
  }
  report.status = report.cases.every(c => c.status === 'passed' && c.fixtureRemoved) ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ ...report, reportPath: path.join(folder, 'report.json') }));
  if (report.status !== 'passed') process.exitCode = 1;
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
