const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'stable-entrypoint-policy-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'stable-entrypoint-policy-audit-v1.md');

function readText(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

function normalize(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function addFinding(findings, level, area, file, message) {
  findings.push({ level, area, file, message });
}

function requireText(findings, relativePath, area) {
  const text = readText(relativePath);
  if (text === null) {
    addFinding(findings, 'P0', area, relativePath, 'required entry file is missing');
    return '';
  }
  return normalize(text);
}

function checkPackageScripts(findings) {
  const text = requireText(findings, 'package.json', 'package-scripts');
  if (!text) return;
  let pkg = null;
  try {
    pkg = JSON.parse(text);
  } catch (error) {
    addFinding(findings, 'P0', 'package-scripts', 'package.json', `package.json is not valid JSON: ${error.message}`);
    return;
  }

  const scripts = pkg.scripts || {};
  if (scripts.start !== 'npm run start:stable') {
    addFinding(findings, 'P0', 'package-scripts', 'package.json', 'npm start must delegate to npm run start:stable');
  }
  if (!/scripts\\start-stable-v2\.ps1|scripts\/start-stable-v2\.ps1/.test(scripts['start:stable'] || '')) {
    addFinding(findings, 'P0', 'package-scripts', 'package.json', 'start:stable must call scripts/start-stable-v2.ps1');
  }
  if (!scripts['audit:entrypoints']) {
    addFinding(findings, 'P1', 'package-scripts', 'package.json', 'missing audit:entrypoints script');
  }
}

function checkStableBat(findings) {
  const text = requireText(findings, '稳定启动.bat', 'root-launchers');
  if (!text) return;
  if (!/scripts\\start-stable-v2\.ps1/i.test(text)) {
    addFinding(findings, 'P0', 'root-launchers', '稳定启动.bat', 'stable launcher must call scripts\\start-stable-v2.ps1');
  }
  if (!/127\.0\.0\.1:5001\//.test(text)) {
    addFinding(findings, 'P0', 'root-launchers', '稳定启动.bat', 'stable launcher must open http://127.0.0.1:5001/');
  }
  if (/localhost:3000|5173|5180/i.test(text)) {
    addFinding(findings, 'P0', 'root-launchers', '稳定启动.bat', 'stable launcher must not mention dev or foreign ports');
  }
}

function checkOfficialBat(findings) {
  const text = requireText(findings, '正式启动.bat', 'root-launchers');
  if (!text) return;
  if (!/call\s+"%~dp0稳定启动\.bat"/i.test(text)) {
    addFinding(findings, 'P0', 'root-launchers', '正式启动.bat', 'official launcher must delegate to 稳定启动.bat');
  }
}

function checkSystemBat(findings) {
  const text = requireText(findings, '启动系统.bat', 'root-launchers');
  if (!text) return;
  const stableCallIndex = text.search(/call\s+"%~dp0稳定启动\.bat"/i);
  const devLabelIndex = text.search(/^:dev_mode/im);
  if (stableCallIndex < 0) {
    addFinding(findings, 'P0', 'root-launchers', '启动系统.bat', 'default system launcher must delegate to 稳定启动.bat');
  }
  if (devLabelIndex < 0) {
    addFinding(findings, 'P1', 'root-launchers', '启动系统.bat', 'dev mode label is missing; development entry should be explicit if present');
    return;
  }
  if (stableCallIndex > devLabelIndex) {
    addFinding(findings, 'P0', 'root-launchers', '启动系统.bat', 'stable delegation must happen before the dev-only block');
  }
  const defaultBlock = stableCallIndex >= 0 && devLabelIndex >= 0 ? text.slice(0, devLabelIndex) : text;
  if (/localhost:3000|npm run dev|backend run dev/i.test(defaultBlock)) {
    addFinding(findings, 'P0', 'root-launchers', '启动系统.bat', 'default path must not start or advertise the dev 3000 entry');
  }
  const devBlock = text.slice(devLabelIndex);
  if (!/\[警告\]|warning|development launcher/i.test(devBlock)) {
    addFinding(findings, 'P1', 'root-launchers', '启动系统.bat', 'dev block must contain an explicit warning');
  }
}

function checkStopBat(findings) {
  const text = requireText(findings, '停止服务.bat', 'root-launchers');
  if (!text) return;
  if (!/scripts\\stop-runtime\.ps1/i.test(text)) {
    addFinding(findings, 'P0', 'root-launchers', '停止服务.bat', 'stop launcher must call scripts\\stop-runtime.ps1');
  }
}

function checkPowerShellGuards(findings) {
  const startStable = requireText(findings, 'scripts/start-stable-v2.ps1', 'powershell-guards');
  if (startStable) {
    if (/Stop-PortProcess\s+-Port\s+5173|Stop-PortProcess\s+-Port\s+5180/i.test(startStable)) {
      addFinding(findings, 'P0', 'powershell-guards', 'scripts/start-stable-v2.ps1', 'stable launcher must not stop 5173/5180');
    }
    if (!/Required/.test(startStable) || !/non-AilaoDa process/i.test(startStable)) {
      addFinding(findings, 'P1', 'powershell-guards', 'scripts/start-stable-v2.ps1', '5001 conflict guard should fail instead of killing unrelated processes');
    }
    if (!/127\.0\.0\.1:5001/.test(startStable)) {
      addFinding(findings, 'P0', 'powershell-guards', 'scripts/start-stable-v2.ps1', 'stable launcher must verify 127.0.0.1:5001');
    }
  }

  const stopRuntime = requireText(findings, 'scripts/stop-runtime.ps1', 'powershell-guards');
  if (stopRuntime) {
    if (/taskkill|Get-Process\s+-Name\s+node|Stop-Process\s+-Name\s+node/i.test(stopRuntime)) {
      addFinding(findings, 'P0', 'powershell-guards', 'scripts/stop-runtime.ps1', 'stop script must not globally kill node processes');
    }
    if (/Stop-PortProcess\s+-Port\s+5173|Stop-PortProcess\s+-Port\s+5180/i.test(stopRuntime)) {
      addFinding(findings, 'P0', 'powershell-guards', 'scripts/stop-runtime.ps1', 'stop script must not stop 5173/5180');
    }
    if (!/Skip 5173\/5180 by policy/i.test(stopRuntime)) {
      addFinding(findings, 'P1', 'powershell-guards', 'scripts/stop-runtime.ps1', 'stop script should document the 5173/5180 skip policy');
    }
  }
}

function checkRuntimeCheck(findings) {
  const text = requireText(findings, 'scripts/check-runtime.ps1', 'runtime-check');
  if (!text) return;
  if (!/127\.0\.0\.1:5001/.test(text)) {
    addFinding(findings, 'P0', 'runtime-check', 'scripts/check-runtime.ps1', 'runtime check default URL must be http://127.0.0.1:5001');
  }
}

function checkRuntimePortPolicy(findings) {
  const startStable = requireText(findings, 'scripts/start-stable-v2.ps1', 'runtime-port-policy');
  if (startStable && !/set\s+"NODE_ENV=production"/i.test(startStable)) {
    addFinding(findings, 'P0', 'runtime-port-policy', 'scripts/start-stable-v2.ps1', 'stable runtime must set NODE_ENV=production with Windows-safe quoted set syntax before launching backend/dist/server.js');
  }
  if (startStable
    && (!/stableCorsOrigin\s*=\s*'http:\/\/127\.0\.0\.1:5001,http:\/\/localhost:5001'/i.test(startStable)
      || !/set\s+""CORS_ORIGIN=\$stableCorsOrigin""/i.test(startStable))) {
    addFinding(findings, 'P0', 'runtime-port-policy', 'scripts/start-stable-v2.ps1', 'stable runtime must override old local .env CORS_ORIGIN with the stable 5001 origins using Windows-safe quoted set syntax');
  }

  const runtimeConfig = requireText(findings, 'backend/src/config/runtime.ts', 'runtime-port-policy');
  if (runtimeConfig) {
    if (!/http:\/\/127\.0\.0\.1:5001/.test(runtimeConfig) || !/http:\/\/localhost:5001/.test(runtimeConfig)) {
      addFinding(findings, 'P0', 'runtime-port-policy', 'backend/src/config/runtime.ts', 'default CORS origins must include both stable 5001 loopback origins');
    }
    if (!/AILAODA_ALLOW_DEV_ORIGINS/.test(runtimeConfig)) {
      addFinding(findings, 'P1', 'runtime-port-policy', 'backend/src/config/runtime.ts', 'dev CORS origins should require an explicit switch outside production defaults');
    }
    if (/localhost:(3001|3002|4173|5173|5180|8080)|127\.0\.0\.1:(3001|3002|4173|5173|5180|8080)/.test(runtimeConfig)) {
      addFinding(findings, 'P0', 'runtime-port-policy', 'backend/src/config/runtime.ts', 'runtime default origins must not keep stale broad dev/foreign ports');
    }
  }

  const server = requireText(findings, 'backend/src/server.ts', 'runtime-port-policy');
  if (server) {
    if (!/cspConnectSources/.test(server) || !/\.\.\.allowedOrigins/.test(server)) {
      addFinding(findings, 'P1', 'runtime-port-policy', 'backend/src/server.ts', 'CSP connect-src should derive from getAllowedOrigins instead of hardcoded old ports');
    }
    if (/http:\/\/127\.0\.0\.1:5173|http:\/\/localhost:5173|http:\/\/127\.0\.0\.1:5180|http:\/\/localhost:5180/.test(server)) {
      addFinding(findings, 'P0', 'runtime-port-policy', 'backend/src/server.ts', 'server CSP must not include 5173/5180');
    }
  }

  const backendEnvExample = requireText(findings, 'backend/.env.example', 'runtime-port-policy');
  if (backendEnvExample) {
    if (!/CORS_ORIGIN=.*127\.0\.0\.1:5001.*localhost:5001/.test(backendEnvExample)) {
      addFinding(findings, 'P1', 'runtime-port-policy', 'backend/.env.example', 'backend env example should document stable 5001 CORS origins first');
    }
    if (/5173|5180/.test(backendEnvExample)) {
      addFinding(findings, 'P0', 'runtime-port-policy', 'backend/.env.example', 'backend env example must not mention 5173/5180');
    }
    if (!/AILAODA_RUNTIME_DB_PATH/.test(backendEnvExample)) {
      addFinding(findings, 'P1', 'runtime-port-policy', 'backend/.env.example', 'backend env example should document D:\\AilaoDaRuntime stable database path override');
    }
  }
}

function checkLegacyScriptRedirects(findings) {
  const text = requireText(findings, 'scripts/dual-port-audit.cjs', 'legacy-script-redirect');
  if (text) {
    if (!/LEGACY_SCRIPT_REDIRECT/.test(text) || !/dual-port-audit-v2\.cjs/.test(text)) {
      addFinding(findings, 'P1', 'legacy-script-redirect', 'scripts/dual-port-audit.cjs', 'old dual-port audit should be a compatibility redirect to dual-port-audit-v2.cjs');
    }
  }

  const packageText = requireText(findings, 'package.json', 'legacy-script-redirect');
  if (packageText) {
    let pkg = null;
    try {
      pkg = JSON.parse(packageText);
    } catch {
      return;
    }
    for (const [name, command] of Object.entries(pkg.scripts || {})) {
      if (/scripts\\dual-port-audit\.cjs|scripts\/dual-port-audit\.cjs/.test(String(command))) {
        addFinding(findings, 'P0', 'legacy-script-redirect', 'package.json', `script ${name} must use scripts/dual-port-audit-v2.cjs instead of the legacy wrapper`);
      }
    }
  }
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# Stable Entrypoint Policy Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- findings: ${report.findings.length}`,
    '',
    '## Findings',
  ];
  if (report.findings.length === 0) lines.push('- none');
  for (const finding of report.findings) {
    lines.push(`- ${finding.level} ${finding.area} ${finding.file}: ${finding.message}`);
  }
  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const findings = [];
  checkPackageScripts(findings);
  checkStableBat(findings);
  checkOfficialBat(findings);
  checkSystemBat(findings);
  checkStopBat(findings);
  checkPowerShellGuards(findings);
  checkRuntimeCheck(findings);
  checkRuntimePortPolicy(findings);
  checkLegacyScriptRedirects(findings);

  const hasP0 = findings.some((finding) => finding.level === 'P0');
  const report = {
    generatedAt: new Date().toISOString(),
    status: hasP0 ? 'failed' : findings.length > 0 ? 'warning' : 'passed',
    stableUrl: 'http://127.0.0.1:5001/',
    forbiddenStablePorts: ['3000', '5173', '5180'],
    findings,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  };
  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    findings: findings.length,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));
  if (report.status === 'failed') process.exitCode = 1;
}

main();
