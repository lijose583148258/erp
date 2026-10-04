const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), { Client } = require(path.join(root, 'backend/node_modules/pg'));
async function main() {
  assert.equal(process.env.PAYMENT_MIGRATION_ALLOW_FIXTURES, 'true');
  const base = new URL(process.env.PAYMENT_MIGRATION_DATABASE_URL || '');
  assert(['postgres:', 'postgresql:'].includes(base.protocol)); assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const id = crypto.randomBytes(6).toString('hex'), folder = path.join(root, 'output/payment-reversal-migration', id);
  fs.mkdirSync(folder, { recursive: true });
  const sql = fs.readFileSync(path.join(root, 'backend/prisma/postgres-migrations/202610030002_original-payment-reversals/migration.sql'), 'utf8');
  const report = { version: 'payment-reversal-migration/v1', status: 'running', startedAt: new Date().toISOString(),
    scope: 'Real PostgreSQL DDL/bootstrap/upgrade/immutable-fact boundaries; not application or browser acceptance',
    runId: id, migrationSha256: crypto.createHash('sha256').update(sql).digest('hex'), cases: [] };
  const save = () => { const json = JSON.stringify(report, null, 2); fs.writeFileSync(path.join(folder, 'report.json'), json);
    fs.mkdirSync(path.join(root, 'output/audit'), { recursive: true }); fs.writeFileSync(path.join(root, 'output/audit/payment-reversal-migration-v1.json'), json); };
  save();
  for (const scenario of ['bootstrap', 'upgrade']) {
    const schema = `payment_reversal_${scenario}_${id}`; assert(/^payment_reversal_(bootstrap|upgrade)_[a-f0-9]{12}$/.test(schema));
    const url = new URL(base); url.searchParams.set('schema', schema); url.searchParams.set('options', `-c search_path=${schema}`);
    const client = new Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    const r = { scenario, schema, status: 'running', checks: [] }; report.cases.push(r); let created = false;
    try {
      const dir = path.join(folder, scenario, 'prisma'), models = path.join(dir, 'models'); fs.mkdirSync(models, { recursive: true });
      for (const name of fs.readdirSync(path.join(root, 'backend/prisma/models')).filter(n => n.endsWith('.prisma'))) {
        if (scenario === 'upgrade' && name === 'payment-reversals.prisma') continue;
        let source = fs.readFileSync(path.join(root, 'backend/prisma/models', name), 'utf8');
        if (scenario === 'upgrade') source = source.split(/\r?\n/).filter(line => !/\bPaymentReversal(?:Request)?[?\[\]\s]/.test(line)).join('\n');
        fs.writeFileSync(path.join(models, name), source);
      }
      const entry = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8'); assert(entry.includes('provider = "sqlite"'));
      fs.writeFileSync(path.join(dir, 'schema.prisma'), entry.replace('provider = "sqlite"', 'provider = "postgresql"'));
      await client.connect(); await client.query("SET statement_timeout = '30s'"); await client.query(`CREATE SCHEMA "${schema}"`); created = true;
      assert.equal((await client.query('SELECT current_schema() name')).rows[0].name, schema);
      fs.writeFileSync(path.join(folder, `${scenario}.log`), execFileSync(process.execPath,
        [path.join(root, 'backend/node_modules/prisma/build/index.js'), 'db', 'push', '--schema', dir, '--skip-generate'],
        { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 60000, windowsHide: true, encoding: 'utf8', stdio: 'pipe' }));
      assert.equal((await client.query("SELECT to_regclass('payment_reversal_requests') name")).rows[0].name !== null, scenario === 'bootstrap');
      r.checks.push('real-prisma-db-push');
      const actor = async name => (await client.query("INSERT INTO users(username,password_hash,role,updated_at) VALUES ($1,'unused','finance',CURRENT_TIMESTAMP) RETURNING id", [name])).rows[0].id;
      const requester = await actor('requester'), reviewer = await actor('reviewer');
      const customer = (await client.query("INSERT INTO customers(name,updated_at) VALUES ('legacy',CURRENT_TIMESTAMP) RETURNING id")).rows[0].id;
      const order = (await client.query("INSERT INTO orders(order_no,customer_id,created_by,total_amount,final_amount,paid_amount,updated_at) VALUES ('legacy',$1,$2,1000,1000,300,CURRENT_TIMESTAMP) RETURNING id", [customer, requester])).rows[0].id;
      const payment = (await client.query("INSERT INTO payment_records(order_id,amount,method,status,verified_by,updated_at) VALUES ($1,300,'bank_transfer','verified',$2,CURRENT_TIMESTAMP) RETURNING id", [order, requester])).rows[0].id;
      const audit = async (action, user = requester) => (await client.query("INSERT INTO audit_logs(user_id,action,resource,resource_id) VALUES ($1,$2,'payment',$3) RETURNING id", [user, action, payment])).rows[0].id;
      const originalAudit = await audit('PAYMENT_VERIFIED');
      const history = async () => ({ payments: (await client.query('SELECT * FROM payment_records ORDER BY id')).rows,
        orders: (await client.query('SELECT * FROM orders ORDER BY id')).rows, audits: (await client.query('SELECT * FROM audit_logs ORDER BY id')).rows });
      const before = await history(); await client.query('BEGIN'); try { await client.query(sql); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; }
      await client.query(sql); assert.deepEqual(await history(), before);
      assert.equal((await client.query('SELECT count(*)::int n FROM payment_reversal_requests')).rows[0].n, 0);
      assert.equal((await client.query('SELECT count(*)::int n FROM payment_reversals')).rows[0].n, 0);
      r.historicalPaymentId = payment; r.checks.push('migration-and-replay', 'history-preserved-no-invented-requests-effects');
      const requestAudit = await audit('PAYMENT_REVERSAL_REQUESTED'), requestId = crypto.randomUUID();
      const insert = (key, reqId = requestId, receipt = '{}', reviewNote = null) => client.query(
        'INSERT INTO payment_reversal_requests(id,request_key,payment_id,active_payment_id,requested_by,reason_category,reason,fingerprint,original_payment_json,request_receipt_json,request_audit_id,original_audit_id,review_note) VALUES ($1,$2,$3,$3,$4,\'registration_error\',\'original error\',$5,\'{}\',$6,$7,$8,$9)',
        [reqId, key, payment, requester, 'a'.repeat(64), receipt, requestAudit, originalAudit, reviewNote]);
      for (const [key, receipt, note] of [['short', '{}', null], ['bad/key-name', '{}', null], ['valid-request-key', '[]', null], ['valid-request-key', '{}', 'pre-reviewed request']])
        await assert.rejects(insert(key, requestId, receipt, note), { code: '23514' });
      await insert('valid-request-key');
      await assert.rejects(insert('another-request-key', crypto.randomUUID()), { code: '23505' }); r.checks.push('one-active-request-identity-and-pending-shape');
      const reviewAudit = await audit('PAYMENT_REVERSED', reviewer), effectId = crypto.randomUUID();
      const effect = (user = reviewer, amount = -300) => client.query('INSERT INTO payment_reversals(id,payment_id,request_id,posted_by,audit_id,amount,currency,before_state_json,after_state_json,receipt_json) VALUES ($1,$2,$3,$4,$5,$6,\'CNY\',\'{}\',\'{}\',\'{}\')',
        [effectId, payment, requestId, user, reviewAudit, amount]);
      await assert.rejects(effect(requester), { code: '23514' }); await assert.rejects(effect(reviewer, -299), { code: '23514' });
      await client.query('BEGIN'); await effect();
      await client.query('UPDATE payment_reversal_requests SET status=\'posted\',active_payment_id=NULL,review_key=\'valid-review-key\',review_fingerprint=$1,reviewed_by=$2,review_note=\'independent review\',review_audit_id=$3,review_receipt_json=\'{}\',reviewed_at=CURRENT_TIMESTAMP WHERE id=$4', ['b'.repeat(64), reviewer, reviewAudit, requestId]);
      await client.query("UPDATE payment_records SET status='reversed' WHERE id=$1", [payment]); await client.query('COMMIT');
      r.checks.push('independent-full-reversal-only');
      const immutable = async () => ({ history: await history(), requests: (await client.query('SELECT * FROM payment_reversal_requests')).rows, effects: (await client.query('SELECT * FROM payment_reversals')).rows });
      const frozen = await immutable();
      for (const query of ["UPDATE payment_reversal_requests SET reason='modified history'", 'DELETE FROM payment_reversal_requests',
        'UPDATE payment_reversals SET amount=-1', 'DELETE FROM payment_reversals', "UPDATE payment_records SET amount=301",
        'UPDATE payment_records SET verified_by=NULL', "UPDATE payment_records SET status='verified'", 'UPDATE payment_records SET date=CURRENT_TIMESTAMP',
        "UPDATE audit_logs SET details='changed audit'", 'DELETE FROM audit_logs']) await assert.rejects(client.query(query), { code: '23514' });
      await assert.rejects(client.query('DELETE FROM payment_records'), { code: '23503' });
      await assert.rejects(client.query('DELETE FROM users WHERE id=$1', [reviewer]), { code: '23503' });
      assert.deepEqual(await immutable(), frozen); r.checks.push('original-payment-request-effect-audit-immutable', 'parent-deletion-restricted');
      await client.query(sql); assert.deepEqual(await immutable(), frozen); r.checks.push('replayed-migration-preserves-terminal-facts');
      r.constraints = (await client.query("SELECT conrelid::regclass::text as table_name,conname,contype,convalidated FROM pg_constraint WHERE conrelid IN ('payment_reversal_requests'::regclass,'payment_reversals'::regclass) ORDER BY conname")).rows;
      assert(r.constraints.filter(c => c.contype === 'f').length >= 8 && r.constraints.every(c => c.convalidated));
      r.status = 'passed';
    } catch (error) { r.status = 'failed'; r.error = error.message; r.sqlState = error.code || null; }
    finally {
      if (created) { try { await client.query(`DROP SCHEMA "${schema}" CASCADE`); r.fixtureRemoved = true; } catch { r.fixtureRemoved = false; r.status = 'failed'; } }
      await client.end(); save();
    }
  }
  report.status = report.cases.length === 2 && report.cases.every(r => r.status === 'passed' && r.fixtureRemoved) ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ ...report, reportPath: path.join(folder, 'report.json') }));
  if (report.status !== 'passed') process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
