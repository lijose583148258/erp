import type { Prisma } from '@prisma/client';
import { StockMovementService, type TransactionClient } from './stock-movement.service';

export type ShippingIssueShipment = {
  shipmentNo: string;
  productName: string;
  quantity: number;
  unit: string;
  batchNo?: string | null;
  materialId?: number | null;
};

async function hasShippingIssuePosted(tx: TransactionClient, shipmentNo: string) {
  const entry = await tx.stockEntry.findFirst({
    where: { sourceType: 'shipping_issue', sourceRef: shipmentNo },
    select: { id: true },
  });
  return Boolean(entry);
}

async function resolveShippingIssueStock(tx: TransactionClient, shipment: ShippingIssueShipment) {
  const quantity = Number(shipment.quantity || 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Shipment quantity must be greater than 0 before dispatch');
  }

  const finishedGoodsLocation = await tx.location.findFirst({
    where: { code: 'LOC-FG', status: 'active' },
    select: { id: true },
  });
  if (!finishedGoodsLocation) {
    throw new Error('Finished goods location LOC-FG is not configured');
  }

  const where: Prisma.StockBalanceWhereInput = {
    locationId: finishedGoodsLocation.id,
    quantity: { gte: quantity },
  };
  if (shipment.materialId) where.materialId = shipment.materialId;
  else where.productName = shipment.productName;
  if (shipment.batchNo) where.batchNo = shipment.batchNo;

  const stock = await tx.stockBalance.findFirst({
    where,
    orderBy: { createdAt: 'asc' },
    include: { location: true },
  });
  if (!stock) {
    throw new Error(`No available stock for shipment ${shipment.shipmentNo}: ${shipment.productName}${shipment.batchNo ? ` / ${shipment.batchNo}` : ''}`);
  }

  return stock;
}

export async function postShippingIssueIfMissing(
  tx: TransactionClient,
  shipment: ShippingIssueShipment,
  createdBy?: number | null,
) {
  if (await hasShippingIssuePosted(tx, shipment.shipmentNo)) {
    return { posted: false, issueStock: null };
  }

  const issueStock = await resolveShippingIssueStock(tx, shipment);
  await StockMovementService.postStockEntry({
    sourceType: 'shipping_issue',
    sourceRef: shipment.shipmentNo,
    reason: 'shipment_dispatched',
    note: `Shipment dispatched: ${shipment.shipmentNo}`,
    createdBy: createdBy || null,
    lines: [{
      locationId: issueStock.locationId,
      materialId: issueStock.materialId,
      productName: issueStock.productName,
      batchNo: issueStock.batchNo,
      quantityDelta: -Number(shipment.quantity || 0),
      unit: shipment.unit || issueStock.unit || 'kg',
    }],
  }, tx);

  return { posted: true, issueStock };
}
