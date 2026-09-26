const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
const BASELINE_PATH = path.join(ROOT, 'config', 'active-audit-hardcode-baseline.json');
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'active-audit-hardcode-ratchet-v1.json');
const SCRIPT_EXTENSIONS = new Set(['.cjs', '.mjs', '.js', '.ts', '.ps1']);
const INTENTIONAL_CREDENTIAL_SCANNERS = new Set([
  'scripts/active-audit-hardcode-ratchet-v1.cjs',
  'scripts/default-credential-release-gate-v1.cjs',
  'scripts/phase3-package-e-audit-v1.cjs',
  'scripts/full-codebase-audit-v1.cjs',
]);

const toPosix = (value) => value.replace(/\\/g, '/');
const relative = (value) => toPosix(path.relative(ROOT, value));

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

function resolveReference(rawReference, sourceFile) {
  const cleaned = String(rawReference || '').replace(/["'`]/g, '').replace(/\\/g, '/');
  const candidates = [];
  if (/^scripts\//i.test(cleaned)) candidates.push(path.resolve(ROOT, cleaned));
  if (/^\.\.?\//.test(cleaned)) candidates.push(path.resolve(path.dirname(sourceFile), cleaned));
  candidates.push(path.resolve(path.dirname(sourceFile), cleaned));
  candidates.push(path.resolve(SCRIPTS_DIR, cleaned.replace(/^scripts\//i, '')));
  return candidates.find((candidate) => candidate.startsWith(SCRIPTS_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function extractReferences(text, sourceFile) {
  const references = new Set();
  const pattern = /(?:\.{0,2}[\\/])?(?:scripts[\\/])?[A-Za-z0-9_@.\\/-]+\.(?:cjs|mjs|js|ts|ps1)/g;
  for (const match of text.matchAll(pattern)) {
    const resolved = resolveReference(match[0], sourceFile);
    if (resolved && SCRIPT_EXTENSIONS.has(path.extname(resolved).toLowerCase())) references.add(resolved);
  }
  return references;
}

function discoverRoots() {
  const roots = new Set();
  const packagePath = path.join(ROOT, 'package.json');
  const packageText = fs.readFileSync(packagePath, 'utf8');
  for (const reference of extractReferences(packageText, packagePath)) roots.add(reference);
  for (const workflow of walkFiles(WORKFLOWS_DIR)) {
    for (const reference of extractReferences(fs.readFileSync(workflow, 'utf8'), workflow)) roots.add(reference);
  }
  return roots;
}

function discoverReachableScripts() {
  const reachable = new Set();
  const queue = [...discoverRoots()];
  while (queue.length > 0) {
    const current = queue.shift();
    const name = relative(current);
    if (reachable.has(name) || name.startsWith('scripts/quarantine/')) continue;
    reachable.add(name);
    const source = fs.readFileSync(current, 'utf8');
    for (const reference of extractReferences(source, current)) {
      const nextName = relative(reference);
      if (!reachable.has(nextName)) queue.push(reference);
    }
  }
  return [...reachable].sort();
}

function scanFile(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const findings = [];
  if (!INTENTIONAL_CREDENTIAL_SCANNERS.has(file) && /\b(?:admin123|manager123|sales123|finance123|warehouse123)\b/i.test(source)) {
    findings.push({ category: 'demo-credential', file });
  }
  const hasSilentRuntimeFallback = source.split(/\r?\n/).some((line) =>
    /(?:DATABASE_URL|runtimeDbPath|runtimeDb)\s*=/.test(line)
      && /(?:\|\||\?\?)/.test(line)
      && /D:[\\/]AilaoDaRuntime[\\/]stable\.db/i.test(line));
  if (hasSilentRuntimeFallback) findings.push({ category: 'silent-runtime-db-fallback', file });
  return findings;
}

function key(finding) {
  return `${finding.category}:${finding.file}`;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) throw new Error(`Missing ratchet baseline: ${relative(BASELINE_PATH)}`);
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(parsed.findings)) throw new Error('Ratchet baseline must contain a findings array.');
  return parsed;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const reachableScripts = discoverReachableScripts();
  const findings = reachableScripts.flatMap(scanFile).sort((a, b) => key(a).localeCompare(key(b)));

  if (process.argv.includes('--write-baseline')) {
    writeJson(BASELINE_PATH, {
      version: 1,
      policy: 'Only reachable audit scripts are grandfathered; every finding must decrease and no new finding may enter.',
      findings,
    });
    console.log(`Active audit hardcode baseline written: ${findings.length} finding(s).`);
    return;
  }

  const baseline = readBaseline();
  const currentKeys = new Set(findings.map(key));
  const baselineKeys = new Set(baseline.findings.map(key));
  const added = findings.filter((finding) => !baselineKeys.has(key(finding)));
  const stale = baseline.findings.filter((finding) => !currentKeys.has(key(finding)));
  const status = added.length === 0 && stale.length === 0 ? 'passed' : 'failed';
  const report = {
    status,
    generatedAt: new Date().toISOString(),
    reachableScriptCount: reachableScripts.length,
    baselineFindingCount: baseline.findings.length,
    currentFindingCount: findings.length,
    added,
    stale,
    findings,
  };
  writeJson(REPORT_PATH, report);
  console.log(`Active audit hardcode ratchet: ${status.toUpperCase()} (${reachableScripts.length} reachable scripts, ${findings.length} findings).`);
  if (status !== 'passed') {
    if (added.length) console.error(`New findings: ${added.map(key).join(', ')}`);
    if (stale.length) console.error(`Remove fixed findings from baseline: ${stale.map(key).join(', ')}`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  writeJson(REPORT_PATH, { status: 'failed', generatedAt: new Date().toISOString(), error: String(error.message || error) });
  console.error(error);
  process.exitCode = 1;
}
