const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8').replace(/^\uFEFF/, '');
}

function add(level, file, message) {
  findings.push({ level, file, message });
}

const indexHtml = read('index.html');
const appVitals = read('public/app-vitals.js');
const server = read('backend/src/server.ts');
const metrics = read('backend/src/middleware/metricsMiddleware.ts');
const openApi = read('backend/src/openapi/openapiDocument.ts');

if (!indexHtml.includes('src="/app-vitals.js"')) {
  add('P1', 'index.html', 'Browser Web Vitals collector is not loaded as a same-origin external script.');
}
if (!appVitals.includes("endpoint = '/api/rum/vitals'")) {
  add('P1', 'public/app-vitals.js', 'RUM collector must post to the versioned API compatibility namespace.');
}
if (/location\.href|location\.search|location\.hash/.test(appVitals)) {
  add('P1', 'public/app-vitals.js', 'RUM collector must not send full URLs, query strings, or hashes.');
}
if (!appVitals.includes('navigator.sendBeacon') || !appVitals.includes('keepalive: true')) {
  add('P2', 'public/app-vitals.js', 'RUM collector should use sendBeacon with fetch keepalive fallback.');
}
if (!server.includes("'/api/rum/vitals'") || !server.includes("'/api/v1/rum/vitals'")) {
  add('P1', 'backend/src/server.ts', 'RUM ingest route must be exposed in both compatibility and v1 namespaces.');
}
if (!metrics.includes('allowedRumVitalNames') || !metrics.includes('ailaoda_browser_web_vitals_total')) {
  add('P1', 'backend/src/middleware/metricsMiddleware.ts', 'RUM metrics must be allowlisted and exported to Prometheus.');
}
if (!openApi.includes('/rum/vitals')) {
  add('P2', 'backend/src/openapi/openapiDocument.ts', 'RUM ingest route should be documented in OpenAPI.');
}

const report = {
  name: 'Web Vitals RUM Audit',
  version: '1.0',
  status: findings.some(item => item.level === 'P0' || item.level === 'P1') ? 'failed' : 'passed',
  findings,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exit(1);
