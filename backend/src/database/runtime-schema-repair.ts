import prisma from '../config/database';
import { SchemaRepairReport } from './runtime-schema-repair-utils';
import { repairAuthSchema } from './runtime-schema-auth-repair';
import { repairBarterSchema } from './runtime-schema-barter-repair';
import { repairCoreSchema } from './runtime-schema-core-repair';
import { repairProductionSchema } from './runtime-schema-production-repair';
import { repairReceiptSchema } from './runtime-schema-receipt-repair';
import { repairReceivableSchema } from './runtime-schema-receivable-repair';
import { repairStockSchema } from './runtime-schema-stock-repair';

export const repairRuntimeSchema = async (): Promise<SchemaRepairReport> => {
  const report: SchemaRepairReport = { entries: [] };

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

  await repairCoreSchema(report);

  await repairReceiptSchema(report);

  await repairProductionSchema(report);

  await repairStockSchema(report);

  await repairAuthSchema(report);

  await repairBarterSchema(report);

  await repairReceivableSchema(report);

  return report;
};
