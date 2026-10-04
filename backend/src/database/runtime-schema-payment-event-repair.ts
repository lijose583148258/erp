import { addColumnIfMissing, createIndexIfMissing, createTableIfMissing, type SchemaRepairReport } from './runtime-schema-repair-utils';

export const repairPaymentEventSchema = async (report: SchemaRepairReport) => {
  // Nullable for historical events: never invent audit evidence for old payments.
  await addColumnIfMissing(report, 'business_events', 'event_key', 'TEXT');
  await createIndexIfMissing(report, 'business_events_event_key_key', 'CREATE UNIQUE INDEX "business_events_event_key_key" ON "business_events"("event_key")');
  await createTableIfMissing(report, 'business_event_deliveries', `
    CREATE TABLE "business_event_deliveries" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "event_id" INTEGER NOT NULL REFERENCES "business_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "channel" TEXT NOT NULL CHECK ("channel" IN ('webhook', 'realtime')),
      "destination_key" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'sending', 'delivered')),
      "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
      "next_attempt_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lease_token" TEXT,
      "lease_expires_at" DATETIME,
      "delivered_at" DATETIME,
      "last_error_code" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await createIndexIfMissing(report, 'business_event_deliveries_event_id_channel_destination_key_key', 'CREATE UNIQUE INDEX "business_event_deliveries_event_id_channel_destination_key_key" ON "business_event_deliveries"("event_id", "channel", "destination_key")');
  await createIndexIfMissing(report, 'business_event_deliveries_status_next_attempt_at_idx', 'CREATE INDEX "business_event_deliveries_status_next_attempt_at_idx" ON "business_event_deliveries"("status", "next_attempt_at")');
  await createIndexIfMissing(report, 'business_event_deliveries_status_lease_expires_at_idx', 'CREATE INDEX "business_event_deliveries_status_lease_expires_at_idx" ON "business_event_deliveries"("status", "lease_expires_at")');
};
