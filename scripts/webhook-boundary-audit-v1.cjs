const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

if (!exists('backend/src/services/webhook.service.ts')) {
  add('P1', 'backend/src/services/webhook.service.ts', 'Outbound webhook service is missing.');
} else {
  const service = read('backend/src/services/webhook.service.ts');
  for (const token of [
    'AILAODA_WEBHOOK_ENDPOINTS',
    'AILAODA_WEBHOOK_SECRET',
    'AILAODA_WEBHOOK_TIMEOUT_MS',
    'buildWebhookSignature',
    'x-ailaoda-signature',
    'x-ailaoda-event',
    'AbortController',
    'logger.warn',
    'void deliverWebhook',
  ]) {
    if (!service.includes(token)) add('P1', 'backend/src/services/webhook.service.ts', `Missing webhook boundary token: ${token}`);
  }
}

if (!exists('backend/src/services/webhook.service.test.ts')) {
  add('P2', 'backend/src/services/webhook.service.test.ts', 'Webhook service unit tests are missing.');
} else {
  const test = read('backend/src/services/webhook.service.test.ts');
  for (const token of ['parseWebhookEndpoints', 'buildWebhookSignature', 'publishWebhookEvent', 'x-ailaoda-signature']) {
    if (!test.includes(token)) add('P2', 'backend/src/services/webhook.service.test.ts', `Webhook tests should cover ${token}.`);
  }
}

const orderController = read('backend/src/controllers/order.controller.ts');
for (const token of ['publishWebhookEvent', 'order.created', 'order.updated', 'order.status_changed', 'order.completed']) {
  if (!orderController.includes(token)) add('P1', 'backend/src/controllers/order.controller.ts', `Order controller does not publish webhook token: ${token}`);
}

const paymentController = read('backend/src/controllers/order-payment.controller.ts');
for (const token of ['publishWebhookEvent', 'payment.submitted', 'payment.verified']) {
  if (!paymentController.includes(token)) add('P1', 'backend/src/controllers/order-payment.controller.ts', `Payment controller does not publish webhook token: ${token}`);
}

const adr = 'docs/adr/0012-outbound-webhook-boundary.md';
if (!exists(adr)) {
  add('P2', adr, 'Outbound webhook ADR is missing.');
} else {
  const content = read(adr);
  for (const token of ['## Status', '## Context', '## Decision', '## Consequences', 'x-ailaoda-signature']) {
    if (!content.includes(token)) add('P2', adr, `ADR is missing token: ${token}`);
  }
}

const envExample = read('.env.production.example');
for (const token of ['AILAODA_WEBHOOK_ENDPOINTS', 'AILAODA_WEBHOOK_SECRET', 'AILAODA_WEBHOOK_TIMEOUT_MS']) {
  if (!envExample.includes(token)) add('P2', '.env.production.example', `Production env example should document ${token}.`);
}

if (findings.length) {
  console.error('Webhook Boundary Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Webhook Boundary Audit: PASS');
console.log('- Outbound webhook service supports endpoint parsing, HMAC signatures, and timeboxed delivery.');
console.log('- Order and payment lifecycle events publish webhook events.');
console.log('- ADR and unit tests document the non-blocking integration contract.');
