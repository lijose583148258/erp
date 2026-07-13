const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const outputRoot = path.join(root, 'output', 'audit', 'csp-browser-runtime-v1');
const result = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'parallel-isolated-playwright-audit-v1.cjs')],
  {
    cwd: root,
    env: {
      ...process.env,
      APP_URL: process.env.APP_URL || 'http://127.0.0.1:5001/',
      ISOLATED_PLAYWRIGHT_ROUTES_FILE: 'scripts/audit-routes/csp-runtime-routes.cjs',
      ISOLATED_PLAYWRIGHT_OUTPUT_ROOT: outputRoot,
      ISOLATED_PLAYWRIGHT_WORKERS: '1',
      ISOLATED_PLAYWRIGHT_FAIL_ON_CONSOLE_ERRORS: '1',
      ISOLATED_PLAYWRIGHT_FAIL_ON_HTTP_FAILURES: '1',
    },
    encoding: 'utf8',
    windowsHide: true,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

console.log(`CSP Browser Runtime Audit: PASS (${outputRoot})`);
