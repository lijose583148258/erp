const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyAuditDatabaseContext, resolveAuditDatabaseContext } = require('./audit-runtime-context.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailao-audit-runtime-context-'));
const dbPath = path.join(root, 'runtime.db');
fs.writeFileSync(dbPath, 'fixture');
const originPath = path.join(root, 'origin.json');
fs.writeFileSync(originPath, JSON.stringify({ runtimeDbPath: dbPath }), 'utf8');

assert.equal(resolveAuditDatabaseContext({ DATABASE_URL: `file:${dbPath}` }, { cwd: root }).source, 'DATABASE_URL');
assert.equal(resolveAuditDatabaseContext({ AILAODA_RUNTIME_DB_PATH: dbPath }, { cwd: root }).source, 'AILAODA_RUNTIME_DB_PATH');
assert.equal(resolveAuditDatabaseContext({}, { cwd: root, originReport: originPath }).source, 'stable-runtime-origin');
assert.equal(resolveAuditDatabaseContext({ DATABASE_URL: 'postgresql://db.test/erp' }, { cwd: root }).provider, 'postgresql');
assert.throws(() => resolveAuditDatabaseContext({}, { cwd: root, originReport: path.join(root, 'missing.json') }), /No governed audit database/);
assert.throws(() => resolveAuditDatabaseContext({ DATABASE_URL: 'file:missing.db' }, { cwd: root }), /does not exist/);
const env = { AILAODA_RUNTIME_DB_PATH: dbPath };
assert.equal(applyAuditDatabaseContext(env, { cwd: root }).databaseUrl, env.DATABASE_URL);

fs.rmSync(root, { recursive: true, force: true });
console.log('Audit runtime context contract: PASS');
