const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { assertQcIsolationCase, qcIsolationProbe } = require('./lib/enterprise-round2-qc-isolation.cjs');
const { qcReleaseBrowser } = require('./lib/enterprise-round2-qc-browser.cjs');
function held() {
  const before = { batch: { qualityStatus:'quarantine' }, stock:{id:1,quantity:100},workOrder:{id:2,status:'qc_pending'},costs:[{costAmountDelta:1000}],movements:[],audits:[] };
  return { state:'quarantine',before,after:structuredClone(before),requests:[{name:'consume',status:409}],readbacks:[0,1].map(()=>({workOrder:{status:'qc_pending'},stock:[{id:1,quantity:100}]})) };
}
test('QC probes load without browser/database dependencies in source-only CI',()=>{ assert.equal(typeof qcIsolationProbe,'function');assert.equal(typeof qcReleaseBrowser,'function'); });
test('held stock needs an unchanged transaction and two real readbacks',()=>assert.doesNotThrow(()=>assertQcIsolationCase(held())));
for(const [name,change] of [
  ['HTTP 200 with unchanged inventory',c=>{c.requests[0].status=200;}],
  ['partial cost debit despite rejection',c=>{c.after.costs.push({costAmountDelta:-100});}],
  ['phantom audit',c=>{c.after.audits.push({id:1});}],
  ['missing second instance',c=>{c.readbacks.pop();}],
  ['stale API state',c=>{c.readbacks[1].stock[0].quantity=90;}],
]) test(`reject false green: ${name}`,()=>{const c=held();change(c);assert.throws(()=>assertQcIsolationCase(c));});
test('QC source and UI changes trigger cumulative cloud replay',()=>{
  const w=fs.readFileSync(path.join(__dirname,'../.github/workflows/enterprise-cloud-sandbox.yml'),'utf8').split('  pull_request:')[1].split('  push:')[0];
  for(const f of ['scripts/lib/enterprise-round2-qc*.cjs','backend/src/services/stock-quality-issue*.ts','backend/src/services/production-quality*.ts','pages/production/ProductionQualityInspectionPanel.tsx']) assert(w.includes(`'${f}'`),f);
});
