-- Original-payment reversal facts only. No identities invented for history.
CREATE TABLE IF NOT EXISTS "payment_reversal_requests" (
          "id" TEXT PRIMARY KEY NOT NULL, "request_key" TEXT NOT NULL, "payment_id" INTEGER NOT NULL REFERENCES "payment_records"("id") ON DELETE RESTRICT,
          "active_payment_id" INTEGER, "requested_by" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
          "reason_category" TEXT NOT NULL, "reason" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
          "original_payment_json" TEXT NOT NULL, "request_receipt_json" TEXT NOT NULL,
          "request_audit_id" INTEGER NOT NULL REFERENCES "audit_logs"("id") ON DELETE RESTRICT,
          "original_audit_id" INTEGER REFERENCES "audit_logs"("id") ON DELETE RESTRICT, "status" TEXT NOT NULL DEFAULT 'pending',
          "review_key" TEXT, "review_fingerprint" TEXT, "reviewed_by" INTEGER REFERENCES "users"("id") ON DELETE RESTRICT,
          "review_note" TEXT, "review_audit_id" INTEGER REFERENCES "audit_logs"("id") ON DELETE RESTRICT,
          "review_receipt_json" TEXT, "reviewed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
CREATE TABLE IF NOT EXISTS "payment_reversals" (
          "id" TEXT PRIMARY KEY NOT NULL, "payment_id" INTEGER NOT NULL REFERENCES "payment_records"("id") ON DELETE RESTRICT,
          "request_id" TEXT NOT NULL REFERENCES "payment_reversal_requests"("id") ON DELETE RESTRICT,
          "posted_by" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
          "audit_id" INTEGER NOT NULL REFERENCES "audit_logs"("id") ON DELETE RESTRICT,
          "amount" DOUBLE PRECISION NOT NULL, "currency" TEXT NOT NULL,
          "before_state_json" TEXT NOT NULL, "after_state_json" TEXT NOT NULL, "receipt_json" TEXT NOT NULL,
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversal_requests_request_key_key" ON "payment_reversal_requests"("request_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversal_requests_active_payment_id_key" ON "payment_reversal_requests"("active_payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversal_requests_request_audit_id_key" ON "payment_reversal_requests"("request_audit_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversal_requests_review_key_key" ON "payment_reversal_requests"("review_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversal_requests_review_audit_id_key" ON "payment_reversal_requests"("review_audit_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversals_payment_id_key" ON "payment_reversals"("payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversals_request_id_key" ON "payment_reversals"("request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_reversals_audit_id_key" ON "payment_reversals"("audit_id");
CREATE INDEX IF NOT EXISTS "payment_reversal_requests_payment_id_created_at_idx" ON "payment_reversal_requests"("payment_id","created_at");
CREATE OR REPLACE FUNCTION payment_reversal_request_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$' OR NEW.fingerprint !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(NEW.original_payment_json::jsonb) <> 'object' OR jsonb_typeof(NEW.request_receipt_json::jsonb) <> 'object'
      OR NEW.status <> 'pending' OR NEW.active_payment_id IS DISTINCT FROM NEW.payment_id
      OR NEW.review_key IS NOT NULL OR NEW.review_fingerprint IS NOT NULL OR NEW.reviewed_by IS NOT NULL OR NEW.review_note IS NOT NULL
      OR NEW.review_audit_id IS NOT NULL OR NEW.review_receipt_json IS NOT NULL OR NEW.reviewed_at IS NOT NULL
      OR NEW.reason_category NOT IN ('registration_error','bank_return') OR length(NEW.reason) < 5 OR length(NEW.reason) > 2000
      OR NOT EXISTS (SELECT 1 FROM payment_records p WHERE p.id=NEW.payment_id AND p.status='verified' AND p.currency='CNY' AND p.amount>0
        AND p.method IN ('bank_transfer','cash','alipay','wechat','check','wire_transfer') AND p.barter_metadata IS NULL)
      OR NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.id=NEW.request_audit_id AND a.user_id=NEW.requested_by AND a.action='PAYMENT_REVERSAL_REQUESTED' AND a.resource='payment' AND a.resource_id=NEW.payment_id) THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_REQUEST_INVALID' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_request_insert" ON "payment_reversal_requests";
CREATE TRIGGER "payment_reversal_request_insert" BEFORE INSERT ON "payment_reversal_requests" FOR EACH ROW EXECUTE FUNCTION payment_reversal_request_insert_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_request_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF 1=1 THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_REQUEST_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN OLD; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_request_delete" ON "payment_reversal_requests";
CREATE TRIGGER "payment_reversal_request_delete" BEFORE DELETE ON "payment_reversal_requests" FOR EACH ROW EXECUTE FUNCTION payment_reversal_request_delete_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_request_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status <> 'pending' OR NEW.status NOT IN ('posted','rejected')
      OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."request_key" IS DISTINCT FROM OLD."request_key" OR NEW."payment_id" IS DISTINCT FROM OLD."payment_id" OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by" OR NEW."reason_category" IS DISTINCT FROM OLD."reason_category" OR NEW."reason" IS DISTINCT FROM OLD."reason" OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint" OR NEW."original_payment_json" IS DISTINCT FROM OLD."original_payment_json" OR NEW."request_receipt_json" IS DISTINCT FROM OLD."request_receipt_json" OR NEW."request_audit_id" IS DISTINCT FROM OLD."request_audit_id" OR NEW."original_audit_id" IS DISTINCT FROM OLD."original_audit_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR NEW.active_payment_id IS NOT NULL OR NEW.reviewed_by IS NULL OR NEW.reviewed_by=NEW.requested_by
      OR NEW.review_key IS NULL OR NEW.review_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$' OR NEW.review_fingerprint IS NULL OR NEW.review_fingerprint !~ '^[0-9a-f]{64}$'
      OR NEW.review_note IS NULL OR length(NEW.review_note)<5 OR length(NEW.review_note)>2000 OR NEW.reviewed_at IS NULL OR NEW.review_audit_id IS NULL
      OR NEW.review_receipt_json IS NULL OR jsonb_typeof(NEW.review_receipt_json::jsonb) <> 'object'
      OR NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.id=NEW.review_audit_id AND a.user_id=NEW.reviewed_by AND a.resource='payment' AND a.resource_id=NEW.payment_id
        AND a.action=CASE WHEN NEW.status='posted' THEN 'PAYMENT_REVERSED' ELSE 'PAYMENT_REVERSAL_REJECTED' END)
      OR (NEW.status='posted' AND NOT EXISTS (SELECT 1 FROM payment_reversals e WHERE e.request_id=NEW.id AND e.payment_id=NEW.payment_id AND e.posted_by=NEW.reviewed_by AND e.audit_id=NEW.review_audit_id AND e.receipt_json=NEW.review_receipt_json))
      OR (NEW.status='rejected' AND EXISTS (SELECT 1 FROM payment_reversals e WHERE e.request_id=NEW.id)) THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_REQUEST_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_request_review" ON "payment_reversal_requests";
CREATE TRIGGER "payment_reversal_request_review" BEFORE UPDATE ON "payment_reversal_requests" FOR EACH ROW EXECUTE FUNCTION payment_reversal_request_review_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_effect_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.currency <> 'CNY' OR NEW.amount >= 0
      OR jsonb_typeof(NEW.before_state_json::jsonb) <> 'object' OR jsonb_typeof(NEW.after_state_json::jsonb) <> 'object' OR jsonb_typeof(NEW.receipt_json::jsonb) <> 'object'
      OR NOT EXISTS (SELECT 1 FROM payment_records p JOIN payment_reversal_requests r ON r.payment_id=p.id
        WHERE p.id=NEW.payment_id AND r.id=NEW.request_id AND r.status='pending' AND p.status='verified'
        AND p.currency=NEW.currency AND NEW.amount=-p.amount AND NEW.posted_by<>r.requested_by)
      OR NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.id=NEW.audit_id AND a.user_id=NEW.posted_by AND a.action='PAYMENT_REVERSED' AND a.resource='payment' AND a.resource_id=NEW.payment_id) THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_EFFECT_INVALID' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_effect_insert" ON "payment_reversals";
CREATE TRIGGER "payment_reversal_effect_insert" BEFORE INSERT ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION payment_reversal_effect_insert_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_effect_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF 1=1 THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_effect_update" ON "payment_reversals";
CREATE TRIGGER "payment_reversal_effect_update" BEFORE UPDATE ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION payment_reversal_effect_update_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_effect_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF 1=1 THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN OLD; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_effect_delete" ON "payment_reversals";
CREATE TRIGGER "payment_reversal_effect_delete" BEFORE DELETE ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION payment_reversal_effect_delete_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_original_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM payment_reversal_requests r WHERE r.payment_id=OLD.id) AND (
      NEW."id" IS DISTINCT FROM OLD."id" OR NEW."order_id" IS DISTINCT FROM OLD."order_id" OR NEW."amount" IS DISTINCT FROM OLD."amount" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate" OR NEW."base_amount" IS DISTINCT FROM OLD."base_amount" OR NEW."method" IS DISTINCT FROM OLD."method" OR NEW."date" IS DISTINCT FROM OLD."date" OR NEW."payer_name" IS DISTINCT FROM OLD."payer_name" OR NEW."is_proxy" IS DISTINCT FROM OLD."is_proxy" OR NEW."note" IS DISTINCT FROM OLD."note" OR NEW."verified_by" IS DISTINCT FROM OLD."verified_by" OR NEW."milestone_id" IS DISTINCT FROM OLD."milestone_id" OR NEW."barter_metadata" IS DISTINCT FROM OLD."barter_metadata" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='verified' AND NEW.status='reversed' AND EXISTS
        (SELECT 1 FROM payment_reversals e JOIN payment_reversal_requests r ON r.id=e.request_id WHERE e.payment_id=OLD.id AND r.status='posted')))
    ) THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_ORIGINAL_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_original_update" ON "payment_records";
CREATE TRIGGER "payment_reversal_original_update" BEFORE UPDATE ON "payment_records" FOR EACH ROW EXECUTE FUNCTION payment_reversal_original_update_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_audit_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM payment_reversal_requests r WHERE r.request_audit_id=OLD.id OR r.original_audit_id=OLD.id OR r.review_audit_id=OLD.id) OR EXISTS (SELECT 1 FROM payment_reversals e WHERE e.audit_id=OLD.id) THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_AUDIT_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_audit_update" ON "audit_logs";
CREATE TRIGGER "payment_reversal_audit_update" BEFORE UPDATE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION payment_reversal_audit_update_guard();;
CREATE OR REPLACE FUNCTION payment_reversal_audit_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM payment_reversal_requests r WHERE r.request_audit_id=OLD.id OR r.original_audit_id=OLD.id OR r.review_audit_id=OLD.id) OR EXISTS (SELECT 1 FROM payment_reversals e WHERE e.audit_id=OLD.id) THEN RAISE EXCEPTION 'PAYMENT_REVERSAL_AUDIT_IMMUTABLE' USING ERRCODE='23514'; END IF; RETURN OLD; END $$;
DROP TRIGGER IF EXISTS "payment_reversal_audit_delete" ON "audit_logs";
CREATE TRIGGER "payment_reversal_audit_delete" BEFORE DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION payment_reversal_audit_delete_guard();;
