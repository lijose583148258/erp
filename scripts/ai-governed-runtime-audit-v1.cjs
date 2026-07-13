const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const root = process.cwd();
const reportPath = path.join(root, 'output/audit/ai-governed-runtime-audit-v1.json');
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const account = {
  username: `ai_runtime_audit_${runId}`,
  password: `AIRuntimeAudit${runId}!`,
  role: 'admin',
};
const instances = ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'];
const report = { name: 'Governed AI Runtime Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), instances, checks: [] };
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Check failed: ${name}`);
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { response, text, json };
}

async function main() {
  await ensureUiAuditUser(account);
  const login = await request(`${instances[0]}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: account.username, password: account.password }),
  });
  const token = login.json?.data?.token;
  check('dedicated-audit-login', login.response.status === 200 && Boolean(token));
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const status = await request(`${instances[0]}/api/v1/ai/status`, { headers });
  check('default-local-only', status.response.status === 200 && status.json?.data?.mode === 'local-only' && status.json?.data?.configured === false);
  check('shared-budget-and-circuit-configured', status.json?.data?.budget?.budgetConfigured === true && status.json?.data?.budget?.dailyTokenBudget === 50000 && status.json?.data?.budget?.circuitFailureThreshold === 5);

  const statuses = [];
  for (let index = 0; index < 22; index += 1) {
    const instance = instances[index < 12 ? 0 : 1];
    const result = await request(`${instance}/api/v1/ai/assist`, {
      method: 'POST', headers, body: JSON.stringify({ prompt: `explain governed navigation ${index + 1}`, language: 'en-US' }),
    });
    statuses.push(result.response.status);
  }
  check('sentinel-shared-ai-limit', statuses.filter(code => code === 200).length === 20 && statuses.slice(20).every(code => code === 429), { statuses });

  const invalid = await request(`${instances[0]}/api/v1/ai/assist`, {
    method: 'POST', headers, body: JSON.stringify({ prompt: 'help', apiKey: 'must-not-pass', endpoint: 'https://attacker.invalid' }),
  });
  check('client-provider-fields-rejected-or-limited', [400, 429].includes(invalid.response.status), { status: invalid.response.status });

  const metrics = await Promise.all(instances.map(instance => request(`${instance}/metrics`, { headers: { authorization: `Bearer ${token}` } })));
  check('ai-prometheus-outcomes',
    metrics[0].response.status === 200
      && metrics[1].response.status === 200
      && metrics[0].text.includes('ailaoda_ai_operations_total{outcome="fallback_disabled"}')
      && metrics[1].text.includes('ailaoda_ai_operations_total{outcome="rate_limited"}'));
  check('metrics-do-not-leak-prompts', metrics.every(item => !item.text.includes('explain governed navigation') && !item.text.includes('must-not-pass')));
  report.status = 'passed';
}

main().catch(error => {
  report.error = String(error.message || error);
  console.error(`Governed AI failure: ${report.error}`);
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Governed AI Runtime Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
