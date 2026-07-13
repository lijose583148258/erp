const { spawnSync } = require('child_process');

const result = spawnSync('node', ['scripts/production-save-readback-contract-audit-v1.cjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});

process.exitCode = result.status ?? 1;
