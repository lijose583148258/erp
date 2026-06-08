const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const WORKSPACE_PACKAGE_ROOT = path.join(ROOT, 'AilaoDa_Stable_Package');
const DEFAULT_CLEAN_ROOT = Buffer.from('RTpc54ix5Yqz6L6+57qv5YeA57O757uf', 'base64').toString('utf8');
const CLEAN_RUNTIME_ROOT = process.env.AILAODA_CLEAN_RUNTIME_ROOT || DEFAULT_CLEAN_ROOT;
const JSON_REPORT = path.join(OUTPUT_DIR, 'stable-package-origin-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'stable-package-origin-audit-v1.md');

const CANDIDATE_PACKAGE_ROOTS = Array.from(new Set([
  WORKSPACE_PACKAGE_ROOT,
  CLEAN_RUNTIME_ROOT,
].map(item => path.resolve(item))));

function getOriginReportPath(packageRoot) {
  return path.join(packageRoot, 'output', 'audit', 'stable-runtime-origin-v1.json');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function httpGetJson(url, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let text = '';
      res.on('data', chunk => { text += chunk.toString('utf8'); });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, json: JSON.parse(text), text });
        } catch {
          resolve({ statusCode: res.statusCode, json: null, text });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`GET ${url} timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

function getListeningPid() {
  const ps = [
    '$conn = Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;',
    'if ($conn) { Write-Output $conn.OwningProcess }',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const value = String(result.stdout || '').trim();
  return value ? Number(value) : null;
}

async function main() {
  const findings = [];

  const packageCandidates = CANDIDATE_PACKAGE_ROOTS.map(packageRoot => {
    const originReport = getOriginReportPath(packageRoot);
    const exists = fs.existsSync(packageRoot);
    const originReportExists = fs.existsSync(originReport);
    return {
      packageRoot,
      exists,
      originReport,
      originReportExists,
      origin: originReportExists ? readJson(originReport) : null,
    };
  });

  if (!packageCandidates.some(item => item.exists)) {
    findings.push({ level: 'P0', area: 'package', message: 'no stable package roots found' });
  }

  const health = await httpGetJson('http://127.0.0.1:5001/health');
  if (health.statusCode !== 200 || !health.json || health.json.status !== 'ok' || health.json.mode !== 'production') {
    findings.push({ level: 'P0', area: 'health', message: `unexpected health response ${health.statusCode}: ${health.text.slice(0, 200)}` });
  }

  const listeningPid = getListeningPid();
  if (!listeningPid) {
    findings.push({ level: 'P0', area: 'process', message: 'no listener found on port 5001' });
  }

  const activeCandidate = packageCandidates.find(item => (
    item.origin && listeningPid && Number(item.origin.backendPid) === Number(listeningPid)
  )) || null;

  if (!activeCandidate) {
    findings.push({
      level: 'P0',
      area: 'origin',
      message: `no stable package origin report matches listening PID ${listeningPid || 'none'}`,
    });
  }

  const origin = activeCandidate?.origin || null;
  if (origin && activeCandidate) {
    const normalizedRoot = path.resolve(origin.root || '');
    const normalizedPackageRoot = path.resolve(activeCandidate.packageRoot);
    if (normalizedRoot !== normalizedPackageRoot) {
      findings.push({ level: 'P0', area: 'origin', message: `runtime root is ${origin.root}, expected ${activeCandidate.packageRoot}` });
    }
    if (!origin.packagedMode) {
      findings.push({ level: 'P0', area: 'origin', message: 'packagedMode must be true for package runtime audit' });
    }
    if (origin.systemUrl !== 'http://127.0.0.1:5001') {
      findings.push({ level: 'P0', area: 'origin', message: `unexpected systemUrl ${origin.systemUrl}` });
    }
    if (String(origin.runtimeDbPath || '').replace(/\//g, '\\').toLowerCase() !== 'd:\\ailaodaruntime\\stable.db'.toLowerCase()) {
      findings.push({ level: 'P1', area: 'origin', message: `runtime DB is ${origin.runtimeDbPath}; expected D:\\AilaoDaRuntime\\stable.db for this workstation` });
    }
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      purpose: 'Prove that the active 5001 runtime was launched from a governed stable package root, including the E drive clean runtime package.',
    },
    status: findings.some(item => item.level === 'P0') ? 'failed' : 'passed',
    packageRoots: CANDIDATE_PACKAGE_ROOTS,
    activePackageRoot: activeCandidate?.packageRoot || null,
    activePackageOriginReport: activeCandidate?.originReport || null,
    candidates: packageCandidates.map(item => ({
      packageRoot: item.packageRoot,
      exists: item.exists,
      originReport: item.originReport,
      originReportExists: item.originReportExists,
      backendPid: item.origin?.backendPid || null,
      generatedAt: item.origin?.generatedAt || null,
    })),
    origin,
    health: health.json,
    listeningPid,
    findings,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push('# Stable Package Origin Audit v1');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- generated: ${report.meta.generatedAt}`);
  md.push(`- active package root: ${report.activePackageRoot || 'none'}`);
  md.push(`- listening pid: ${report.listeningPid || 'none'}`);
  md.push('');
  md.push('## Findings');
  if (findings.length === 0) md.push('- none');
  for (const finding of findings) md.push(`- ${finding.level} ${finding.area}: ${finding.message}`);
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    findings: findings.length,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
