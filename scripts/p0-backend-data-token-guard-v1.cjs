const fs = require('fs');

const findings = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function add(file, message) {
  findings.push({ file, message });
}

const runtimeRepair = read('backend/src/database/runtime-data-repair.ts');
if (!/AILAODA_ALLOW_DEMO_DATA_REPAIR/.test(runtimeRepair)) {
  add('backend/src/database/runtime-data-repair.ts', 'fixed-id demo data repair is not guarded by AILAODA_ALLOW_DEMO_DATA_REPAIR');
}
if (/export const repairRuntimeData[\s\S]*await repairSupplier\(report,\s*5,[\s\S]*?await repairProductionStep\(report,\s*1,/m.test(runtimeRepair)
  && !/if \(ALLOW_DEMO_DATA_REPAIR\)/.test(runtimeRepair)) {
  add('backend/src/database/runtime-data-repair.ts', 'fixed-id demo data repair appears to run unconditionally');
}

const auth = read('backend/src/middleware/auth.ts');
if (/query\.token/.test(auth) || /req\.query\[['"]token['"]\]/.test(auth)) {
  add('backend/src/middleware/auth.ts', 'query token authentication is still enabled');
}

const audit = read('backend/src/middleware/auditMiddleware.ts');
if (!/sanitizeUrl/.test(audit) || !/\[redacted\]/.test(audit)) {
  add('backend/src/middleware/auditMiddleware.ts', 'audit middleware does not redact sensitive query parameters');
}

const result = {
  status: findings.length ? 'failed' : 'passed',
  findings,
};

console.log(JSON.stringify(result, null, 2));
process.exit(findings.length ? 1 : 0);
