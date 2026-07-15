const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const collector = path.join(__dirname, 'capture-pilot-ai-governance-review.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-pilot-ai-review-'));
const passwordFile = path.join(root, 'password');
const metricsTokenFile = path.join(root, 'metrics-token');
fs.writeFileSync(passwordFile, 'test-password\n', { mode: 0o600 });
fs.writeFileSync(metricsTokenFile, 'metrics-token\n', { mode: 0o600 });

let externalEnabled = false;
const counts = [0, 0];
const servers = counts.map((_, index) => http.createServer((req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  if (req.method === 'POST' && req.url === '/api/v1/auth/login' && index === 0) {
    req.resume();
    return send(200, { success: true, data: { token: 'shared-token' } });
  }
  if (req.headers.authorization === 'Bearer shared-token' && req.url === '/api/v1/ai/status') {
    return send(200, {
      success: true,
      data: {
        mode: externalEnabled ? 'external-allowed' : 'local-only',
        externalEnabled,
        configured: externalEnabled,
      },
    });
  }
  if (req.headers.authorization === 'Bearer shared-token' && req.method === 'POST' && req.url === '/api/v1/ai/assist') {
    req.resume();
    counts[index] += 1;
    return send(200, { success: true, data: { mode: 'local', reason: 'disabled', answer: 'bounded' } });
  }
  if (req.headers.authorization === 'Bearer metrics-token' && req.url === '/metrics') {
    return send(200, `# TYPE ailaoda_ai_operations_total counter\nailaoda_ai_operations_total{outcome="fallback_disabled"} ${counts[index]}\n`, 'text/plain');
  }
  return send(404, { error: 'not found' });
}));

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));
const run = (urls, output) => new Promise(resolve => {
  const child = spawn(process.execPath, [collector], {
    env: {
      ...process.env,
      PILOT_AI_APP_URLS: urls.join(','),
      PILOT_AI_USERNAME: 'pilot-ai-user',
      PILOT_AI_PASSWORD_FILE: passwordFile,
      PILOT_AI_METRICS_TOKEN_FILE: metricsTokenFile,
      PILOT_AI_REVIEWER: 'ai-governance-owner',
      PILOT_AI_OUTPUT: output,
      PILOT_AI_BUDGET_BREACHES: '0',
      PILOT_AI_PRIVACY_INCIDENTS: '0',
      PILOT_AI_CROSS_TENANT_LEAKS: '0',
      PILOT_AI_UNRESOLVED_INCIDENTS: '0',
    },
    stdio: 'pipe',
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', code => resolve({ code, stderr }));
});

(async () => {
  try {
    const ports = await Promise.all(servers.map(listen));
    const urls = ports.map(port => `http://127.0.0.1:${port}`);
    const output = path.join(root, 'review.json');
    const passed = await run(urls, output);
    assert.equal(passed.code, 0, passed.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.status, 'passed');
    assert.equal(report.source, 'runtime-probe');
    assert.equal(report.externalAiEnabled, false);
    assert.equal(report.paidModelCalls, 0);
    assert.equal(report.governedAiRequests, 2);
    assert.equal(report.fallbackVerified, true);
    assert.match(report.metricsBeforeSha256, /^[0-9a-f]{64}$/);
    assert.match(report.metricsAfterSha256, /^[0-9a-f]{64}$/);

    externalEnabled = true;
    const rejectedOutput = path.join(root, 'external-enabled.json');
    const rejected = await run(urls, rejectedOutput);
    assert.notEqual(rejected.code, 0, 'external-enabled mode must be rejected by the zero-cost daily probe');
    const rejectedReport = JSON.parse(fs.readFileSync(rejectedOutput, 'utf8'));
    assert.equal(rejectedReport.status, 'failed');
    assert.match(rejectedReport.error, /local-only/);
    console.log('Pilot AI governance runtime review contract: PASSED');
  } finally {
    await Promise.all(servers.map(close));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
