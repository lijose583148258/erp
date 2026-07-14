const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.resolve(process.env.DEFAULT_CREDENTIAL_REPORT_PATH || path.join(OUTPUT_DIR, 'default-credential-release-gate-v1.json'));
const MD_REPORT = path.resolve(process.env.DEFAULT_CREDENTIAL_MARKDOWN_PATH || path.join(OUTPUT_DIR, 'default-credential-release-gate-v1.md'));
const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/+$/, '');
const ORIGIN_REPORT = path.join(ROOT, 'output', 'audit', 'stable-runtime-origin-v1.json');
const UI_AUDIT_HELPER = path.join(ROOT, 'scripts', 'lib', 'ui-audit-user.cjs');

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123' },
  { username: 'manager', password: 'manager123' },
  { username: 'sales', password: 'sales123' },
  { username: 'warehouse', password: 'warehouse123' },
  { username: 'finance', password: 'finance123' },
];

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function postJson(url, data, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.request(target, {
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let text = '';
      response.on('data', chunk => { text += chunk.toString('utf8'); });
      response.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ statusCode: response.statusCode, text, json });
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`POST ${url} timed out after ${timeoutMs}ms`));
    });
    request.on('error', error => {
      resolve({ statusCode: null, text: '', json: null, error: String(error.message || error) });
    });
    request.write(body);
    request.end();
  });
}

async function main() {
  const origin = readJsonIfExists(ORIGIN_REPORT);
  const strictMode = truthy(process.env.AILAODA_REQUIRE_NO_DEMO_CREDENTIALS)
    || truthy(process.env.AILAODA_DAILY_REQUIRE_PACKAGE)
    || truthy(process.env.AILAODA_SOAK_REQUIRE_PACKAGE)
    || origin?.packagedMode === true;
  const results = [];

  for (const account of DEMO_ACCOUNTS) {
    const response = await postJson(`${APP_URL}/api/auth/login`, account);
    const explicitRejection = [400, 401, 403].includes(Number(response.statusCode));
    results.push({
      username: account.username,
      accepted: response.statusCode === 200 && Boolean(response.json?.data?.token),
      forcedPasswordChange: response.statusCode === 200 && response.json?.data?.user?.mustChangePassword === true,
      businessAccess: response.statusCode === 200
        && Boolean(response.json?.data?.token)
        && response.json?.data?.user?.mustChangePassword !== true,
      explicitRejection,
      transportVerified: Number.isInteger(response.statusCode),
      statusCode: response.statusCode,
      message: response.json?.message || response.error || null,
    });
  }

  const accepted = results.filter(item => item.accepted);
  const businessAccepted = results.filter(item => item.businessAccess);
  const findings = [];
  const auditHelperSource = fs.readFileSync(UI_AUDIT_HELPER, 'utf8');
  const prohibitedAuditCredentialPatterns = [
    { pattern: /AuditSmoke12345!/, label: 'fixed UI audit password' },
    { pattern: /AUDIT_UI_USERNAME\\s*\\|\\|\\s*['"][^'"]+['"]/, label: 'fallback UI audit username' },
    { pattern: /AUDIT_UI_PASSWORD\\s*\\|\\|\\s*['"][^'"]+['"]/, label: 'fallback UI audit password' },
  ];
  const auditCredentialViolations = prohibitedAuditCredentialPatterns
    .filter(item => item.pattern.test(auditHelperSource))
    .map(item => item.label);
  if (auditCredentialViolations.length > 0) {
    findings.push({
      level: 'P0',
      area: 'audit-default-credentials',
      message: `audit harness contains prohibited credential fallbacks: ${auditCredentialViolations.join(', ')}`,
    });
  }
  if (strictMode && accepted.length > 0) {
    findings.push({
      level: 'P0',
      area: 'default-credentials',
      message: `default demo credentials can obtain API token in release mode: ${accepted.map(item => item.username).join(', ')}`,
    });
  }
  const inconclusive = results.filter(item => !item.explicitRejection && !item.accepted);
  if (strictMode && inconclusive.length > 0) {
    findings.push({
      level: 'P0',
      area: 'default-credentials',
      message: `default credential rejection was not proven for: ${inconclusive.map(item => `${item.username}(${item.statusCode || 'transport-error'})`).join(', ')}`,
    });
  }
  if (!strictMode && accepted.length > 0) {
    findings.push({
      level: 'P2',
      area: 'development-runtime',
      message: `demo credentials are still accepted for local audit runtime: ${accepted.map(item => item.username).join(', ')}`,
    });
  }

  const report = {
    name: 'Default Credential Release Gate',
    version: '2.0',
    environment: String(process.env.ENTERPRISE_EVIDENCE_ENVIRONMENT || '').trim(),
    evidenceId: String(process.env.ENTERPRISE_EVIDENCE_ID || '').trim(),
    commitSha: String(process.env.ENTERPRISE_EVIDENCE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim(),
    imageDigest: String(process.env.ENTERPRISE_EVIDENCE_IMAGE_DIGEST || '').trim(),
    appUrl: APP_URL,
    strictMode,
    origin: origin ? {
      root: origin.root || null,
      packagedMode: origin.packagedMode === true,
      runtimeDbPath: origin.runtimeDbPath || null,
    } : null,
    status: findings.some(item => item.level === 'P0') ? 'failed' : 'passed',
    results,
    findings,
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(JSON_REPORT), { recursive: true });
  fs.mkdirSync(path.dirname(MD_REPORT), { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [];
  md.push('# Default Credential Release Gate v1');
  md.push('');
  md.push(`- status: ${report.status}`);
  md.push(`- strict mode: ${report.strictMode}`);
  md.push(`- appUrl: ${report.appUrl}`);
  md.push('');
  md.push('## Results');
  for (const result of results) {
    const verdict = result.businessAccess ? 'BUSINESS_ACCESS' : result.forcedPasswordChange ? 'FORCED_CHANGE_ONLY' : result.accepted ? 'ACCEPTED' : 'REJECTED';
    md.push(`- ${verdict} ${result.username} (${result.statusCode || 'no response'})`);
  }
  md.push('');
  md.push('## Findings');
  if (findings.length === 0) md.push('- none');
  for (const finding of findings) {
    md.push(`- ${finding.level} ${finding.area}: ${finding.message}`);
  }
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    strictMode,
    accepted: accepted.map(item => item.username),
    businessAccess: businessAccepted.map(item => item.username),
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
