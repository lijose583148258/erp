import prisma from '../config/database';
import {
  SchemaRepairReport,
  createIndexIfMissing,
  createTableIfMissing,
} from './runtime-schema-repair-utils';

export const repairCommercialPlatformSchema = async (report: SchemaRepairReport) => {
  await createTableIfMissing(report, 'workflow_definitions', `
    CREATE TABLE "workflow_definitions" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "document_type" TEXT NOT NULL,
      "config_json" TEXT NOT NULL,
      "is_active" BOOLEAN NOT NULL DEFAULT 1,
      "created_by" INTEGER,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createTableIfMissing(report, 'workflow_instances', `
    CREATE TABLE "workflow_instances" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "definition_id" INTEGER NOT NULL,
      "document_type" TEXT NOT NULL,
      "document_id" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "current_step" INTEGER NOT NULL DEFAULT 0,
      "requester_id" INTEGER,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createTableIfMissing(report, 'workflow_tasks', `
    CREATE TABLE "workflow_tasks" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "instance_id" INTEGER NOT NULL,
      "node_code" TEXT NOT NULL,
      "assignee_role" TEXT,
      "assignee_user_id" INTEGER,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completed_at" DATETIME
    )
  `);

  await createTableIfMissing(report, 'workflow_actions', `
    CREATE TABLE "workflow_actions" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "instance_id" INTEGER NOT NULL,
      "task_id" INTEGER,
      "action" TEXT NOT NULL,
      "actor_id" INTEGER,
      "comment" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createTableIfMissing(report, 'notifications', `
    CREATE TABLE "notifications" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "user_id" INTEGER,
      "role" TEXT,
      "type" TEXT NOT NULL DEFAULT 'info',
      "severity" TEXT NOT NULL DEFAULT 'info',
      "title" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "resource_type" TEXT,
      "resource_id" TEXT,
      "is_read" BOOLEAN NOT NULL DEFAULT 0,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "read_at" DATETIME
    )
  `);

  await createTableIfMissing(report, 'business_events', `
    CREATE TABLE "business_events" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "event_type" TEXT NOT NULL,
      "aggregate_type" TEXT NOT NULL,
      "aggregate_id" TEXT NOT NULL,
      "payload_json" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createTableIfMissing(report, 'alert_rules', `
    CREATE TABLE "alert_rules" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "rule_type" TEXT NOT NULL,
      "threshold_value" REAL,
      "is_active" BOOLEAN NOT NULL DEFAULT 1,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createTableIfMissing(report, 'bi_sales_daily', `
    CREATE TABLE "bi_sales_daily" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "metric_date" TEXT NOT NULL UNIQUE,
      "order_count" INTEGER NOT NULL DEFAULT 0,
      "revenue_amount" REAL NOT NULL DEFAULT 0,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createIndexIfMissing(report, 'idx_workflow_instances_document', 'CREATE INDEX "idx_workflow_instances_document" ON "workflow_instances" ("document_type", "document_id")');
  await createIndexIfMissing(report, 'idx_workflow_tasks_pending_role', 'CREATE INDEX "idx_workflow_tasks_pending_role" ON "workflow_tasks" ("status", "assignee_role")');
  await createIndexIfMissing(report, 'idx_notifications_user_read', 'CREATE INDEX "idx_notifications_user_read" ON "notifications" ("user_id", "is_read", "created_at")');
  await createIndexIfMissing(report, 'idx_notifications_role_read', 'CREATE INDEX "idx_notifications_role_read" ON "notifications" ("role", "is_read", "created_at")');
  await createIndexIfMissing(report, 'idx_business_events_type_time', 'CREATE INDEX "idx_business_events_type_time" ON "business_events" ("event_type", "created_at")');

  await prisma.$executeRawUnsafe(`
    INSERT OR IGNORE INTO "alert_rules" ("code", "name", "rule_type", "threshold_value")
    VALUES
      ('stock_low_default', '库存不足默认预警', 'stock_low', 10),
      ('receivable_overdue_default', '应收超期默认预警', 'receivable_overdue', 0)
  `);
  report.entries.push({ kind: 'seed', target: 'alert_rules.default', action: 'updated' });
};
