import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import {
  addImportLimitError,
  BATCH_IMPORT_LIMIT,
  createImportResult,
  type ImportResult,
} from '../types/api.types';
import { buildBusinessNo } from '../utils/businessNo';
import { CreditEngine } from '../utils/CreditEngine';
import { withDbRetry } from '../utils/dbRetry';
import { logger } from '../utils/logger';
import { canUseCustomerForBusinessWrite } from '../utils/recordAccess';
import {
  buildOrderImportFingerprint,
  orderImportIdempotencyService,
  type OrderImportIdempotencyService,
} from './order-import-idempotency.service';
import { SearchIndexService } from './search-index.service';

type ImportOrderRow = {
  customerId?: unknown;
  paymentTerms?: unknown;
  items: Record<string, unknown>[];
};

type ImportOrderItem = {
  productName: string;
  specification: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  itemType: string;
  notes: string | null;
};

export type OrderImportDependencies = {
  runTransaction: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  checkCredit: typeof CreditEngine.checkOrder;
  scheduleOrderSync: (orderId: number) => void;
  writeAuditLog: (data: Prisma.AuditLogUncheckedCreateInput) => Promise<void>;
  buildOrderNo: () => string;
  idempotency: Pick<OrderImportIdempotencyService, 'claim' | 'renewLease' | 'complete'>;
};

class OrderImportRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderImportRowError';
  }
}

class OrderImportLeaseLostError extends Error {
  constructor() {
    super('Order import lease was lost; retry with the same Idempotency-Key.');
    this.name = 'OrderImportLeaseLostError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const normalizeRows = (orders: unknown): ImportOrderRow[] =>
  Array.isArray(orders)
    ? orders.map((value) => {
      const row = asRecord(value);
      return {
        customerId: row.customerId,
        paymentTerms: row.paymentTerms,
        items: Array.isArray(row.items) ? row.items.map(asRecord) : [],
      };
    })
    : [];

function buildImportItems(items: Record<string, unknown>[]) {
  if (items.length === 0) throw new OrderImportRowError('Order items are required.');

  let totalAmount = 0;
  const orderItems: ImportOrderItem[] = items.map((item) => {
    const productName = String(item.productName || '').trim();
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const totalPrice = quantity * unitPrice;

    if (!productName) throw new OrderImportRowError('Product name is required.');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new OrderImportRowError('Item quantity must be a positive number.');
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new OrderImportRowError('Item unit price must be a non-negative number.');
    }
    if (!Number.isFinite(totalPrice)) throw new OrderImportRowError('Item total is outside the supported range.');

    totalAmount += totalPrice;
    return {
      productName,
      specification: item.specification ? String(item.specification) : null,
      quantity,
      unit: String(item.unit || 'unit'),
      unitPrice,
      totalPrice,
      itemType: String(item.itemType || 'normal'),
      notes: item.notes ? String(item.notes) : null,
    };
  });

  if (!Number.isFinite(totalAmount)) throw new OrderImportRowError('Order total is outside the supported range.');
  return { orderItems, totalAmount };
}

const defaultDependencies: OrderImportDependencies = {
  runTransaction: operation => withDbRetry(
    () => prisma.$transaction(operation),
    { label: 'importOrder' },
  ),
  checkCredit: (customerId, amount, tx) => CreditEngine.checkOrder(customerId, amount, tx),
  scheduleOrderSync: orderId => SearchIndexService.scheduleOrderSync(orderId),
  writeAuditLog: data => prisma.auditLog.create({ data }).then(() => undefined),
  buildOrderNo: () => buildBusinessNo('ORD-IMP'),
  idempotency: orderImportIdempotencyService,
};

export class OrderImportService {
  constructor(private readonly dependencies: OrderImportDependencies = defaultDependencies) {}

  private async createRow(
    row: ImportOrderRow,
    req: AuthRequest,
    batch: { id: number; leaseToken: string; rowNumber: number },
  ) {
    const actor = req.user;
    if (!actor) throw new OrderImportRowError('Authenticated user is required.');

    const customerId = Number(row.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      throw new OrderImportRowError('A valid customerId is required.');
    }

    const paymentTerms = row.paymentTerms === undefined ? 30 : Number(row.paymentTerms);
    if (!Number.isInteger(paymentTerms) || paymentTerms < 1 || paymentTerms > 365) {
      throw new OrderImportRowError('Payment terms must be an integer between 1 and 365.');
    }

    const { orderItems, totalAmount } = buildImportItems(row.items);
    if (!(await this.dependencies.idempotency.renewLease(batch.id, batch.leaseToken))) {
      throw new OrderImportLeaseLostError();
    }

    return this.dependencies.runTransaction(async (tx) => {
      const existingOrder = await tx.order.findFirst({
        where: { importBatchId: batch.id, importRowNumber: batch.rowNumber },
        select: { id: true, orderNo: true },
      });
      if (existingOrder) return existingOrder;

      const customer = await tx.customer.update({
        where: { id: customerId },
        data: { updatedAt: new Date() },
        select: {
          id: true,
          status: true,
          salespersonId: true,
          poolState: true,
          segment: true,
        },
      }).catch((error) => {
        if ((error as { code?: string }).code === 'P2025') {
          throw new OrderImportRowError('Customer is unavailable or outside your data scope.');
        }
        throw error;
      });

      if (!canUseCustomerForBusinessWrite(req, customer)) {
        throw new OrderImportRowError('Customer is unavailable or outside your data scope.');
      }
      if (customer.status !== 'active') {
        throw new OrderImportRowError('Only active customers can receive imported orders.');
      }

      const creditCheck = await this.dependencies.checkCredit(customerId, totalAmount, tx);
      if (!creditCheck.allow) {
        throw new OrderImportRowError(creditCheck.reason || 'Customer credit validation failed.');
      }

      return tx.order.create({
        data: {
          orderNo: this.dependencies.buildOrderNo(),
          customerId,
          totalAmount,
          discountAmount: 0,
          finalAmount: totalAmount,
          paymentTerms,
          status: 'pending',
          createdBy: actor.userId,
          importBatchId: batch.id,
          importRowNumber: batch.rowNumber,
          items: { create: orderItems },
        },
        select: { id: true, orderNo: true },
      });
    });
  }

  async importOrders(orders: unknown, req: AuthRequest, idempotencyKey: string) {
    const normalizedOrders = normalizeRows(orders);
    if (normalizedOrders.length === 0) return { error: 'Please provide order data.' } as const;
    if (!req.user) return { error: 'Authenticated user is required.' } as const;

    const fingerprint = buildOrderImportFingerprint(normalizedOrders);
    const claim = await this.dependencies.idempotency.claim(req.user.userId, idempotencyKey, fingerprint);
    if (claim.kind === 'conflict' || claim.kind === 'in_progress') {
      return { error: claim.message, statusCode: 409 } as const;
    }
    if (claim.kind === 'replay') {
      return { result: claim.result, replayed: true } as const;
    }

    const result: ImportResult = createImportResult();
    result.attempted = normalizedOrders.length;
    result.imported = 0;
    addImportLimitError(result, normalizedOrders.length, BATCH_IMPORT_LIMIT);

    const limitedOrders = normalizedOrders.slice(0, BATCH_IMPORT_LIMIT);
    for (let index = 0; index < limitedOrders.length; index += 1) {
      try {
        const created = await this.createRow(limitedOrders[index], req, {
          id: claim.batchId,
          leaseToken: claim.leaseToken,
          rowNumber: index + 1,
        });
        result.success += 1;
        result.imported = result.success;
        this.dependencies.scheduleOrderSync(created.id);
      } catch (error) {
        if (error instanceof OrderImportLeaseLostError) throw error;
        if (!(error instanceof OrderImportRowError)) throw error;
        result.failed += 1;
        result.errors.push({
          row: index + 1,
          message: error.message,
        });
      }
    }

    await this.dependencies.idempotency.complete(claim.batchId, claim.leaseToken, result);

    if (req.user) {
      try {
        await this.dependencies.writeAuditLog({
          userId: req.user.userId,
          action: 'IMPORT',
          resource: 'order',
          details: `Bulk import orders: success ${result.success}, failed ${result.failed}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
      } catch (error) {
        logger.warn('Order import audit log failed after business rows were preserved', error);
      }
    }

    return { result } as const;
  }
}

export const orderImportService = new OrderImportService();
