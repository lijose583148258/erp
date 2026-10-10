import { createIndexIfMissing, createTableIfMissing, ensureTriggerDefinition, type SchemaRepairReport } from './runtime-schema-repair-utils';
import { paymentReversalSchema } from './payment-reversal-schema';
export async function repairPaymentReversalSchema(report: SchemaRepairReport) {
    const schema = paymentReversalSchema('sqlite');
    for (const [name, sql] of schema.tables) await createTableIfMissing(report, name, sql);
    for (const [name, sql] of schema.indexes) await createIndexIfMissing(report, name, sql);
    for (const [name, sql] of schema.triggers) await ensureTriggerDefinition(report, name, sql);
}
