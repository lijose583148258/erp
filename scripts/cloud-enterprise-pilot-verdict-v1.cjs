const fs = require('fs');
const path = require('path');

const root = process.cwd();
const outputPath = path.join(root, 'cloud-evidence', 'enterprise-pilot-verdict.json');
const requiredReports = {
  unsavedChanges: 'output/playwright/unsaved-changes-browser-audit-v1.json',
  salesOrders: 'output/playwright/sales-orders-audit-report-v1.json',
  procurement: 'output/playwright/procurement-audit-report-v1.json',
  warehouseTransfer: 'output/playwright/warehouse-transfer-browser-audit-report-v1.json',
  shipping: 'output/playwright/shipping-audit-report-v1.json',
  collections: 'output/playwright/collection-center-human-flow-browser-audit-report-v1.json',
  governedAi: 'output/audit/ai-governed-runtime-audit-v1.json',
  load: 'output/audit/enterprise-ha-load-audit-v1.json',
  soak: 'output/audit/enterprise-ha-soak-audit-v1.json',
  redisControlledFailover: 'output/audit/cloud-redis-sentinel-failover-audit-v1.json',
  searchAndObjectStorageFailover: 'output/audit/cloud-degradable-dependency-failover-audit-v1.json',
  concurrentWriteReconciliation: 'output/playwright/concurrency-consistency-audit-report-v1.json',
  postgresPromotion: 'output/audit/cloud-postgres-promotion-audit-v1.json',
};

const checks = Object.entries(requiredReports).map(([name, relativePath]) => {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return { name, status: 'failed', reason: 'missing', path: relativePath };
  try {
    const report = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return { name, status: report.status === 'passed' ? 'passed' : 'failed', reportStatus: report.status || null, path: relativePath };
  } catch (error) {
    return { name, status: 'failed', reason: String(error?.message || error), path: relativePath };
  }
});

const sharedSessionPath = path.join(root, 'cloud-evidence', 'shared-session.json');
const sharedSession = fs.existsSync(sharedSessionPath)
  ? JSON.parse(fs.readFileSync(sharedSessionPath, 'utf8'))
  : null;
checks.push({ name: 'sharedSession', status: sharedSession?.status === 'passed' ? 'passed' : 'failed', path: 'cloud-evidence/shared-session.json' });

const telemetryPath = path.join(root, 'cloud-evidence', 'otel-trace-proof.txt');
const telemetryBytes = fs.existsSync(telemetryPath) ? fs.statSync(telemetryPath).size : 0;
checks.push({ name: 'telemetryIngestion', status: telemetryBytes > 0 ? 'passed' : 'failed', bytes: telemetryBytes, path: 'cloud-evidence/otel-trace-proof.txt' });

const pilotReady = checks.every(check => check.status === 'passed');
const verdict = {
  name: 'AilaoDa Enterprise Pilot Technical Admission',
  version: '1.0',
  status: pilotReady ? 'passed' : 'failed',
  pilotReady,
  productionReady: false,
  checkedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  checks,
  admittedScope: pilotReady ? {
    mode: 'supervised-enterprise-pilot',
    externalAi: 'disabled',
    topology: 'two application instances with PostgreSQL streaming replica and degradable dependencies',
  } : null,
  remainingProductionGates: [
    'Redis automatic election across independent failure domains; same-host sandbox currently proves controlled Sentinel failover only.',
    'Automatic PostgreSQL orchestration and failback; sandbox proves streaming replication, controlled promotion, post-promotion writes, and old-primary standby rebuild.',
    'At least 24-hour soak plus staged 7-day pilot observation with alert review.',
    'Backup restore disaster-recovery drill against the target production infrastructure.',
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
console.log(`Enterprise Pilot Technical Admission: ${verdict.status.toUpperCase()}`);
console.log(`pilotReady=${pilotReady} productionReady=false`);
console.log(`Report: ${outputPath}`);
if (!pilotReady) process.exit(1);
