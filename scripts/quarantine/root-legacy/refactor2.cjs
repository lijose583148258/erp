const fs = require('fs');

console.error('[legacy one-off refactor disabled] This historical script rewrites browser audit files. Use the current guarded audit scripts directly.');
process.exit(1);

const files = [
  'barter-browser-audit-v2.cjs',
  'barter-agreement-browser-audit-v1.cjs',
  'browser-focused-audit-v2.cjs',
  'browser-acceptance-audit.cjs',
  'browser-acceptance-audit-v2.cjs',
  'browser-acceptance-audit-v3.cjs',
];

for (const file of files) {
  const p = 'scripts/' + file;
  if (!fs.existsSync(p)) {
      console.log('Not found:', p);
      continue;
  }
  let content = fs.readFileSync(p, 'utf8');

  // 1. replace require
  content = content.replace(
    /const \{\s*chromium\s*\}\s*=\s*require\('playwright'\);/g,
    `const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');`
  );

  // 2. handle chromium.launch variants
  content = content.replace(
    /browser\s*=\s*await\s*chromium\.launch\(\{\s*headless:\s*true\s*\}\);/g,
    `const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;`
  );

  content = content.replace(
    /const\s*browser\s*=\s*await\s*chromium\.launch\(\{\s*headless:\s*true\s*\}\);/g,
    `const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
  const browser = launched.browser;
  report.launcher = launched.launcher;`
  );

  // 3. catch block that previously just set report.error
  content = content.replace(
    /catch\s*\(([^)]+)\)\s*\{\s*report\.status\s*=\s*'failed';\s*report\.error\s*=\s*String\([^)]+\.message\s*\|\|\s*[^)]+\);\s*\}/g,
    `catch ($1) {
    if (typeof markReportFromLaunchError === 'function') markReportFromLaunchError(report, $1);
    else report.error = String($1.message || $1);
  }`
  );
  
  // also handle catch blocks that include exitCode = 1
  content = content.replace(
    /catch\s*\(([^)]+)\)\s*\{\s*report\.status\s*=\s*'failed';\s*report\.error\s*=\s*String\([^)]+\.message\s*\|\|\s*[^)]+\);\s*process\.exitCode\s*=\s*1;\s*\}/g,
    `catch ($1) {
    if (typeof markReportFromLaunchError === 'function') markReportFromLaunchError(report, $1);
    else report.error = String($1.message || $1);
    
    if (report.status !== 'blocked_env') {
      process.exitCode = 1;
    }
  }`
  );

  // 4. block exit if blocked_env 
  content = content.replace(
    /if\s*\(report\.status\s*!==\s*'passed'\)\s*\{\s*console\.error\([^)]+\);\s*process\.exit\(\d+\);\s*\}/g,
    `if (report.status !== 'passed') {
    if (report.status === 'blocked_env') {
      console.warn('Audit blocked by environment (EPERM).');
      return;
    }
    console.error(report.error || 'Audit failed');
    process.exit(1);
  }`
  );

  // 5. exitCode = 1 removal if blocked_env finally block
  content = content.replace(
    /finally\s*\{/g,
    `finally {\n    if (report && report.status === 'blocked_env' && process && process.exitCode === 1) process.exitCode = 0;`
  );

  fs.writeFileSync(p, content, 'utf8');
  console.log('Refactored', file);
}
