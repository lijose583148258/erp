const { spawnSync } = require('child_process');

function run(script, extraEnv = {}) {
  const result = spawnSync('node', [script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return false;
  }
  return true;
}

const ok = run('scripts/unsaved-changes-browser-audit-v1.cjs', {
  AILAODA_UNSAVED_GUARD_CONTEXT: 'production',
});

if (ok) {
  run('scripts/production-save-readback-contract-audit-v1.cjs');
}
