const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const DIST_DIR = path.resolve(ROOT, 'dist');
const EXPECTED = path.resolve(ROOT, 'dist');
const TRASH_DIR = path.resolve(ROOT, `.dist-delete-${Date.now()}`);

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

function removeDir(target) {
  if (!fs.existsSync(target)) return;

  fs.rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

function waitUntilRemoved(target) {
  const deadline = Date.now() + 5000;
  while (fs.existsSync(target) && Date.now() < deadline) {
    removeDir(target);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

function runPowerShellFallback() {
  if (process.platform !== 'win32') return false;
  const psScript = path.join(ROOT, 'scripts', 'clean-dist-v1.ps1');
  if (!fs.existsSync(psScript)) return false;
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    psScript,
  ], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
  return result.status === 0;
}

if (fs.existsSync(DIST_DIR)) {
  try {
    removeDir(DIST_DIR);
    waitUntilRemoved(DIST_DIR);
  } catch {
    if (fs.existsSync(TRASH_DIR)) removeDir(TRASH_DIR);
    fs.renameSync(DIST_DIR, TRASH_DIR);
    removeDir(TRASH_DIR);
    waitUntilRemoved(TRASH_DIR);
  }
}

if (fs.existsSync(DIST_DIR) && fs.readdirSync(DIST_DIR).length > 0) {
  if (runPowerShellFallback() && (!fs.existsSync(DIST_DIR) || fs.readdirSync(DIST_DIR).length === 0)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    console.log(JSON.stringify({ status: 'passed', cleaned: DIST_DIR, fallback: 'powershell' }, null, 2));
    process.exit(0);
  }
  fail(`Node clean did not fully remove dist. Use scripts/clean-dist-v1.ps1 on this Windows workspace: ${DIST_DIR}`);
}

fs.mkdirSync(DIST_DIR, { recursive: true });
console.log(JSON.stringify({ status: 'passed', cleaned: DIST_DIR }, null, 2));
