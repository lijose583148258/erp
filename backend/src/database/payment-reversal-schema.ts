type Provider = 'sqlite' | 'postgresql';
export function paymentReversalSchema(provider: Provider) {
    const time = provider === 'sqlite' ? 'DATETIME' : 'TIMESTAMP(3)';
    const tables = [
        ['payment_reversal_requests', `CREATE TABLE IF NOT EXISTS "payment_reversal_requests" (
          "id" TEXT PRIMARY KEY NOT NULL, "request_key" TEXT NOT NULL, "payment_id" INTEGER NOT NULL REFERENCES "payment_records"("id") ON DELETE RESTRICT,
          "active_payment_id" INTEGER, "requested_by" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
          "reason_category" TEXT NOT NULL, "reason" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
          "original_payment_json" TEXT NOT NULL, "request_receipt_json" TEXT NOT NULL,
          "request_audit_id" INTEGER NOT NULL REFERENCES "audit_logs"("id") ON DELETE RESTRICT,
          "original_audit_id" INTEGER REFERENCES "audit_logs"("id") ON DELETE RESTRICT, "status" TEXT NOT NULL DEFAULT 'pending',
          "review_key" TEXT, "review_fingerprint" TEXT, "reviewed_by" INTEGER REFERENCES "users"("id") ON DELETE RESTRICT,
          "review_note" TEXT, "review_audit_id" INTEGER REFERENCES "audit_logs"("id") ON DELETE RESTRICT,
          "review_receipt_json" TEXT, "reviewed_at" ${time}, "created_at" ${time} NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`],
        ['payment_reversals', `CREATE TABLE IF NOT EXISTS "payment_reversals" (
          "id" TEXT PRIMARY KEY NOT NULL, "payment_id" INTEGER NOT NULL REFERENCES "payment_records"("id") ON DELETE RESTRICT,
          "request_id" TEXT NOT NULL REFERENCES "payment_reversal_requests"("id") ON DELETE RESTRICT,
          "posted_by" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
          "audit_id" INTEGER NOT NULL REFERENCES "audit_logs"("id") ON DELETE RESTRICT,
          "amount" ${provider === 'sqlite' ? 'REAL' : 'DOUBLE PRECISION'} NOT NULL, "currency" TEXT NOT NULL,
          "before_state_json" TEXT NOT NULL, "after_state_json" TEXT NOT NULL, "receipt_json" TEXT NOT NULL,
          "created_at" ${time} NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`],
    ] as const;
    const indexes: Array<[string,string]> = [];
    for (const [table, fields] of [['payment_reversal_requests',['request_key','active_payment_id','request_audit_id','review_key','review_audit_id']],
        ['payment_reversals',['payment_id','request_id','audit_id']]] as const) {
        for (const field of fields) { const name = `${table}_${field}_key`; indexes.push([name, `CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON "${table}"("${field}")`]); }
    }
    indexes.push(['payment_reversal_requests_payment_id_created_at_idx', 'CREATE INDEX IF NOT EXISTS "payment_reversal_requests_payment_id_created_at_idx" ON "payment_reversal_requests"("payment_id","created_at")']);
    const distinct = (a: string, b: string) => `${a} ${provider === 'sqlite' ? 'IS NOT' : 'IS DISTINCT FROM'} ${b}`;
    const invalidKey = (c: string) => provider === 'sqlite'
        ? `length(${c}) < 8 OR length(${c}) > 100 OR substr(${c},1,1) GLOB '[^A-Za-z0-9]' OR ${c} GLOB '*[^A-Za-z0-9._:-]*'`
        : `${c} !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$'`;
    const invalidHash = (c: string) => provider === 'sqlite' ? `length(${c}) <> 64 OR ${c} GLOB '*[^0-9a-f]*'` : `${c} !~ '^[0-9a-f]{64}$'`;
    const invalidObject = (c: string) => provider === 'sqlite' ? `json_valid(${c}) <> 1 OR json_type(${c}) <> 'object'` : `jsonb_typeof(${c}::jsonb) <> 'object'`;
    const changed = (columns: string[]) => columns.map(c => distinct(`NEW."${c}"`, `OLD."${c}"`)).join(' OR ');
    const guards: Array<{ name: string; table: string; operation: string; condition: string; code: string }> = [];
    const guard = (name: string, table: string, operation: string, condition: string, code: string) => guards.push({ name, table, operation, condition, code });
    const requestTable = 'payment_reversal_requests', effectTable = 'payment_reversals';
    guard('payment_reversal_request_insert', requestTable, 'INSERT', `${invalidKey('NEW.request_key')} OR ${invalidHash('NEW.fingerprint')}
      OR ${invalidObject('NEW.original_payment_json')} OR ${invalidObject('NEW.request_receipt_json')}
      OR NEW.status <> 'pending' OR ${distinct('NEW.active_payment_id','NEW.payment_id')}
      OR NEW.review_key IS NOT NULL OR NEW.review_fingerprint IS NOT NULL OR NEW.reviewed_by IS NOT NULL OR NEW.review_note IS NOT NULL
      OR NEW.review_audit_id IS NOT NULL OR NEW.review_receipt_json IS NOT NULL OR NEW.reviewed_at IS NOT NULL
      OR NEW.reason_category NOT IN ('registration_error','bank_return') OR length(NEW.reason) < 5 OR length(NEW.reason) > 2000
      OR NOT EXISTS (SELECT 1 FROM payment_records p WHERE p.id=NEW.payment_id AND p.status='verified' AND p.currency='CNY' AND p.amount>0
        AND p.method IN ('bank_transfer','cash','alipay','wechat','check','wire_transfer') AND p.barter_metadata IS NULL)
      OR NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.id=NEW.request_audit_id AND a.user_id=NEW.requested_by AND a.action='PAYMENT_REVERSAL_REQUESTED' AND a.resource='payment' AND a.resource_id=NEW.payment_id)`, 'PAYMENT_REVERSAL_REQUEST_INVALID');
    guard('payment_reversal_request_delete', requestTable, 'DELETE', '1=1', 'PAYMENT_REVERSAL_REQUEST_IMMUTABLE');
    guard('payment_reversal_request_review', requestTable, 'UPDATE', `OLD.status <> 'pending' OR NEW.status NOT IN ('posted','rejected')
      OR ${changed(['id','request_key','payment_id','requested_by','reason_category','reason','fingerprint','original_payment_json','request_receipt_json','request_audit_id','original_audit_id','created_at'])}
      OR NEW.active_payment_id IS NOT NULL OR NEW.reviewed_by IS NULL OR NEW.reviewed_by=NEW.requested_by
      OR NEW.review_key IS NULL OR ${invalidKey('NEW.review_key')} OR NEW.review_fingerprint IS NULL OR ${invalidHash('NEW.review_fingerprint')}
      OR NEW.review_note IS NULL OR length(NEW.review_note)<5 OR length(NEW.review_note)>2000 OR NEW.reviewed_at IS NULL OR NEW.review_audit_id IS NULL
      OR NEW.review_receipt_json IS NULL OR ${invalidObject('NEW.review_receipt_json')}
      OR NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.id=NEW.review_audit_id AND a.user_id=NEW.reviewed_by AND a.resource='payment' AND a.resource_id=NEW.payment_id
        AND a.action=CASE WHEN NEW.status='posted' THEN 'PAYMENT_REVERSED' ELSE 'PAYMENT_REVERSAL_REJECTED' END)
      OR (NEW.status='posted' AND NOT EXISTS (SELECT 1 FROM payment_reversals e WHERE e.request_id=NEW.id AND e.payment_id=NEW.payment_id AND e.posted_by=NEW.reviewed_by AND e.audit_id=NEW.review_audit_id AND e.receipt_json=NEW.review_receipt_json))
      OR (NEW.status='rejected' AND EXISTS (SELECT 1 FROM payment_reversals e WHERE e.request_id=NEW.id))`, 'PAYMENT_REVERSAL_REQUEST_IMMUTABLE');
    guard('payment_reversal_effect_insert', effectTable, 'INSERT', `NEW.currency <> 'CNY' OR NEW.amount >= 0
      OR ${invalidObject('NEW.before_state_json')} OR ${invalidObject('NEW.after_state_json')} OR ${invalidObject('NEW.receipt_json')}
      OR NOT EXISTS (SELECT 1 FROM payment_records p JOIN payment_reversal_requests r ON r.payment_id=p.id
        WHERE p.id=NEW.payment_id AND r.id=NEW.request_id AND r.status='pending' AND p.status='verified'
        AND p.currency=NEW.currency AND NEW.amount=-p.amount AND NEW.posted_by<>r.requested_by)
      OR NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.id=NEW.audit_id AND a.user_id=NEW.posted_by AND a.action='PAYMENT_REVERSED' AND a.resource='payment' AND a.resource_id=NEW.payment_id)`, 'PAYMENT_REVERSAL_EFFECT_INVALID');
    for (const operation of ['UPDATE','DELETE']) guard(`payment_reversal_effect_${operation.toLowerCase()}`, effectTable, operation, '1=1', 'PAYMENT_REVERSAL_IMMUTABLE');
    const linked = 'EXISTS (SELECT 1 FROM payment_reversal_requests r WHERE r.payment_id=OLD.id)';
    guard('payment_reversal_original_update', 'payment_records', 'UPDATE', `${linked} AND (
      ${changed(['id','order_id','amount','currency','exchange_rate','base_amount','method','date','payer_name','is_proxy','note','verified_by','milestone_id','barter_metadata','created_at'])}
      OR (${distinct('NEW.status','OLD.status')} AND NOT (OLD.status='verified' AND NEW.status='reversed' AND EXISTS
        (SELECT 1 FROM payment_reversals e JOIN payment_reversal_requests r ON r.id=e.request_id WHERE e.payment_id=OLD.id AND r.status='posted')))
    )`, 'PAYMENT_REVERSAL_ORIGINAL_IMMUTABLE');
    for (const operation of ['UPDATE','DELETE']) guard(`payment_reversal_audit_${operation.toLowerCase()}`, 'audit_logs', operation,
        'EXISTS (SELECT 1 FROM payment_reversal_requests r WHERE r.request_audit_id=OLD.id OR r.original_audit_id=OLD.id OR r.review_audit_id=OLD.id) OR EXISTS (SELECT 1 FROM payment_reversals e WHERE e.audit_id=OLD.id)', 'PAYMENT_REVERSAL_AUDIT_IMMUTABLE');
    const triggers = guards.map(g => [g.name, provider === 'sqlite'
        ? `CREATE TRIGGER "${g.name}" BEFORE ${g.operation} ON "${g.table}" WHEN ${g.condition} BEGIN SELECT RAISE(ABORT,'${g.code}'); END`
        : `CREATE OR REPLACE FUNCTION ${g.name}_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${g.condition} THEN RAISE EXCEPTION '${g.code}' USING ERRCODE='23514'; END IF; RETURN ${g.operation === 'DELETE' ? 'OLD' : 'NEW'}; END $$;\nDROP TRIGGER IF EXISTS "${g.name}" ON "${g.table}";\nCREATE TRIGGER "${g.name}" BEFORE ${g.operation} ON "${g.table}" FOR EACH ROW EXECUTE FUNCTION ${g.name}_guard();`
    ] as const);
    return { tables, indexes, triggers };
}
