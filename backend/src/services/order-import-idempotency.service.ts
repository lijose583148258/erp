import { createHash, randomUUID } from 'crypto';
import prisma from '../config/database';
import type { ImportResult } from '../types/api.types';

const LEASE_MS = 5 * 60 * 1000;

export type OrderImportBatchClaim =
  | { kind: 'owner'; batchId: number; leaseToken: string }
  | { kind: 'replay'; batchId: number; result: ImportResult }
  | { kind: 'conflict'; message: string }
  | { kind: 'in_progress'; message: string };

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

export const buildOrderImportFingerprint = (orders: unknown) => createHash('sha256')
  .update(JSON.stringify(canonicalize(orders)))
  .digest('hex');

export const normalizeOrderImportIdempotencyKey = (value: unknown) => {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/.test(key) ? key : null;
};

const parseStoredResult = (value: string | null): ImportResult | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ImportResult;
    if (
      Number.isInteger(parsed.success)
      && Number.isInteger(parsed.failed)
      && Array.isArray(parsed.errors)
    ) return parsed;
  } catch {
    // Corrupt replay state must fail closed rather than execute the batch again.
  }
  return null;
};

export class OrderImportIdempotencyService {
  constructor(private readonly client: Pick<typeof prisma, 'orderImportBatch'> = prisma) {}

  async claim(userId: number, idempotencyKey: string, fingerprint: string): Promise<OrderImportBatchClaim> {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    try {
      const created = await this.client.orderImportBatch.create({
        data: { userId, idempotencyKey, fingerprint, leaseToken, leaseExpiresAt },
        select: { id: true },
      });
      return { kind: 'owner', batchId: created.id, leaseToken };
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }

    const existing = await this.client.orderImportBatch.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (!existing) throw new Error('Idempotency batch disappeared after unique-key conflict.');
    if (existing.fingerprint !== fingerprint) {
      return { kind: 'conflict', message: 'Idempotency-Key was already used with a different order import payload.' };
    }
    if (existing.status === 'completed') {
      const result = parseStoredResult(existing.resultJson);
      if (!result) return { kind: 'conflict', message: 'Stored import replay state is invalid; manual review is required.' };
      return { kind: 'replay', batchId: existing.id, result };
    }
    if (existing.status === 'expired') {
      return { kind: 'conflict', message: 'The replay window for this Idempotency-Key has expired; use a new key.' };
    }
    if (existing.leaseExpiresAt.getTime() > Date.now()) {
      return { kind: 'in_progress', message: 'An import with this Idempotency-Key is still processing.' };
    }

    const takeover = await this.client.orderImportBatch.updateMany({
      where: {
        id: existing.id,
        fingerprint,
        status: 'processing',
        leaseExpiresAt: { lte: new Date() },
      },
      data: { leaseToken, leaseExpiresAt },
    });
    return takeover.count === 1
      ? { kind: 'owner', batchId: existing.id, leaseToken }
      : { kind: 'in_progress', message: 'An import with this Idempotency-Key is still processing.' };
  }

  async renewLease(
    batchId: number,
    leaseToken: string,
  ) {
    const renewed = await this.client.orderImportBatch.updateMany({
      where: { id: batchId, leaseToken, status: 'processing' },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    return renewed.count === 1;
  }

  async complete(batchId: number, leaseToken: string, result: ImportResult) {
    const completed = await this.client.orderImportBatch.updateMany({
      where: { id: batchId, leaseToken, status: 'processing' },
      data: {
        status: 'completed',
        resultJson: JSON.stringify(result),
        completedAt: new Date(),
        leaseExpiresAt: new Date(),
      },
    });
    if (completed.count !== 1) throw new Error('Order import lease was lost before completion.');
  }
}

export const orderImportIdempotencyService = new OrderImportIdempotencyService();
