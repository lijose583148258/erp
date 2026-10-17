-- Preserve historical shipments and leave their unknown request identities NULL.
ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "submission_key" TEXT,
  ADD COLUMN IF NOT EXISTS "submission_fingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "submission_json" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "shipments_submission_key_key"
  ON "shipments"("submission_key");
