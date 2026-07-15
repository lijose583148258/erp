const fs = require('fs');
const path = require('path');

const operation = process.argv[2] || '';
const operationId = String(process.argv[3] || '').trim();
const tempoUrl = String(process.env.OBS_ADAPTER_TEMPO_URL || '').trim().replace(/\/$/, '');
const alertmanagerUrl = String(process.env.OBS_ADAPTER_ALERTMANAGER_URL || '').trim().replace(/\/$/, '');
const receiptUrl = String(process.env.OBS_ADAPTER_RECEIPT_URL || '').trim().replace(/\/$/, '');
const serviceName = String(process.env.OBS_ADAPTER_SERVICE_NAME || 'ailaoda-erp-crm').trim();
const stateRoot = path.resolve(String(process.env.OBS_ADAPTER_STATE_DIR || '/tmp/ailaoda-observability-adapter'));
const timeoutMs = Math.max(5_000, Number(process.env.OBS_ADAPTER_TIMEOUT_MS || 30_000));

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const validUrl = value => {
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password
      && (parsed.protocol === 'https:'
        || (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)));
  } catch {
    return false;
  }
};
for (const [label, value] of Object.entries({ tempoUrl, alertmanagerUrl, receiptUrl })) {
  if (!validUrl(value)) fail(`${label} must use HTTPS without embedded credentials; loopback HTTP is contract-only.`);
}
if (!serviceName) fail('OBS_ADAPTER_SERVICE_NAME is required.');

const readToken = (name, label) => {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`${name} is required.`);
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} token file does not exist.`);
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077) !== 0) {
    fail(`${label} token file must not be accessible by group or other users.`);
  }
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!token) fail(`${label} token file is empty.`);
  return token;
};
const tokens = {
  tempo: readToken('OBS_ADAPTER_TEMPO_TOKEN_FILE', 'Tempo'),
  alertmanager: readToken('OBS_ADAPTER_ALERTMANAGER_TOKEN_FILE', 'Alertmanager'),
  receipt: readToken('OBS_ADAPTER_RECEIPT_TOKEN_FILE', 'Receipt store'),
};
const headers = token => ({ authorization: `Bearer ${token}`, accept: 'application/json' });
const request = async (url, options = {}) => fetch(url, {
  ...options,
  signal: AbortSignal.timeout(timeoutMs),
});
const requestJson = async (url, token, options = {}) => {
  const response = await request(url, {
    ...options,
    headers: { ...headers(token), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
};
const validDrillId = value => /^[A-Za-z0-9][A-Za-z0-9_.-]{4,95}$/.test(value);
const statePath = id => path.join(stateRoot, `${id}.json`);
const writeState = (id, state) => {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath(id), `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};
const readState = id => {
  if (!validDrillId(id)) fail('A valid observability drill ID is required.');
  const file = statePath(id);
  if (!fs.existsSync(file)) fail('Observability adapter state is missing.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const alertPayload = (id, startsAt, endsAt) => [{
  labels: {
    alertname: 'AilaoDaFormalPilotSynthetic',
    severity: 'info',
    drill_id: id,
  },
  annotations: {
    summary: 'Synthetic formal pilot delivery drill',
  },
  startsAt,
  endsAt,
  generatorURL: 'https://docs.invalid/ailaoda/formal-pilot',
}];
const submitAlert = async (id, startsAt, endsAt) => {
  const response = await request(`${alertmanagerUrl}/api/v2/alerts`, {
    method: 'POST',
    headers: { ...headers(tokens.alertmanager), 'content-type': 'application/json' },
    body: JSON.stringify(alertPayload(id, startsAt, endsAt)),
  });
  if (!response.ok) fail(`Alertmanager rejected synthetic alert: ${response.status}.`);
};
const normalizeReceipt = (body, resolution = false) => {
  const status = String(body?.status || '').trim();
  if (!['pending', 'delivered', 'failed'].includes(status)) fail('Receipt store returned unsupported status.');
  if (status !== 'delivered') return { status };
  if (resolution) {
    const resolvedAt = String(body?.resolvedAt || '');
    if (!Number.isFinite(Date.parse(resolvedAt))) fail('Resolution receipt has invalid resolvedAt.');
    return { status, resolvedAt };
  }
  const receiptId = String(body?.receiptId || '').trim();
  const receiver = String(body?.receiver || '').trim();
  const deliveredAt = String(body?.deliveredAt || '');
  if (!receiptId || !receiver || !Number.isFinite(Date.parse(deliveredAt))) fail('Alert receipt is incomplete.');
  return { status, receiptId, receiver, deliveredAt };
};

(async () => {
  switch (operation) {
    case 'trace': {
      if (!/^[0-9a-f]{32}$/.test(operationId)) fail('Trace ID must be 32 lowercase hexadecimal characters.');
      const { response, body } = await requestJson(
        `${tempoUrl}/api/traces/${operationId}`,
        tokens.tempo,
      );
      if (response.status === 404) {
        process.stdout.write('{"found":false}\n');
        return;
      }
      if (!response.ok || !body) fail(`Tempo trace query failed: ${response.status}.`);
      const batches = Array.isArray(body.batches) ? body.batches : [];
      const services = new Set();
      let spanCount = 0;
      for (const batch of batches) {
        for (const attribute of batch?.resource?.attributes || []) {
          if (attribute?.key === 'service.name' && attribute?.value?.stringValue) {
            services.add(String(attribute.value.stringValue));
          }
        }
        for (const scope of [...(batch?.scopeSpans || []), ...(batch?.instrumentationLibrarySpans || [])]) {
          spanCount += Array.isArray(scope?.spans) ? scope.spans.length : 0;
        }
      }
      process.stdout.write(`${JSON.stringify({
        found: services.has(serviceName) && spanCount > 0,
        service: services.has(serviceName) ? serviceName : '',
        spanCount,
        observedAt: new Date().toISOString(),
      })}\n`);
      return;
    }
    case 'send-alert': {
      if (!validDrillId(operationId)) fail('A valid observability drill ID is required.');
      const startsAt = new Date().toISOString();
      const endsAt = new Date(Date.now() + 600_000).toISOString();
      await submitAlert(operationId, startsAt, endsAt);
      writeState(operationId, { startsAt, submittedAt: startsAt });
      process.stdout.write(`${JSON.stringify({ sentAt: startsAt })}\n`);
      return;
    }
    case 'alert-receipt': {
      if (!validDrillId(operationId)) fail('A valid observability drill ID is required.');
      const { response, body } = await requestJson(
        `${receiptUrl}/v1/alerts/${encodeURIComponent(operationId)}`,
        tokens.receipt,
      );
      if (!response.ok) fail(`Alert receipt query failed: ${response.status}.`);
      process.stdout.write(`${JSON.stringify(normalizeReceipt(body))}\n`);
      return;
    }
    case 'resolve-alert': {
      const state = readState(operationId);
      const resolvedAt = new Date().toISOString();
      await submitAlert(operationId, state.startsAt, resolvedAt);
      writeState(operationId, { ...state, resolvedAt });
      return;
    }
    case 'resolution-receipt': {
      if (!validDrillId(operationId)) fail('A valid observability drill ID is required.');
      const { response, body } = await requestJson(
        `${receiptUrl}/v1/alerts/${encodeURIComponent(operationId)}/resolution`,
        tokens.receipt,
      );
      if (!response.ok) fail(`Resolution receipt query failed: ${response.status}.`);
      process.stdout.write(`${JSON.stringify(normalizeReceipt(body, true))}\n`);
      return;
    }
    default:
      fail('Unsupported operation. Expected trace, send-alert, alert-receipt, resolve-alert, or resolution-receipt.');
  }
})().catch(error => fail(String(error?.message || error)));
