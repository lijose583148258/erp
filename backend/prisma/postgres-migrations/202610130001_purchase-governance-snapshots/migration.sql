-- Unknown historical payable and quality provenance stays NULL; never infer it from current PO values.
ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "supplier_payable_basis_json" TEXT,
  ADD COLUMN IF NOT EXISTS "incoming_quality_plan_json" TEXT;
