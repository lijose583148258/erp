const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), { Client } = require(path.join(root, 'backend/node_modules/pg'));
async function main() {
  assert.equal(process.env.PAYMENT_MIGRATION_ALLOW_FIXTURES, 'true');
  const base = new URL(process.env.PAYMENT_MIGRATION_DATABASE_URL || '');
  assert(['postgres:', 'postgresql:'].includes(base.protocol)); assert(['127.0.0.1','localhost','[::1]'].includes(base.hostname));
  const id = crypto.randomBytes(6).toString('hex'), folder = path.join(root, 'output/payment-submission-migration', id);
  fs.mkdirSync(folder, { recursive: true });
  const sql = fs.readFileSync(path.join(root, 'backend/prisma/postgres-migrations/202610030001_payment-submission-identities/migration.sql'), 'utf8');
  const report = { version: 'payment-submission-migration/v1', status: 'running', startedAt: new Date().toISOString(),
    runId: id, migrationSha256: crypto.createHash('sha256').update(sql).digest('hex'), cases: [] };
  const save = () => { const json=JSON.stringify(report,null,2); fs.writeFileSync(path.join(folder,'report.json'),json);
    fs.mkdirSync(path.join(root,'output/audit'),{recursive:true}); fs.writeFileSync(path.join(root,'output/audit/payment-submission-migration-v1.json'),json); };
  save();
  for (const scenario of ['bootstrap','upgrade']) {
    const schema = `payment_submission_${scenario}_${id}`;
    assert(/^payment_submission_(bootstrap|upgrade)_[a-f0-9]{12}$/.test(schema));
    const url = new URL(base); url.searchParams.set('schema',schema); url.searchParams.set('options',`-c search_path=${schema}`);
    const client = new Client({connectionString:url.href,connectionTimeoutMillis:5000});
    const r = { scenario, schema, status:'running', checks:[] }; report.cases.push(r); let created=false;
    try {
      const dir=path.join(folder,scenario,'prisma'), models=path.join(dir,'models'); fs.mkdirSync(models,{recursive:true});
      for (const name of fs.readdirSync(path.join(root,'backend/prisma/models')).filter(n=>n.endsWith('.prisma'))) {
        if (scenario==='upgrade' && name==='payment-submissions.prisma') continue;
        let source=fs.readFileSync(path.join(root,'backend/prisma/models',name),'utf8');
        if (scenario==='upgrade') source=source.replace(/^\s*paymentSubmissions PaymentSubmission\[\]\r?\n/m,'\n').replace(/^\s*submission PaymentSubmission\?\r?\n/m,'\n');
        fs.writeFileSync(path.join(models,name),source);
      }
      const entry=fs.readFileSync(path.join(root,'backend/prisma/schema.prisma'),'utf8'); assert(entry.includes('provider = "sqlite"'));
      fs.writeFileSync(path.join(dir,'schema.prisma'),entry.replace('provider = "sqlite"','provider = "postgresql"'));
      await client.connect(); await client.query("SET statement_timeout = '30s'"); await client.query(`CREATE SCHEMA "${schema}"`); created=true;
      assert.equal((await client.query('SELECT current_schema() name')).rows[0].name,schema);
      const log=execFileSync(process.execPath,[path.join(root,'backend/node_modules/prisma/build/index.js'),'db','push','--schema',dir,'--skip-generate'],
        {cwd:root,env:{...process.env,DATABASE_URL:url.href},timeout:60000,windowsHide:true,encoding:'utf8',stdio:'pipe'});
      fs.writeFileSync(path.join(folder,`${scenario}.log`),log); r.checks.push('real-prisma-db-push');
      assert.equal((await client.query("SELECT to_regclass('payment_submissions') name")).rows[0].name!==null,scenario==='bootstrap');
      const user=(await client.query("INSERT INTO users(username,password_hash,role,updated_at) VALUES ('fixture','unused','finance',CURRENT_TIMESTAMP) RETURNING id")).rows[0].id;
      const customer=(await client.query("INSERT INTO customers(name,updated_at) VALUES ('legacy',CURRENT_TIMESTAMP) RETURNING id")).rows[0].id;
      const order=(await client.query("INSERT INTO orders(order_no,customer_id,created_by,total_amount,final_amount,updated_at) VALUES ('legacy', $1,$2,1000,1000,CURRENT_TIMESTAMP) RETURNING id",[customer,user])).rows[0].id;
      const makePayment=async()=> (await client.query("INSERT INTO payment_records(order_id,amount,method,updated_at) VALUES ($1,300,'bank_transfer',CURRENT_TIMESTAMP) RETURNING id",[order])).rows[0].id;
      const legacy=await makePayment();
      const history=async()=>({ payments:(await client.query('SELECT * FROM payment_records ORDER BY id')).rows,orders:(await client.query('SELECT * FROM orders ORDER BY id')).rows });
      const before=await history();
      await client.query('BEGIN'); try {await client.query(sql);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
      await client.query(sql); assert.deepEqual(await history(),before);
      assert.equal((await client.query('SELECT count(*)::int n FROM payment_submissions')).rows[0].n,0);
      r.checks.push('migration-and-replay','historical-payments-preserved-without-invented-identities'); r.historicalPaymentId=legacy;
      const payment=await makePayment(), other=await makePayment();
      const insert=(key,paymentId=payment,actor=user,fingerprint='a'.repeat(64),result='{"version":"fixture"}')=>client.query(
        'INSERT INTO payment_submissions(request_key,user_id,fingerprint,payment_id,result_json) VALUES ($1,$2,$3,$4,$5)',[key,actor,fingerprint,paymentId,result]);
      await insert('fixture-original-key'); const original=(await client.query('SELECT * FROM payment_submissions')).rows;
      await assert.rejects(insert('fixture-original-key',other),{code:'23505'}); await assert.rejects(insert('different-fixture-key'),{code:'23505'});
      for(const [key,hash,json] of [['short','a'.repeat(64),'{}'],['bad/key-fixture','a'.repeat(64),'{}'],['other-valid-key','x'.repeat(64),'{}'],['other-valid-key','a'.repeat(64),'[]']])
        await assert.rejects(insert(key,other,user,hash,json),{code:'23514'});
      await assert.rejects(insert('invalid-json-key',other,user,'a'.repeat(64),'not-json'),{code:'22P02'});
      await assert.rejects(insert('invalid-actor-key',other,2147483647),{code:'23503'});
      await assert.rejects(insert('invalid-payment-key',2147483647),{code:'23503'});
      await assert.rejects(client.query('UPDATE payment_submissions SET result_json=\'{}\''),{code:'23514'});
      await assert.rejects(client.query('DELETE FROM payment_submissions'),{code:'23514'});
      await assert.rejects(client.query('DELETE FROM payment_records WHERE id=$1',[payment]),{code:'23503'});
      await assert.rejects(client.query('DELETE FROM users WHERE id=$1',[user]),{code:'23503'});
      await client.query(sql); assert.deepEqual((await client.query('SELECT * FROM payment_submissions')).rows,original);
      const constraints=(await client.query("SELECT conname,contype,convalidated FROM pg_constraint WHERE conrelid='payment_submissions'::regclass ORDER BY conname")).rows;
      assert(constraints.some(c=>c.contype==='c')&&constraints.every(c=>c.convalidated));
      r.checks.push('request-and-payment-unique','key-fingerprint-json-object-checked','foreign-keys-enforced','append-only-update-delete-rejected','parent-payment-delete-restricted','replayed-migration-preserves-original-receipt');
      r.constraints=constraints; r.status='passed';
    } catch(error) {r.status='failed';r.error=error.message;r.sqlState=error.code||null;}
    finally {
      if(created) {try{await client.query(`DROP SCHEMA "${schema}" CASCADE`);r.fixtureRemoved=true;}catch{r.fixtureRemoved=false;r.status='failed';}}
      await client.end();save();
    }
  }
  report.status=report.cases.length===2&&report.cases.every(r=>r.status==='passed'&&r.fixtureRemoved)?'passed':'failed';
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({...report,reportPath:path.join(folder,'report.json')}));
  if(report.status!=='passed')process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
