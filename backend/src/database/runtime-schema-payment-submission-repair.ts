import { createIndexIfMissing, createTableIfMissing, ensureTriggerDefinition, type SchemaRepairReport } from './runtime-schema-repair-utils';

export async function repairPaymentSubmissionSchema(report: SchemaRepairReport) {
  await createTableIfMissing(report, 'payment_submissions', `CREATE TABLE "payment_submissions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_key" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "fingerprint" TEXT NOT NULL,
    "payment_id" INTEGER NOT NULL REFERENCES "payment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "result_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await createIndexIfMissing(report, 'payment_submissions_request_key_key', 'CREATE UNIQUE INDEX "payment_submissions_request_key_key" ON "payment_submissions"("request_key")');
  await createIndexIfMissing(report, 'payment_submissions_payment_id_key', 'CREATE UNIQUE INDEX "payment_submissions_payment_id_key" ON "payment_submissions"("payment_id")');
  await createIndexIfMissing(report, 'payment_submissions_user_id_created_at_idx', 'CREATE INDEX "payment_submissions_user_id_created_at_idx" ON "payment_submissions"("user_id", "created_at")');
  for (const action of ['UPDATE', 'DELETE']) await ensureTriggerDefinition(report, `payment_submissions_immutable_${action.toLowerCase()}`,
    `CREATE TRIGGER "payment_submissions_immutable_${action.toLowerCase()}" BEFORE ${action} ON "payment_submissions"
     BEGIN SELECT RAISE(ABORT, 'PAYMENT_SUBMISSION_IMMUTABLE'); END`);
  await ensureTriggerDefinition(report, 'payment_submissions_valid_insert', `CREATE TRIGGER "payment_submissions_valid_insert" BEFORE INSERT ON "payment_submissions"
    WHEN length(NEW."request_key") < 8 OR length(NEW."request_key") > 100 OR length(NEW."fingerprint") <> 64 OR NEW."fingerprint" GLOB '*[^0-9a-f]*'
      OR substr(NEW."request_key",1,1) GLOB '[^A-Za-z0-9]' OR NEW."request_key" GLOB '*[^A-Za-z0-9._:-]*'
      OR json_valid(NEW."result_json") <> 1 OR json_type(NEW."result_json") <> 'object'
    BEGIN SELECT RAISE(ABORT, 'PAYMENT_SUBMISSION_INVALID'); END`);
}
