import prisma from '../config/database';
import {
  addColumnIfMissing,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';
import { repairAuthSchema } from './runtime-schema-auth-repair';
import { repairBarterSchema } from './runtime-schema-barter-repair';
import { repairProductionSchema } from './runtime-schema-production-repair';
import { repairReceiptSchema } from './runtime-schema-receipt-repair';
import { repairStockSchema } from './runtime-schema-stock-repair';

export const repairRuntimeSchema = async (): Promise<SchemaRepairReport> => {
  const report: SchemaRepairReport = { entries: [] };

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

  await addColumnIfMissing(report, 'orders', 'locked_exchange_rate', 'REAL');
  await addColumnIfMissing(report, 'orders', 'base_amount', 'REAL');

  await addColumnIfMissing(report, 'customers', 'contacts_json', 'TEXT');
  await addColumnIfMissing(report, 'customers', 'addresses_json', 'TEXT');

  await addColumnIfMissing(report, 'payment_records', 'currency', `TEXT NOT NULL DEFAULT 'CNY'`);
  await addColumnIfMissing(report, 'payment_records', 'exchange_rate', 'REAL NOT NULL DEFAULT 1.0');
  await addColumnIfMissing(report, 'payment_records', 'base_amount', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'payment_records', 'barter_metadata', 'TEXT');

  await addColumnIfMissing(report, 'suppliers', 'name_aliases', 'TEXT');
  await addColumnIfMissing(report, 'suppliers', 'contacts_json', 'TEXT');
  await addColumnIfMissing(report, 'suppliers', 'addresses_json', 'TEXT');
  await addColumnIfMissing(report, 'shipments', 'signed_receipt_url', 'TEXT');

  await addColumnIfMissing(report, 'purchase_orders', 'currency', `TEXT NOT NULL DEFAULT 'CNY'`);
  await addColumnIfMissing(report, 'purchase_orders', 'exchange_rate', 'REAL NOT NULL DEFAULT 1.0');
  await addColumnIfMissing(report, 'purchase_orders', 'tax_rate', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'tax_amount', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'freight_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'duty_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'insurance_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'other_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'landed_cost_amount', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'landed_unit_cost', 'REAL NOT NULL DEFAULT 0');

  await repairReceiptSchema(report);

  await repairProductionSchema(report);

  await repairStockSchema(report);

  await repairAuthSchema(report);

  await repairBarterSchema(report);

  return report;
};
