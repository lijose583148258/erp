const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');

test('both active verification controllers use the same service and no longer publish new verification events', () => {
  const order = read('backend/src/controllers/order-payment.controller.ts').split('export async function verifyOrderPayment')[1];
  const collection = read('backend/src/controllers/collection/collection-verification-hold.controller.ts').split('async setCustomerHold')[0];
  for (const source of [order, collection]) {
    assert(source.includes('CollectionStateService.verifyPaymentRecord'));
    assert(!source.includes('publishWebhookEvent('));
    assert(!source.includes('publishRealtimeNotification('));
    assert(source.includes('requireFinanceCollectionScope'));
    assert(source.includes('createdBy === req.user!.userId'));
  }
});
test('verification event is committed inside the same retryable transaction', () => {
  const source = read('backend/src/services/collection-state.service.ts');
  const start = source.indexOf('const verified = await withDbRetry');
  const event = source.indexOf('await recordPaymentVerifiedEventTx', start);
  const end = source.indexOf("{ label: 'verifyPaymentRecord' }", start);
  assert(start > 0 && event > start && end > event);
  assert(source.includes('if (current?.status === \'verified\') return false;'));
});
test('worker is attached to normal runtime startup and shutdown', () => {
  const source = read('backend/src/server.ts');
  assert(source.includes('startPaymentEventOutbox();'));
  assert(source.includes('const outboxStopped = stopPaymentEventOutbox();'));
  assert(source.indexOf('await outboxStopped') < source.indexOf('await prisma.$disconnect()'));
});
test('frontend session de-duplication is wired to message reception and logout', () => {
  assert(read('services/realtime.service.ts').includes('eventDedup.accept(event.id)'));
  assert(read('services/realtime.service.ts').includes('eventDedup.clear()'));
});
test('new schema is additive for both providers and does not backfill historical event identities', () => {
  const sqlite = read('backend/src/database/runtime-schema-payment-event-repair.ts');
  const pg = read('backend/prisma/postgres-migrations/202610020001_payment-event-outbox/migration.sql');
  for (const sql of [sqlite, pg]) {
    for (const field of ['event_key', 'destination_key', 'lease_token', 'lease_expires_at', 'last_error_code']) assert(sql.includes(field));
    assert(!/UPDATE\s+"?(payment_records|business_events)"?\s+SET/i.test(sql));
    assert(sql.includes('ON DELETE RESTRICT'));
  }
});

test('payment migration covers db-push bootstrap and explicit CHECK installation', () => {
  const pg = read('backend/prisma/postgres-migrations/202610020001_payment-event-outbox/migration.sql');
  assert(pg.includes('ADD COLUMN IF NOT EXISTS "event_key"'));
  assert(pg.includes('CREATE TABLE IF NOT EXISTS "business_event_deliveries"'));
  assert(!/^CREATE (?:UNIQUE )?INDEX "/m.test(pg));
  for (const column of ['channel', 'status', 'attempts']) {
    assert(pg.includes(`ADD CONSTRAINT "business_event_deliveries_${column}_check"`));
  }
  const workflow = read('.github/workflows/enterprise-cloud-sandbox.yml');
  assert(workflow.includes('node scripts/payment-event-migration-audit-v1.cjs'));
  const probe = read('scripts/payment-event-migration-audit-v1.cjs');
  assert(probe.includes("['bootstrap', 'upgrade']"));
  assert(probe.includes("code: '23505'")); assert(probe.includes("code: '23514'"));
  assert(probe.includes("code: '23503'"));
});
