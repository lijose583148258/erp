const { spawnSync } = require('child_process');

const result = spawnSync('node', ['scripts/unsaved-changes-browser-audit-v1.cjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
  env: {
    ...process.env,
    AILAODA_UNSAVED_GUARD_CONTEXT: 'production',
  },
});

process.exitCode = result.status ?? 1;
