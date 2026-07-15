const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const adapter = path.join(__dirname, 'tempo-alert-receipt-adapter.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-observability-adapter-'));
const tokenFile = path.join(root, 'token');
const stateRoot = path.join(root, 'state');
fs.writeFileSync(tokenFile, 'contract-token', { mode: 0o600 });
fs.chmodSync(tokenFile, 0o600);
let alertSent = false;
let alertResolved = false;
const traceId = 'a'.repeat(32);
const drillId = 'formal-observability-contract-1';

const server = http.createServer((req, res) => {
  const respond = (status, body = null) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === null ? '' : JSON.stringify(body));
  };
  if (req.headers.authorization !== 'Bearer contract-token') return respond(401, {});
  if (req.method === 'GET' && req.url === `/api/traces/${traceId}`) {
    return respond(200, {
      batches: [{
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'ailaoda-erp-crm' } }],
        },
        scopeSpans: [{ spans: [{ spanId: '1' }, { spanId: '2' }] }],
      }],
    });
  }
  if (req.method === 'POST' && req.url === '/api/v2/alerts') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(raw);
      const alert = payload[0];
      assert.equal(alert.labels.drill_id, drillId);
      const ending = Date.parse(alert.endsAt);
      if (ending <= Date.now() + 1_000) alertResolved = true;
      else alertSent = true;
      respond(200, {});
    });
    return;
  }
  if (req.method === 'GET' && req.url === `/v1/alerts/${drillId}`) {
    return respond(200, alertSent
      ? { status: 'delivered', receiptId: 'receipt-1', receiver: 'pilot-webhook', deliveredAt: new Date().toISOString() }
      : { status: 'pending' });
  }
  if (req.method === 'GET' && req.url === `/v1/alerts/${drillId}/resolution`) {
    return respond(200, alertResolved
      ? { status: 'delivered', resolvedAt: new Date().toISOString() }
      : { status: 'pending' });
  }
  respond(404, {});
});
const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = () => new Promise(resolve => server.close(resolve));
const run = (operation, id, env = {}) => new Promise(resolve => {
  const child = spawn(process.execPath, [adapter, operation, id], {
    env: {
      ...process.env,
      ...env,
      OBS_ADAPTER_TEMPO_TOKEN_FILE: tokenFile,
      OBS_ADAPTER_ALERTMANAGER_TOKEN_FILE: tokenFile,
      OBS_ADAPTER_RECEIPT_TOKEN_FILE: tokenFile,
      OBS_ADAPTER_STATE_DIR: stateRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
});
const parse = result => {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('contract-token'));
  return result.stdout ? JSON.parse(result.stdout) : null;
};

(async () => {
  try {
    await listen();
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const env = {
      OBS_ADAPTER_TEMPO_URL: base,
      OBS_ADAPTER_ALERTMANAGER_URL: base,
      OBS_ADAPTER_RECEIPT_URL: base,
      OBS_ADAPTER_SERVICE_NAME: 'ailaoda-erp-crm',
    };
    const trace = parse(await run('trace', traceId, env));
    assert.deepEqual({ found: trace.found, service: trace.service, spanCount: trace.spanCount }, {
      found: true, service: 'ailaoda-erp-crm', spanCount: 2,
    });
    const sent = parse(await run('send-alert', drillId, env));
    assert.ok(Number.isFinite(Date.parse(sent.sentAt)));
    assert.equal(parse(await run('alert-receipt', drillId, env)).status, 'delivered');
    assert.equal(parse(await run('resolve-alert', drillId, env)), null);
    assert.equal(parse(await run('resolution-receipt', drillId, env)).status, 'delivered');

    if (process.platform !== 'win32') {
      fs.chmodSync(tokenFile, 0o644);
      const insecure = await run('trace', traceId, env);
      assert.notEqual(insecure.status, 0);
    }
    console.log('Tempo Alertmanager observability adapter contract: PASSED');
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
