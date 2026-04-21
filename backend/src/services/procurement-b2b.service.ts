import type { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { normalizePurchaseStatus } from './procurement-domain.service';
import { changePurchaseOrderStatus } from './procurement-status.service';
import type { TransactionClient } from './stock-movement.service';

type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: { supplier: true; salesOrder: true };
}>;

type SalesOrderRef = { id: number; orderNo: string };

const SALES_TO_PURCHASE_STATUS: Record<string, string> = {
  pending: 'pending',
  confirmed: 'approved',
  shipped: 'in_transit',
  delivered: 'received',
  cancelled: 'cancelled',
};

function normalizeId(value: unknown, code: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(code, 404, ErrorCode.NOT_FOUND, { value });
  }
  return id;
}

export async function linkPurchaseOrderToSalesOrder(tx: TransactionClient, input: {
  purchaseOrderId: unknown;
  salesOrderId: unknown;
}): Promise<{ purchaseOrder: PurchaseOrderWithRelations; salesOrder: SalesOrderRef }> {
  const purchaseOrderId = normalizeId(input.purchaseOrderId, 'PURCHASE_ORDER_NOT_FOUND');
  const salesOrderId = normalizeId(input.salesOrderId, 'SALES_ORDER_NOT_FOUND');

  const order = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  if (!order) {
    throw new AppError('PURCHASE_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { purchaseOrderId });
  }

  const salesOrder = await tx.order.findUnique({
    where: { id: salesOrderId },
    select: { id: true, orderNo: true },
  });
  if (!salesOrder) {
    throw new AppError('SALES_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { salesOrderId });
  }

  const purchaseOrder = await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      salesOrderId: salesOrder.id,
      salesOrderRef: salesOrder.orderNo,
      isB2B: true,
    },
    include: { supplier: true, salesOrder: true },
  });

  return { purchaseOrder, salesOrder };
}

export async function getB2BStatusForSalesOrder(tx: TransactionClient, input: {
  salesOrderId: unknown;
  salesUserId?: number | null;
}): Promise<{ linked: false } | { linked: true; purchaseOrder: PurchaseOrderWithRelations }> {
  const salesOrderId = normalizeId(input.salesOrderId, 'SALES_ORDER_NOT_FOUND');
  if (input.salesUserId) {
    const salesOrder = await tx.order.findFirst({
      where: {
        id: salesOrderId,
        createdBy: input.salesUserId,
      },
      select: { id: true },
    });
    if (!salesOrder) {
      throw new AppError('SALES_ORDER_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { salesOrderId });
    }
  }

  const purchaseOrder = await tx.purchaseOrder.findFirst({
    where: { salesOrderId },
    include: { supplier: true, salesOrder: true },
  });

  if (!purchaseOrder) {
    return { linked: false };
  }
  return { linked: true, purchaseOrder };
}

export async function syncB2BSalesStatusToPurchase(tx: TransactionClient, input: {
  salesOrderId: unknown;
  salesStatus: unknown;
  createdBy?: number | null;
}): Promise<{ linked: false } | { linked: true; purchaseOrder: PurchaseOrderWithRelations; salesOrder: PurchaseOrderWithRelations['salesOrder'] }> {
  const salesOrderId = normalizeId(input.salesOrderId, 'SALES_ORDER_NOT_FOUND');
  const purchaseOrder = await tx.purchaseOrder.findFirst({
    where: { salesOrderId },
    include: { supplier: true, salesOrder: true },
  });

  if (!purchaseOrder) {
    return { linked: false };
  }

  const mappedStatus = SALES_TO_PURCHASE_STATUS[String(input.salesStatus)] || purchaseOrder.status;
  const updated = await changePurchaseOrderStatus(tx, {
    purchaseOrderId: purchaseOrder.id,
    nextStatus: normalizePurchaseStatus(mappedStatus),
    createdBy: input.createdBy || null,
    enforceTransition: false,
  });

  return {
    linked: true,
    purchaseOrder: updated,
    salesOrder: updated.salesOrder,
  };
}
