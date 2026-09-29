// Extends the cumulative SQLite legacy rehearsal on a fresh copy only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
async function main() {
  const root=path.resolve(__dirname,'..'), source=path.resolve(process.argv[2] || ''), target=path.resolve(process.argv[3] || '');
  const evidenceRoot=path.join(root,'output','round2')+path.sep;
  assert(target.startsWith(evidenceRoot) && source.startsWith(evidenceRoot) && target!==source && !fs.existsSync(target),'Only a new isolated fixture copy is allowed');
  const original=new DatabaseSync(source,{readOnly:true});await backup(original,target);original.close();
  const fixture=new DatabaseSync(target);
  fixture.exec('PRAGMA foreign_keys=OFF');
  assert.equal(fixture.prepare('SELECT COUNT(*) n FROM material_packaging_revisions').get().n,0);
  assert.equal(fixture.prepare('SELECT COUNT(*) n FROM production_boms WHERE packaging_revision_id IS NOT NULL OR packaging_snapshot_json IS NOT NULL').get().n,0);

  // SQLite cannot DROP a column used by a table-level FK. Rebuild only the
  // disposable copy, preserving every legacy column, row, index and FK.
  const ddl=fixture.prepare("SELECT sql FROM sqlite_master WHERE name='production_boms'").get().sql;
  const removed=ddl.split('\n').filter(line=>line.includes('packaging_revision_id')||line.includes('packaging_snapshot_json'));
  assert.equal(removed.length,3,'Expected exactly two new columns and one named FK');
  const legacyDdl=ddl.split('\n').filter(line=>!removed.includes(line)).join('\n').replace('CREATE TABLE "production_boms"','CREATE TABLE "legacy_production_boms"');
  const indices=fixture.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='production_boms' AND sql IS NOT NULL").all();
  const legacyColumns=fixture.prepare('PRAGMA table_info(production_boms)').all().map(c=>c.name).filter(c=>!['packaging_revision_id','packaging_snapshot_json'].includes(c));
  const columnList=legacyColumns.map(c=>'"'+c+'"').join(',');
  const oldRows=fixture.prepare('SELECT '+columnList+' FROM production_boms ORDER BY id').all();
  fixture.exec('BEGIN;'+legacyDdl+'; INSERT INTO legacy_production_boms ('+columnList+') SELECT '+columnList+' FROM production_boms; DROP TABLE production_boms; ALTER TABLE legacy_production_boms RENAME TO production_boms;'+indices.map(i=>i.sql+';').join('')+'DROP TABLE material_packaging_revisions; COMMIT;');
  assert.deepEqual(fixture.prepare('SELECT '+columnList+' FROM production_boms ORDER BY id').all(),oldRows);

  const user=fixture.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();assert(user);
  fixture.prepare('INSERT INTO production_boms (bom_no,product_name,version,output_unit,shelf_life_days,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('LEGACY-PACK-GUARD','Legacy unconverted formula','v1','桶',365,user.id,Date.now(),Date.now());
  const tables=fixture.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  const quote=s=>'"'+s.replaceAll('"','""')+'"';
  const columns=Object.fromEntries(tables.map(t=>[t,fixture.prepare(`PRAGMA table_info(${quote(t)})`).all().map(c=>c.name)]));
  const snapshot=db=>tables.map(t=>({table:t,rows:db.prepare(`SELECT ${columns[t].map(quote).join(',')} FROM ${quote(t)} ORDER BY rowid`).all()}));
  const before=snapshot(fixture);fixture.close();
  Object.assign(process.env,{NODE_ENV:'test',AILAODA_DEPLOYMENT_MODE:'local',DATABASE_URL:'file:'+target.replaceAll('\\','/'),AILAODA_RUNTIME_DB_PATH:target});
  const prisma=require(path.join(root,'backend/dist/config/database.js')).default;
  const {repairPackagingSchema}=require(path.join(root,'backend/dist/database/runtime-schema-packaging-repair.js'));
  const report={status:'running',source,target,fixtureKind:'full synthetic legacy copy; new packaging schema removed only from this disposable copy'};
  try {
    report.first={entries:[]};await repairPackagingSchema(report.first);report.second={entries:[]};await repairPackagingSchema(report.second);
    const checked=new DatabaseSync(target,{readOnly:true});
    try {assert.deepEqual(snapshot(checked),before);assert.equal(checked.prepare('SELECT COUNT(*) n FROM material_packaging_revisions').get().n,0);
      assert.equal(checked.prepare('SELECT COUNT(*) n FROM production_boms WHERE packaging_revision_id IS NOT NULL OR packaging_snapshot_json IS NOT NULL').get().n,0);
      assert.equal(checked.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(checked.prepare('PRAGMA foreign_key_check').all(),[]);
      Object.assign(report,{status:'passed',originalTablesUnchanged:tables.length,repeatedRepairIdempotent:true,legacyBomsNotReinterpreted:true,integrity:'ok'});
    } finally {checked.close();}
  } finally {await prisma.$disconnect();fs.writeFileSync(target+'.json',JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
