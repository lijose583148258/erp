ALTER TABLE "production_boms"
  ADD COLUMN IF NOT EXISTS "shelf_life_days" INTEGER;

ALTER TABLE "production_boms"
  ADD CONSTRAINT "production_boms_shelf_life_days_check"
  CHECK ("shelf_life_days" IS NULL OR ("shelf_life_days" BETWEEN 1 AND 3650));
