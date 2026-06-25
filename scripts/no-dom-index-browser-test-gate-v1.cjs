const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const PATTERNS = [/\.nth\s*\(/, /inputValues\s*\[/, /querySelectorAll\(\s*['"]input['"]\s*\)/];
const WHITELIST = new Set([
  'browser-runtime-probe.cjs',
]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.cjs')) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  const files = walk(SCRIPTS_DIR).filter((file) => /browser/i.test(path.basename(file)));
  const violations = [];

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

  const report = {
    status: violations.length ? 'failed' : 'passed',
    scannedFiles: files.length,
    violations,
  };

  console.log(JSON.stringify(report, null, 2));
  if (violations.length) process.exitCode = 1;
}

main();
