const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
async function main(){
  const root=path.resolve(__dirname,'..'),source=path.resolve(process.argv[2]||''),target=path.resolve(process.argv[3]||'');
  const allowed=path.join(root,'output','round2')+path.sep;
  assert(source.startsWith(allowed)&&target.startsWith(allowed)&&source!==target&&!fs.existsSync(target),'Only a fresh isolated copy is allowed');
  const original=new DatabaseSync(source,{readOnly:true});await backup(original,target);original.close();
  const fixture=new DatabaseSync(target);assert.equal(fixture.prepare('SELECT COUNT(*) n FROM material_density_revisions').get().n,0);
  // No existing table references this evidence table. Remove only from the new synthetic copy.
  fixture.exec('DROP TABLE material_density_revisions');
  const user=fixture.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();assert(user);
  fixture.prepare('INSERT INTO production_boms (bom_no,product_name,version,output_unit,shelf_life_days,density,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run('LEGACY-DENSITY-GUARD','Legacy descriptive density','v1','kg',365,1.12,user.id,Date.now(),Date.now());
  const tables=fixture.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const quote=s=>'"'+s.replaceAll('"','""')+'"';
  const snapshot=db=>tables.map(t=>({table:t,rows:db.prepare(`SELECT * FROM ${quote(t)} ORDER BY rowid`).all()}));
  const before=snapshot(fixture);fixture.close();
  Object.assign(process.env,{NODE_ENV:'test',AILAODA_DEPLOYMENT_MODE:'local',DATABASE_URL:'file:'+target.replaceAll('\\','/'),AILAODA_RUNTIME_DB_PATH:target});
  const prisma=require(path.join(root,'backend/dist/config/database.js')).default;
  const {repairDensitySchema}=require(path.join(root,'backend/dist/database/runtime-schema-density-repair.js'));
  const report={status:'running',source,target,fixtureKind:'fresh synthetic legacy copy; only the empty density evidence table removed'};
  try{
    report.first={entries:[]};await repairDensitySchema(report.first);report.second={entries:[]};await repairDensitySchema(report.second);
    const checked=new DatabaseSync(target,{readOnly:true});try{
      assert.deepEqual(snapshot(checked),before);assert.equal(checked.prepare('SELECT COUNT(*) n FROM material_density_revisions').get().n,0);
      assert.equal(checked.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(checked.prepare('PRAGMA foreign_key_check').all(),[]);
      Object.assign(report,{status:'passed',originalTablesUnchanged:tables.length,repeatedRepairIdempotent:true,legacyDensityNotInferred:true,integrity:'ok'});
    }finally{checked.close();}
  }finally{await prisma.$disconnect();fs.writeFileSync(target+'.json',JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
