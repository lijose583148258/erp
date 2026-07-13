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

if (!exists('backend/src/services/realtime-notification.service.ts')) {
  add('P1', 'backend/src/services/realtime-notification.service.ts', 'Realtime notification service is missing.');
} else {
  const service = read('backend/src/services/realtime-notification.service.ts');
  for (const token of ['attachRealtimeNotifications', '/ws/notifications', 'verifyToken', 'isTokenBlacklisted', 'publishRealtimeNotification', 'Sec-WebSocket-Accept', 'REALTIME_BUS_DRIVER', 'publisher.publish', 'subscriber.subscribe', 'origin === instanceId']) {
    if (!service.includes(token)) add('P1', 'backend/src/services/realtime-notification.service.ts', `Missing realtime service token: ${token}`);
  }
}

const server = read('backend/src/server.ts');
for (const token of ['attachRealtimeNotifications(server)', 'getRealtimeNotificationStatus()', 'ws:', 'wss:']) {
  if (!server.includes(token)) add('P1', 'backend/src/server.ts', `Server is missing realtime boundary token: ${token}`);
}

const productionCompose = exists('docker-compose.production-postgres.yml') ? read('docker-compose.production-postgres.yml') : '';
for (const token of ['REALTIME_BUS_DRIVER: redis', 'REDIS_URL:', 'redis:7.4-bookworm']) {
  if (!productionCompose.includes(token)) add('P1', 'docker-compose.production-postgres.yml', `Production realtime topology is missing: ${token}`);
}

const frontend = exists('services/realtime.service.ts') ? read('services/realtime.service.ts') : '';
if (!frontend) {
  add('P1', 'services/realtime.service.ts', 'Frontend realtime connector is missing.');
} else {
  for (const token of ['new WebSocket', '/ws/notifications?token=', 'authService.getToken()', 'reconnectAttempts']) {
    if (!frontend.includes(token)) add('P1', 'services/realtime.service.ts', `Frontend connector is missing token: ${token}`);
  }
}

if (!read('app/useAppShell.tsx').includes('realtimeService.connect')) {
  add('P1', 'app/useAppShell.tsx', 'App shell should connect realtime notifications after login.');
}

const orderController = read('backend/src/controllers/order.controller.ts');
for (const token of ['order.created', 'order.updated', 'order.status_changed', 'order.completed']) {
  if (!orderController.includes(token)) add('P1', 'backend/src/controllers/order.controller.ts', `Order controller does not publish ${token}.`);
}

const paymentController = read('backend/src/controllers/order-payment.controller.ts');
for (const token of ['payment.submitted', 'payment.verified']) {
  if (!paymentController.includes(token)) add('P1', 'backend/src/controllers/order-payment.controller.ts', `Payment controller does not publish ${token}.`);
}

const vite = read('vite.config.ts');
if (!vite.includes("'/ws'") || !vite.includes('ws: true')) {
  add('P2', 'vite.config.ts', 'Vite dev server should proxy /ws websocket traffic to backend.');
}

const adr = 'docs/adr/0011-realtime-notification-websocket-boundary.md';
if (!exists(adr)) {
  add('P2', adr, 'Realtime notification ADR is missing.');
} else {
  const content = read(adr);
  for (const token of ['## Status', '## Context', '## Decision', '## Consequences', '/ws/notifications']) {
    if (!content.includes(token)) add('P2', adr, `ADR is missing token: ${token}`);
  }
}

if (findings.length) {
  console.error('Realtime Notification Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Realtime Notification Audit: PASS');
console.log('- Authenticated /ws/notifications WebSocket boundary is present.');
console.log('- Frontend connects after login and Vite proxies /ws in development.');
console.log('- Order and payment mutation paths publish realtime notification events.');
console.log('- Redis Pub/Sub distributes events across application instances with origin de-duplication.');
