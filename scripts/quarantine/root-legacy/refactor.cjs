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
  const p = `scripts/${file}`;
  if (!fs.existsSync(p)) continue;
  let content = fs.readFileSync(p, 'utf8');

  // 1. replace require
  content = content.replace(
    /const { chromium } = require\('playwright'\);/g,
    `const { launchBrowserWithGuard, markReportFromLaunchError } = require('./lib/browser-launch-guard.cjs');`
  );

  // 2. handle chromium.launch variants
  content = content.replace(
    /let browser;\s*let page = null;\s*try {\s*browser = await chromium\.launch\({ headless: true }\);/g,
    `let browser = null;\n  let page = null;\n  try {\n    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });\n    browser = launched.browser;\n    report.launcher = launched.launcher;`
  );

  content = content.replace(
    /const browser = await chromium\.launch\({ headless: true }\);\s*const page = await browser\.newPage\(\{ viewport: \{ width: 1600, height: 1200 \} \}\);\s*try {/g,
    `let browser = null;\n  try {\n    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });\n    browser = launched.browser;\n    report.launcher = launched.launcher;\n    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });`
  );

  content = content.replace(
    /let browser = null;\s*try {\s*browser = await chromium\.launch\({ headless: true }\);/g,
    `let browser = null;\n  try {\n    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });\n    browser = launched.browser;\n    report.launcher = launched.launcher;`
  );

  // 3. handle catch block
  content = content.replace(
    /catch \(error\) {\s*report\.status = 'failed';\s*report\.error = String\(error\.message \|\| error\);\s*(?:process\.exitCode = 1;\s*)?}/g,
    `catch (error) {\n    markReportFromLaunchError(report, error);\n    if (report.status !== 'blocked_env') {\n      process.exitCode = 1;\n    }\n  }`
  );

  // 4. handle exit block and finally block
  content = content.replace(
    /finally {\s*report\.finishedAt = new Date\(\)\.toISOString\(\);\s*fs\.writeFileSync\(REPORT_PATH, JSON\.stringify\(report, null, 2\), 'utf8'\);\s*await browser\.close\(\);\s*}/g,
    `finally {\n    report.finishedAt = new Date().toISOString();\n    if (browser) await browser.close().catch(() => {});\n    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');\n  }`
  );

  content = content.replace(
    /if \(report\.status !== 'passed'\) {\s*console\.error\([^)]+\);\s*process\.exit\(1\);\s*}/g,
    `if (report.status !== 'passed') {\n    console.error(report.error || 'Audit failed');\n    if (report.status !== 'blocked_env') {\n      process.exit(1);\n    }\n    console.warn(\`Audit blocked by env. Report: \${REPORT_PATH}\`);\n    return;\n  }`
  );

  fs.writeFileSync(p, content, 'utf8');
}
