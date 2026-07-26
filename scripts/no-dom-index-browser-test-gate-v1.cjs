const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const PATTERNS = [/\.nth\s*\(/, /inputValues\s*\[/, /querySelectorAll\(\s*['"]input['"]\s*\)/];
const WHITELIST = new Set([
  'browser-runtime-probe.cjs',
  'browser-spawn-policy-probe.cjs',
]);

function listGovernedBrowserScripts() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const referenced = new Set();
  for (const command of Object.values(packageJson.scripts || {})) {
    for (const match of String(command).matchAll(/(?:\.\\|\.\/)?scripts[\\/](?<file>[A-Za-z0-9_.-]+\.(?:cjs|mjs|js|tsx|ts|ps1))/g)) {
      if (match.groups?.file) referenced.add(match.groups.file);
    }
  }
  return fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.cjs'))
    .map((entry) => entry.name)
    .filter((file) => /browser/i.test(file))
    .filter((file) => referenced.has(file))
    .map((file) => path.join(SCRIPTS_DIR, file));
}

function main() {
  const files = listGovernedBrowserScripts();
  const violations = [];
  const skippedFiles = [];

  for (const file of files) {
    if (WHITELIST.has(path.basename(file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of PATTERNS) {
      if (pattern.test(text)) {
        violations.push({
          file: path.relative(ROOT, file).split(path.sep).join('/'),
          pattern: pattern.source,
        });
      }
    }
  }

  for (const entry of fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.cjs') || !/browser/i.test(entry.name)) continue;
    if (files.some((file) => path.basename(file) === entry.name)) continue;
    skippedFiles.push(entry.name);
  }

  const report = {
    status: violations.length ? 'failed' : 'passed',
    scannedFiles: files.length,
    scannedScriptNames: files.map((file) => path.basename(file)).sort(),
    skippedFiles: skippedFiles.sort(),
    violations,
  };

  console.log(JSON.stringify(report, null, 2));
  if (violations.length) process.exitCode = 1;
}

main();
