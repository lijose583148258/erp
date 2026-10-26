const fs = require('fs');
const path = require('path');

const normalizeSqlitePath = (value, cwd) => {
  const raw = String(value || '').replace(/^file:/i, '').replace(/\\/g, '/');
  if (!raw) return '';
  return path.isAbsolute(raw) || /^[a-z]:\//i.test(raw) ? path.normalize(raw) : path.resolve(cwd, raw);
};

function resolveAuditDatabaseContext(env = process.env, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const requireExistingSqlite = options.requireExistingSqlite !== false;
  const originReport = path.resolve(
    options.originReport || path.join(cwd, 'output', 'audit', 'stable-runtime-origin-v1.json'),
  );

  let databaseUrl = String(env.DATABASE_URL || '').trim();
  let source = databaseUrl ? 'DATABASE_URL' : '';

  if (!databaseUrl && env.AILAODA_RUNTIME_DB_PATH) {
    databaseUrl = `file:${String(env.AILAODA_RUNTIME_DB_PATH).replace(/\\/g, '/')}`;
    source = 'AILAODA_RUNTIME_DB_PATH';
  }

  if (!databaseUrl && fs.existsSync(originReport)) {
    const origin = JSON.parse(fs.readFileSync(originReport, 'utf8').replace(/^\uFEFF/, ''));
    if (origin?.runtimeDbPath) {
      databaseUrl = `file:${String(origin.runtimeDbPath).replace(/\\/g, '/')}`;
      source = 'stable-runtime-origin';
    }
  }

  if (!databaseUrl) {
    throw new Error('No governed audit database is available. Set DATABASE_URL/AILAODA_RUNTIME_DB_PATH or start the stable runtime first.');
  }

  if (!/^file:/i.test(databaseUrl)) {
    return { databaseUrl, provider: 'postgresql', runtimeDbPath: null, source, originReport };
  }

  const runtimeDbPath = normalizeSqlitePath(databaseUrl, cwd);
  if (!runtimeDbPath) throw new Error('SQLite audit DATABASE_URL has no path.');
  if (requireExistingSqlite && !fs.existsSync(runtimeDbPath)) {
    throw new Error(`Governed audit SQLite database does not exist: ${runtimeDbPath}`);
  }

  return {
    databaseUrl: `file:${runtimeDbPath.replace(/\\/g, '/')}`,
    provider: 'sqlite',
    runtimeDbPath,
    source,
    originReport,
  };
}

function applyAuditDatabaseContext(env = process.env, options = {}) {
  const context = resolveAuditDatabaseContext(env, options);
  env.DATABASE_URL = context.databaseUrl;
  return context;
}

module.exports = {
  applyAuditDatabaseContext,
  normalizeSqlitePath,
  resolveAuditDatabaseContext,
};
