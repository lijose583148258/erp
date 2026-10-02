-- Preserve historical events and payments; only new verifications get event keys.
ALTER TABLE "business_events" ADD COLUMN "event_key" TEXT;
CREATE UNIQUE INDEX "business_events_event_key_key" ON "business_events"("event_key");
CREATE TABLE "business_event_deliveries" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "event_id" INTEGER NOT NULL REFERENCES "business_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "channel" TEXT NOT NULL CHECK ("channel" IN ('webhook', 'realtime')),
    "destination_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'sending', 'delivered')),
    "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "business_event_deliveries_event_id_channel_destination_key_key" ON "business_event_deliveries"("event_id", "channel", "destination_key");
CREATE INDEX "business_event_deliveries_status_next_attempt_at_idx" ON "business_event_deliveries"("status", "next_attempt_at");
CREATE INDEX "business_event_deliveries_status_lease_expires_at_idx" ON "business_event_deliveries"("status", "lease_expires_at");
