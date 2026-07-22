const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function requireMarkers(relativePath, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) findings.push(`${relativePath} is missing: ${marker}`);
  }
}

const enterprisePath = 'scripts/start-enterprise-sandbox-v1.ps1';
const enterprise = read(enterprisePath);
requireMarkers(enterprisePath, enterprise, [
  'Assert-OwnedEnterpriseListener',
  'otel-app-$Port.pid',
  'otel-app-$Port.owner.json',
  'PID record does not match',
  'owner process ID does not match',
  'belongs to another artifact root',
  '$health = $null',
  "process.Name -ne 'node.exe'",
  "process.CommandLine -notlike '*backend/dist/server.js*'",
]);

const ownershipCall = enterprise.indexOf('$ownership = Assert-OwnedEnterpriseListener');
const forcedStop = enterprise.indexOf('Stop-Process -Id $listenerProcessId -Force');
if (ownershipCall === -1 || forcedStop === -1 || ownershipCall > forcedStop) {
  findings.push(`${enterprisePath} must verify the listener owner before stopping it.`);
}
if (/taskkill\s+\/F\s+\/IM\s+node\.exe|Stop-Process[^\n]+-Name\s+node/i.test(enterprise)) {
  findings.push(`${enterprisePath} contains a global Node termination command.`);
}

const postgresPath = 'scripts/start-postgres-rehearsal-v1.ps1';
const postgres = read(postgresPath);
requireMarkers(postgresPath, postgres, [
  'Get-FileHash',
  'portable-cache',
  '.archive-sha256.txt',
  'Refusing to extract PostgreSQL outside the owned runtime root',
  'Refusing to reuse an unowned non-empty PostgreSQL cache directory',
]);
if (/\bRemove-Item\b/i.test(postgres)) {
  findings.push(`${postgresPath} must not recursively replace a shared portable PostgreSQL directory.`);
}

if (findings.length) {
  console.error('Runtime Script Ownership Audit: FAIL');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Runtime Script Ownership Audit: PASS');
console.log('- Enterprise listeners require matching PID, owner, artifact-root, executable, and command-line evidence before termination.');
console.log('- Portable PostgreSQL archives use immutable content-addressed cache directories without recursive replacement.');
