import { addColumnIfMissing, createIndexIfMissing, type SchemaRepairReport } from './runtime-schema-repair-utils';
// Adds nullable columns only. Legacy BOMs and work orders are never reinterpreted as density conversions.
export async function repairDensityConversionSchema(report: SchemaRepairReport) {
  await addColumnIfMissing(report, 'production_bom_items', 'density_revision_id', 'INTEGER REFERENCES "material_density_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
  await addColumnIfMissing(report, 'production_bom_items', 'density_snapshot_json', 'TEXT');
  await addColumnIfMissing(report, 'production_work_orders', 'density_snapshot_json', 'TEXT');
  await createIndexIfMissing(report, 'production_bom_items_density_revision_id_idx', 'CREATE INDEX "production_bom_items_density_revision_id_idx" ON "production_bom_items"("density_revision_id")');
}
