-- New registrations only. Do not manufacture identities for historical payments.
CREATE TABLE IF NOT EXISTS "payment_submissions" (
  "id" SERIAL PRIMARY KEY,
  "request_key" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fingerprint" TEXT NOT NULL,
  "payment_id" INTEGER NOT NULL REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "result_json" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_submissions_request_key_key" ON "payment_submissions"("request_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_submissions_payment_id_key" ON "payment_submissions"("payment_id");
CREATE INDEX IF NOT EXISTS "payment_submissions_user_id_created_at_idx" ON "payment_submissions"("user_id", "created_at");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='payment_submissions'::regclass AND conname='payment_submissions_facts_check') THEN
    ALTER TABLE "payment_submissions" ADD CONSTRAINT "payment_submissions_facts_check" CHECK (
      "request_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$' AND "fingerprint" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("result_json"::jsonb) = 'object'
    );
  END IF;
END $$;
CREATE OR REPLACE FUNCTION payment_submissions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PAYMENT_SUBMISSION_IMMUTABLE' USING ERRCODE = '23514'; END $$;
DROP TRIGGER IF EXISTS payment_submissions_immutable ON "payment_submissions";
CREATE TRIGGER payment_submissions_immutable BEFORE UPDATE OR DELETE ON "payment_submissions"
  FOR EACH ROW EXECUTE FUNCTION payment_submissions_immutable();
