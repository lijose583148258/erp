type ProbeMode = 'strict' | 'fallback';

const mode = (process.env.AILAODA_CASBIN_FALLBACK_PROBE_MODE || 'strict') as ProbeMode;

async function main() {
  const database = await import('../../backend/src/config/database.ts');
  const prisma = database.default;
  const authorization = await import('../../backend/src/permissions/casbinAuthorization.ts');
  const { casbinAllowsPermission, resetAuthorizationEnforcer } = authorization;
  resetAuthorizationEnforcer();

  let allowed = false;
  let errorMessage: string | null = null;

  try {
    allowed = await casbinAllowsPermission('admin', 'dashboard.read');
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (prisma && typeof prisma.$disconnect === 'function') {
      await prisma.$disconnect();
    }
  }

  const result = {
    mode,
    nodeEnv: process.env.NODE_ENV || null,
    allowFallback: process.env.AILAODA_ALLOW_RBAC_FALLBACK || null,
    allowed,
    errorMessage,
  };

  console.log(JSON.stringify(result, null, 2));

  if (mode === 'strict') {
    if (!errorMessage || allowed) {
      throw new Error('Strict production RBAC should fail closed when dynamic tables are unavailable.');
    }
    return;
  }

  if (mode === 'fallback') {
    if (errorMessage || !allowed) {
      throw new Error('Explicit RBAC fallback should allow built-in admin dashboard.read.');
    }
    return;
  }

  throw new Error(`Unsupported probe mode: ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
