-- Preserve historical events and payments; only new verifications get event keys.
-- The isolated bootstrap uses Prisma db push before the versioned migrator.
-- Existing installations instead reach this migration without these objects.
ALTER TABLE "business_events" ADD COLUMN IF NOT EXISTS "event_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "business_events_event_key_key" ON "business_events"("event_key");
CREATE TABLE IF NOT EXISTS "business_event_deliveries" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "event_id" INTEGER NOT NULL REFERENCES "business_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "channel" TEXT NOT NULL,
    "destination_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "business_event_deliveries_event_id_channel_destination_key_key" ON "business_event_deliveries"("event_id", "channel", "destination_key");
CREATE INDEX IF NOT EXISTS "business_event_deliveries_status_next_attempt_at_idx" ON "business_event_deliveries"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "business_event_deliveries_status_lease_expires_at_idx" ON "business_event_deliveries"("status", "lease_expires_at");

-- Prisma does not materialize SQL CHECK constraints. Creating the table with
-- IF NOT EXISTS alone would silently omit these checks on the bootstrap path.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'business_event_deliveries'::regclass AND conname = 'business_event_deliveries_channel_check') THEN
        ALTER TABLE "business_event_deliveries" ADD CONSTRAINT "business_event_deliveries_channel_check" CHECK ("channel" IN ('webhook', 'realtime'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'business_event_deliveries'::regclass AND conname = 'business_event_deliveries_status_check') THEN
        ALTER TABLE "business_event_deliveries" ADD CONSTRAINT "business_event_deliveries_status_check" CHECK ("status" IN ('pending', 'sending', 'delivered'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'business_event_deliveries'::regclass AND conname = 'business_event_deliveries_attempts_check') THEN
        ALTER TABLE "business_event_deliveries" ADD CONSTRAINT "business_event_deliveries_attempts_check" CHECK ("attempts" >= 0);
    END IF;
END $$;
