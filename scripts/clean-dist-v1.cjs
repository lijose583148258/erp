const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIST_DIR = path.resolve(ROOT, 'dist');
const EXPECTED = path.resolve(ROOT, 'dist');

function fail(message) {
  console.error(JSON.stringify({ status: 'failed', message }, null, 2));
  process.exit(1);
}

if (DIST_DIR !== EXPECTED) {
  fail(`Refusing to clean unexpected dist path: ${DIST_DIR}`);
}

if (!DIST_DIR.startsWith(`${path.resolve(ROOT)}${path.sep}`)) {
  fail(`Refusing to clean path outside workspace: ${DIST_DIR}`);
}

if (DIST_DIR === path.resolve(ROOT) || path.parse(DIST_DIR).root === DIST_DIR) {
  fail(`Refusing to clean unsafe root path: ${DIST_DIR}`);
}

if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}

if (fs.existsSync(DIST_DIR) && fs.readdirSync(DIST_DIR).length > 0) {
  fail(`Node clean did not fully remove dist. Use scripts/clean-dist-v1.ps1 on this Windows workspace: ${DIST_DIR}`);
}

fs.mkdirSync(DIST_DIR, { recursive: true });
console.log(JSON.stringify({ status: 'passed', cleaned: DIST_DIR }, null, 2));
