// Sandbox-only signed receiver. Its append-only receipt models a downstream
// consumer's idempotency key; transport may deliver the same event repeatedly.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

async function createPaymentEventReceiver({ secret, folder, host = '127.0.0.1', port = 0 }) {
  assert(typeof secret === 'string' && secret.length >= 32);
  fs.mkdirSync(folder, { recursive: true });
  const ledgerFile = path.join(folder, 'receipts.jsonl');
  const accepted = new Map();
  if (fs.existsSync(ledgerFile)) for (const line of fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line); accepted.set(row.eventId, row);
  }
  let target = null;
  const attempts = [];
  const sockets = new Set();
  const equal = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const server = http.createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 65536) { reply(413, {}); return; } }
      if (req.url !== '/events') {
        if (!equal(req.headers.authorization, `Bearer ${secret}`)) { reply(401, {}); return; }
        if (req.method === 'POST' && req.url === '/arm') {
          const data = JSON.parse(raw); assert(Number.isSafeInteger(data.paymentId) && data.paymentId > 0);
          assert(!target || target.release, 'Previous target has not been released');
          target = { paymentId: data.paymentId, requests: 0, phase: 'armed', release: false };
          reply(200, { armed: true }); return;
        }
        if (req.method === 'POST' && req.url === '/release') {
          assert(target); target.release = true; reply(200, { released: true }); return;
        }
        if (req.method === 'GET' && req.url === '/state') {
          reply(200, { target, attempts: attempts.filter(a => a.paymentId === target?.paymentId),
            accepted: [...accepted.values()].filter(a => a.paymentId === target?.paymentId) }); return;
        }
        reply(404, {}); return;
      }
      const timestamp = req.headers['x-ailaoda-timestamp'];
      const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
      if (!equal(req.headers['x-ailaoda-signature'], signature)) { reply(401, {}); return; }
      const event = JSON.parse(raw);
      assert.equal(event.type, 'payment.verified'); assert.equal(req.headers['x-ailaoda-event-id'], event.id);
      assert(Number.isSafeInteger(Number(event.data.paymentId)));
      const digest = crypto.createHash('sha256').update(raw).digest('hex');
      const matching = target && Number(event.data.paymentId) === target.paymentId;
      const attempt = { paymentId: Number(event.data.paymentId), eventId: event.id, digest, at: new Date().toISOString(), signatureValid: true };
      attempts.push(attempt);
      if (matching && ++target.requests === 1) { target.phase = 'rejected-503'; attempt.status = 503; reply(503, {}); return; }
      const prior = accepted.get(event.id);
      if (prior && prior.digest !== digest) { attempt.status = 409; reply(409, { error: 'EVENT_ID_PAYLOAD_CHANGED' }); return; }
      if (!prior) {
        const row = { eventId: event.id, paymentId: Number(event.data.paymentId), orderId: event.data.orderId,
          amount: Number(event.data.amount), digest, acceptedAt: new Date().toISOString(), effects: 1 };
        const fd = fs.openSync(ledgerFile, 'a');
        try { fs.writeSync(fd, `${JSON.stringify(row)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        accepted.set(event.id, row);
      }
      if (matching && !target.release) {
        // Commit downstream but withhold the HTTP acknowledgement. The test
        // kills the actual application processes while this request is open.
        target.phase = 'accepted-awaiting-ack'; attempt.status = 'ack-withheld'; return;
      }
      if (matching) target.phase = 'acknowledged';
      attempt.status = 202; reply(202, { eventId: event.id, replay: !!prior });
    } catch (error) { if (!res.headersSent) reply(400, { error: error.message }); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, port: server.address().port, close: async () => {
    for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  } };
}

if (require.main === module) {
  assert.equal(process.env.PAYMENT_EVENT_FIXTURE_ALLOW, 'true');
  const folder = path.resolve(process.env.PAYMENT_EVENT_FIXTURE_FOLDER || 'output/audit/payment-event-receiver');
  const output = path.resolve(__dirname, '../../output');
  assert(folder.startsWith(output + path.sep), 'Fixture evidence must stay in output');
  createPaymentEventReceiver({ secret: process.env.AILAODA_WEBHOOK_SECRET, folder,
    host: process.env.PAYMENT_EVENT_FIXTURE_HOST || '127.0.0.1', port: Number(process.env.PAYMENT_EVENT_FIXTURE_PORT) || 0,
  }).then(receiver => {
    console.log(JSON.stringify({ ready: true, port: receiver.port }));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => receiver.close().finally(() => process.exit()));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createPaymentEventReceiver };
