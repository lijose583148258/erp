const GOVERNED_SHADOW_CLASSIFICATIONS = new Set([
  'legacy-tenant-demo',
  'legacy-prisma-db',
  'legacy-nested-backend-data',
  'bad-env-literal-runtime-path',
]);

function classifyShadowDb(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (/^backend\/prisma\/tenants\//.test(normalized)) return 'legacy-tenant-demo';
  if (/^backend\/prisma\//.test(normalized)) return 'legacy-prisma-db';
  if (/^backend\/backend\/data\//.test(normalized)) return 'legacy-nested-backend-data';
  if (/^backend\/%TEMP%\//.test(normalized)) return 'bad-env-literal-runtime-path';
  if (/^runtime-data\//.test(normalized)) return 'project-runtime-fallback';
  return 'unexpected-shadow-db';
}

function isGovernedShadowDb(relativePath) {
  return GOVERNED_SHADOW_CLASSIFICATIONS.has(classifyShadowDb(relativePath));
}

function shadowDbGovernanceNote(classification) {
  switch (classification) {
    case 'legacy-tenant-demo':
      return 'historical tenant demo database; must not be used by startup or migration chains';
    case 'legacy-prisma-db':
      return 'historical Prisma SQLite database; active runtime is outside backend/prisma';
    case 'legacy-nested-backend-data':
      return 'historical nested backend data database; current runtime path is governed separately';
    case 'bad-env-literal-runtime-path':
      return 'literal env placeholder database artifact; quarantined and must stay disconnected';
    default:
      return 'unrecognized database file; investigate before local soak or migration';
  }
}

module.exports = {
  GOVERNED_SHADOW_CLASSIFICATIONS,
  classifyShadowDb,
  isGovernedShadowDb,
  shadowDbGovernanceNote,
};
