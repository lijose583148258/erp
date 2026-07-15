const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const outputPath = path.resolve(String(process.env.PILOT_AI_OUTPUT || 'pilot-ai-governance-review.json'));
const appUrls = String(process.env.PILOT_AI_APP_URLS || '')
  .split(',')
  .map(value => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const username = String(process.env.PILOT_AI_USERNAME || '').trim();
const passwordFile = String(process.env.PILOT_AI_PASSWORD_FILE || '').trim();
const metricsTokenFile = String(process.env.PILOT_AI_METRICS_TOKEN_FILE || '').trim();
const reviewer = String(process.env.PILOT_AI_REVIEWER || '').trim();
const checkedAt = String(process.env.PILOT_AI_CHECKED_AT || new Date().toISOString());
const report = {
  schemaVersion: 1,
  status: 'failed',
  checkedAt,
  reviewer,
  source: 'runtime-probe',
  instances: appUrls,
  externalAiEnabled: false,
  paidModelCalls: 0,
  governedAiRequests: 0,
  budgetBreaches: Number(process.env.PILOT_AI_BUDGET_BREACHES),
  privacyIncidents: Number(process.env.PILOT_AI_PRIVACY_INCIDENTS),
  crossTenantLeaks: Number(process.env.PILOT_AI_CROSS_TENANT_LEAKS),
  unresolvedAiIncidents: Number(process.env.PILOT_AI_UNRESOLVED_INCIDENTS),
  fallbackVerified: false,
};

const fail = message => {
  throw new Error(message);
};
const readPrivateFile = (file, label) => {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} file does not exist.`);
  const stat = fs.statSync(file);
  if ((stat.mode & 0o007) !== 0 || (stat.mode & 0o020) !== 0) fail(`${label} file permissions are too broad.`);
  if ((stat.mode & 0o040) !== 0 && typeof process.getegid === 'function' && stat.gid !== process.getegid()) {
    fail(`${label} group-readable file is not owned by the effective group.`);
  }
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value) fail(`${label} file is empty.`);
  return value;
};
const requestJson = async (url, init = {}) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => null);
  return { response, body };
};
const fetchMetrics = async (instance, token) => {
  const response = await fetch(`${instance}/metrics`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`Metrics scrape failed with HTTP ${response.status}.`);
  return response.text();
};
const metricCounts = text => {
  const counts = new Map();
  const expression = /^ailaoda_ai_operations_total\{outcome="([a-z0-9_]+)"\}\s+([0-9.eE+-]+)$/gm;
  for (const match of text.matchAll(expression)) counts.set(match[1], Number(match[2]));
  return counts;
};
const totalDelta = (beforeText, afterText) => {
  const before = metricCounts(beforeText);
  const after = metricCounts(afterText);
  let total = 0;
  for (const [outcome, count] of after.entries()) {
    const delta = count - (before.get(outcome) || 0);
    if (!Number.isFinite(delta) || delta < 0) fail('AI metric counter reset during the daily probe.');
    total += delta;
  }
  return total;
};
const fingerprint = values => crypto.createHash('sha256')
  .update(values.map((value, index) => `${appUrls[index]}\n${value}`).join('\n---\n'))
  .digest('hex');

async function main() {
  if (appUrls.length < 2 || new Set(appUrls).size !== appUrls.length) fail('Two distinct application URLs are required.');
  if (!appUrls.every(value => /^https:\/\//.test(value) || /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(value))) {
    fail('Application URLs must use HTTPS, except explicit 127.0.0.1 contract endpoints.');
  }
  if (!username || reviewer.length < 2) fail('Pilot AI username and reviewer are required.');
  const checkedMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedMs) || checkedMs > Date.now() + 300_000 || Date.now() - checkedMs > 86_400_000) {
    fail('PILOT_AI_CHECKED_AT must be a current timestamp.');
  }
  for (const field of ['budgetBreaches', 'privacyIncidents', 'crossTenantLeaks', 'unresolvedAiIncidents']) {
    if (!Number.isInteger(report[field]) || report[field] !== 0) fail(`${field} must be explicitly reported as zero.`);
  }
  const password = readPrivateFile(passwordFile, 'Pilot AI password');
  const metricsToken = readPrivateFile(metricsTokenFile, 'Metrics token');
  const login = await requestJson(`${appUrls[0]}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const token = login.body?.data?.token;
  if (!login.response.ok || !token) fail(`Pilot AI login failed with HTTP ${login.response.status}.`);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const statuses = await Promise.all(appUrls.map(instance => requestJson(`${instance}/api/v1/ai/status`, { headers })));
  if (statuses.some(({ response, body }) => !response.ok
    || body?.data?.mode !== 'local-only'
    || body?.data?.externalEnabled !== false
    || body?.data?.configured !== false)) {
    fail('Daily zero-cost AI probe requires local-only mode on every instance.');
  }
  const before = await Promise.all(appUrls.map(instance => fetchMetrics(instance, metricsToken)));
  const results = await Promise.all(appUrls.map(instance => requestJson(`${instance}/api/v1/ai/assist`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: 'Explain governed navigation without reading business records.',
      language: 'en-US',
      currentPage: 'pilot-ai-governance-probe',
      visibleCounts: {},
    }),
  })));
  if (results.some(({ response, body }) => !response.ok
    || body?.data?.mode !== 'local'
    || body?.data?.reason !== 'disabled')) {
    fail('A local governed fallback was not returned by every instance.');
  }
  const after = await Promise.all(appUrls.map(instance => fetchMetrics(instance, metricsToken)));
  const deltas = appUrls.map((_, index) => totalDelta(before[index], after[index]));
  if (deltas.some(value => value < 1)) fail('Every application instance must expose a new governed AI metric.');
  report.governedAiRequests = deltas.reduce((sum, value) => sum + value, 0);
  report.metricsBeforeSha256 = fingerprint(before);
  report.metricsAfterSha256 = fingerprint(after);
  report.fallbackVerified = true;
  report.status = 'passed';
}

main().catch(error => {
  report.error = String(error?.message || error);
  process.exitCode = 1;
}).finally(() => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Pilot AI governance runtime review: ${report.status.toUpperCase()}`);
  console.log(`Report: ${outputPath}`);
});
