import prisma from '../config/database';

const DAY_MS = 24 * 60 * 60 * 1000;

export type OrderImportRetentionMode = 'report-only' | 'enforce';

export interface OrderImportRetentionPolicy {
  mode: OrderImportRetentionMode;
  replayDays: number;
  staleProcessingDays: number;
  purgeDays: number;
  batchSize: number;
}

export interface OrderImportRetentionReport {
  mode: OrderImportRetentionMode;
  startedAt: string;
  finishedAt: string;
  cutoffs: { replay: string; staleProcessing: string; purge: string };
  candidates: { completed: number; staleProcessing: number; purgeable: number; linkedExpired: number };
  selected: { completed: number; staleProcessing: number; purgeable: number };
  mutations: { compacted: number; staleExpired: number; purged: number };
}

type RetentionClient = Pick<typeof prisma, 'orderImportBatch'>;

const positiveInteger = (name: string, value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
};

export const resolveOrderImportRetentionPolicy = (
  env: NodeJS.ProcessEnv = process.env,
): OrderImportRetentionPolicy => {
  const mode = String(env.ORDER_IMPORT_RETENTION_MODE || 'report-only').trim().toLowerCase();
  if (mode !== 'report-only' && mode !== 'enforce') {
    throw new Error('ORDER_IMPORT_RETENTION_MODE must be report-only or enforce.');
  }
  const replayDays = positiveInteger('ORDER_IMPORT_REPLAY_DAYS', env.ORDER_IMPORT_REPLAY_DAYS, 30);
  const staleProcessingDays = positiveInteger(
    'ORDER_IMPORT_STALE_PROCESSING_DAYS',
    env.ORDER_IMPORT_STALE_PROCESSING_DAYS,
    7,
  );
  const purgeDays = positiveInteger('ORDER_IMPORT_PURGE_DAYS', env.ORDER_IMPORT_PURGE_DAYS, 365);
  const batchSize = positiveInteger('ORDER_IMPORT_RETENTION_BATCH_SIZE', env.ORDER_IMPORT_RETENTION_BATCH_SIZE, 500);
  if (purgeDays <= replayDays) throw new Error('ORDER_IMPORT_PURGE_DAYS must be greater than ORDER_IMPORT_REPLAY_DAYS.');
  if (batchSize > 5000) throw new Error('ORDER_IMPORT_RETENTION_BATCH_SIZE must not exceed 5000.');
  return { mode, replayDays, staleProcessingDays, purgeDays, batchSize };
};

export class OrderImportRetentionService {
  constructor(private readonly client: RetentionClient = prisma) {}

  async run(
    policy: OrderImportRetentionPolicy = resolveOrderImportRetentionPolicy(),
    now = new Date(),
  ): Promise<OrderImportRetentionReport> {
    const replayCutoff = new Date(now.getTime() - policy.replayDays * DAY_MS);
    const staleProcessingCutoff = new Date(now.getTime() - policy.staleProcessingDays * DAY_MS);
    const purgeCutoff = new Date(now.getTime() - policy.purgeDays * DAY_MS);
    const completedWhere = { status: 'completed', completedAt: { lt: replayCutoff } } as const;
    const staleWhere = {
      status: 'processing',
      createdAt: { lt: staleProcessingCutoff },
      leaseExpiresAt: { lt: now },
    } as const;
    const purgeWhere = {
      status: 'expired',
      createdAt: { lt: purgeCutoff },
      orders: { none: {} },
    } as const;
    const linkedExpiredWhere = {
      status: 'expired',
      createdAt: { lt: purgeCutoff },
      orders: { some: {} },
    } as const;

    const [completed, staleProcessing, purgeable, linkedExpired] = await Promise.all([
      this.client.orderImportBatch.count({ where: completedWhere }),
      this.client.orderImportBatch.count({ where: staleWhere }),
      this.client.orderImportBatch.count({ where: purgeWhere }),
      this.client.orderImportBatch.count({ where: linkedExpiredWhere }),
    ]);
    const selectIds = async (where: object) => this.client.orderImportBatch.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: policy.batchSize,
    });
    const [completedRows, staleRows, purgeRows] = await Promise.all([
      selectIds(completedWhere),
      selectIds(staleWhere),
      selectIds(purgeWhere),
    ]);
    const ids = (rows: Array<{ id: number }>) => rows.map(row => row.id);
    let compacted = 0;
    let staleExpired = 0;
    let purged = 0;
    if (policy.mode === 'enforce') {
      const completedIds = ids(completedRows);
      const staleIds = ids(staleRows);
      const purgeIds = ids(purgeRows);
      if (completedIds.length) {
        compacted = (await this.client.orderImportBatch.updateMany({
          where: { id: { in: completedIds }, ...completedWhere },
          data: { status: 'expired', resultJson: null, leaseToken: '' },
        })).count;
      }
      if (staleIds.length) {
        staleExpired = (await this.client.orderImportBatch.updateMany({
          where: { id: { in: staleIds }, ...staleWhere },
          data: { status: 'expired', resultJson: null, leaseToken: '' },
        })).count;
      }
      if (purgeIds.length) {
        purged = (await this.client.orderImportBatch.deleteMany({
          where: { id: { in: purgeIds }, ...purgeWhere },
        })).count;
      }
    }

    return {
      mode: policy.mode,
      startedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      cutoffs: {
        replay: replayCutoff.toISOString(),
        staleProcessing: staleProcessingCutoff.toISOString(),
        purge: purgeCutoff.toISOString(),
      },
      candidates: { completed, staleProcessing, purgeable, linkedExpired },
      selected: {
        completed: completedRows.length,
        staleProcessing: staleRows.length,
        purgeable: purgeRows.length,
      },
      mutations: { compacted, staleExpired, purged },
    };
  }
}

export const orderImportRetentionService = new OrderImportRetentionService();
