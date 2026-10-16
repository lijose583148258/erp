jest.mock('../config/database', () => ({ __esModule: true, default: { order: { findMany: jest.fn() }, auditLog: { findMany: jest.fn() } } }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../utils/CreditEngine', () => ({ CreditEngine: {} }));
jest.mock('../services/order-workspace.service', () => ({ OrderWorkspaceService: {} }));
jest.mock('../services/search-index.service', () => ({ SearchIndexService: {} }));
jest.mock('../permissions/casbinAuthorization', () => ({ casbinAllowsAllPermissions: jest.fn() }));
jest.mock('./order-io.controller', () => ({ exportOrders: jest.fn(), importOrders: jest.fn() }));
jest.mock('./order-payment.controller', () => ({ recordOrderPayment: jest.fn(), verifyOrderPayment: jest.fn() }));
import prisma from '../config/database';
import { casbinAllowsAllPermissions } from '../permissions/casbinAuthorization';
import { OrderController } from './order.controller';

function sourceRow(id = 9): any {
  return { id, orderNo: `ORD-${id}`, status: 'shipped', customerId: 2, totalAmount: 9999, paidAmount: 8888, privateNote: 'Not for dispatch',
    customer: { id: 2, name: 'Customer fallback', nameZh: '客户', nameEn: 'Customer', nameVi: 'Khách', creditLimit: 1234, contactPhone: 'private' },
    items: [{ id: id * 10, orderId: id, materialId: 7, productName: 'Resin', quantity: 100, unit: 'kg', unitPrice: 55, totalPrice: 5500, createdAt: new Date() },
      { id: id * 10 + 1, orderId: id, materialId: 8, productName: 'Catalyst', quantity: 2, unit: 'drum', unitPrice: 30, totalPrice: 60 }],
    shipments: [{ id: id * 100, shipmentNo: `SHP-${id}`, orderId: id, orderItemId: id * 10, materialId: 7, productName: 'Resin', batchNo: 'LOT',
      quantity: 30, unit: 'kg', status: 'in_transit', shippedAt: new Date('2026-10-16T00:00:00.000Z'), deliveredAt: null,
      reservationState: 'consumed', reservationBalanceId: 4, reservationQuantity: 30, reservationAuditId: 101,
      receipts: [{ acceptedQuantity: 20, rejectedQuantity: 0, unit: 'kg' }] }],
    receivableAdjustments: [{ id: 5, adjustmentType: 'order_quantity_cancellation', status: 'posted', orderItemId: id * 10 + 1, cancelledQuantity: 1 }],
  };
}
// Mimic Prisma select rather than leaking unselected fixture values into assertions.
function project(row: any, select: any): any {
  return Object.fromEntries(Object.entries(select).filter(([, value]) => Boolean(value)).map(([name, value]: [string, any]) => [name,
    value === true ? row[name] : Array.isArray(row[name]) ? row[name].map((child: any) => project(child, value.select))
      : row[name] == null ? row[name] : project(row[name], value.select)]));
}
function fixture({ view, role = 'warehouse', scopes = ['warehouse_visible'], ordersRead = false, fullIds = [] as number[] }:
  { view?: unknown; role?: string; scopes?: string[]; ordersRead?: boolean; fullIds?: number[] } = {}) {
  jest.clearAllMocks(); const rows = [sourceRow()];
  const req: any = { query: view === undefined ? {} : { view }, user: { userId: 3, role, segment: 'mixed', dataScopes: scopes } };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  (casbinAllowsAllPermissions as jest.Mock).mockResolvedValue(ordersRead);
  (prisma.order.findMany as jest.Mock).mockImplementation(async ({ select }) => Object.keys(select).length === 1 && select.id
    ? fullIds.map(id => ({ id })) : rows.map(row => project(row, select)));
  const audits: any[] = [{ id: 101, userId: 3, action: 'CONSUME_RESERVATION',
    resource: 'shipment', resourceId: 900, details: JSON.stringify({ schema: 'shipment-reservation/v1', action: 'consume', shipmentId: 900,
      previousAuditId: 100, actorId: 3, stockBalanceId: 4, locationId: 6, materialId: 7, batchNo: 'LOT', quantity: 30, unit: 'kg', reason: 'Actual issue' }) }];
  (prisma.auditLog.findMany as jest.Mock).mockImplementation(async () => audits);
  const call = async () => { await new OrderController().getAvailableForShipping(req, res); return res.json.mock.calls[0]?.[0]; };
  return { req, res, rows, audits, call };
}
function assertNoCommercialFields(value: unknown) {
  if (Array.isArray(value)) { value.forEach(assertNoCommercialFields); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toMatch(/amount|price|payment|commission|discount|credit|privateNote|contactPhone/i);
    assertNoCommercialFields(child);
  }
}

test('warehouse-only dispatch requires no full-orders permission or extra visibility grant and returns a strict logistics DTO', async () => {
  const f = fixture({ view: 'dispatch' }), body = await f.call();
  expect(body.success).toBe(true); expect(body.data).toHaveLength(1); const row = body.data[0];
  expect(Object.keys(row).sort()).toEqual(['id', 'orderNo', 'status', 'customerId', 'customer', 'items', 'fulfillment'].sort());
  expect(row).toMatchObject({ id: 9, orderNo: 'ORD-9', status: 'shipped', customerId: 2,
    customer: { id: 2, name: 'Customer fallback', nameZh: '客户', nameEn: 'Customer', nameVi: 'Khách' } });
  expect(Object.keys(row.items[0]).sort()).toEqual(['id', 'materialId', 'productName', 'quantity', 'unit'].sort());
  assertNoCommercialFields(row); expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  expect(casbinAllowsAllPermissions).not.toHaveBeenCalled();
});

test.each(['warehouse', 'admin', 'custom-dispatch'])('dispatch is recursively quantity-only even for role %s with full order grants', async role => {
  const f = fixture({ view: 'dispatch', role, scopes: ['all'], ordersRead: true, fullIds: [9] }), body = await f.call();
  assertNoCommercialFields(body.data); expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
  expect(casbinAllowsAllPermissions).not.toHaveBeenCalled();
});

test('legacy warehouse-only response preserves its top-level shape but does not expose prices in scalar order items', async () => {
  const f = fixture(), body = await f.call(), row = body.data[0];
  expect(Object.keys(row).sort()).toEqual(['id', 'orderNo', 'customer', 'items', 'shipments', 'receivableAdjustments', 'fulfillment'].sort());
  expect(row.items[0]).toEqual({ id: 90, materialId: 7, productName: 'Resin', quantity: 100, unit: 'kg' });
  assertNoCommercialFields(row); expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
});

test('custom warehouse with orders.read but only warehouse_visible still cannot read financial item scalars', async () => {
  const f = fixture({ role: 'custom-warehouse', ordersRead: true }), body = await f.call();
  expect(body.data[0].items[0]).toEqual({ id: 90, materialId: 7, productName: 'Resin', quantity: 100, unit: 'kg' });
  assertNoCommercialFields(body.data); expect(casbinAllowsAllPermissions).toHaveBeenCalledWith('custom-warehouse', ['orders.read']);
  expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  const visibility = (prisma.order.findMany as jest.Mock).mock.calls[1][0];
  expect(visibility.select).toEqual({ id: true }); expect(visibility.where).toEqual({ AND: [{ id: { in: [9] } }, { id: -1 }] });
});

test('legacy authorized full-order records retain their original item scalars without broadening the endpoint shape', async () => {
  const f = fixture({ role: 'custom-sales', scopes: ['own_customers'], ordersRead: true, fullIds: [9] }), body = await f.call();
  expect(body.data[0].items).toEqual(f.rows[0].items); expect(body.data[0].items[0].unitPrice).toBe(55);
  expect(body.data[0]).not.toHaveProperty('totalAmount'); expect(body.data[0]).not.toHaveProperty('status');
  expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  expect((prisma.order.findMany as jest.Mock).mock.calls[1][0].where).toEqual({ AND: [{ id: { in: [9] } },
    { OR: [{ createdBy: 3 }, { customer: { poolState: 'private', salespersonId: 3 } }] }] });
});

test('full visibility alone never substitutes for orders.read permission', async () => {
  const f = fixture({ role: 'custom-dispatch', scopes: ['all'], ordersRead: false, fullIds: [9] }), body = await f.call();
  assertNoCommercialFields(body.data); expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
});

test('quantity, receipt, reservation and unlike-unit axes remain unchanged', async () => {
  const f = fixture({ view: 'dispatch' }), body = await f.call(), lines = body.data[0].fulfillment.lines;
  expect(lines[0]).toMatchObject({ orderItemId: 90, unit: 'kg', orderedQuantity: 100, allocatedQuantity: 30, dispatchedQuantity: 30,
    acceptedQuantity: 20, cancelledQuantity: 0, outstandingQuantity: 80, unallocatedQuantity: 70, reservedQuantity: 0, reservationEvidenceState: 'verified' });
  expect(lines[1]).toMatchObject({ orderItemId: 91, unit: 'drum', orderedQuantity: 2, cancelledQuantity: 1, outstandingQuantity: 1,
    unallocatedQuantity: 1, reservedQuantity: 0, reservationEvidenceState: 'verified' });
});

test('legacy authorization is checked once in a batch and applies per record, not to every warehouse-visible order', async () => {
  const f = fixture({ role: 'custom-warehouse-sales', ordersRead: true, scopes: ['warehouse_visible', 'own_customers'], fullIds: [9] });
  const unrelated = sourceRow(10); Object.assign(unrelated.shipments[0], { reservationState: 'unreserved', reservationBalanceId: null,
    reservationQuantity: null, reservationAuditId: null }); f.rows.push(unrelated);
  const body = await f.call(); expect(body.data).toHaveLength(2); expect(body.data[0].items[0].unitPrice).toBe(55);
  assertNoCommercialFields(body.data[1]); expect(prisma.order.findMany).toHaveBeenCalledTimes(2);
  expect(casbinAllowsAllPermissions).toHaveBeenCalledTimes(1);
  expect((prisma.order.findMany as jest.Mock).mock.calls[1][0].where).toEqual({ AND: [{ id: { in: [9, 10] } },
    { OR: [{ createdBy: 3 }, { customer: { poolState: 'private', salespersonId: 3 } }] }] });
});

test('active physical hold remains distinct from allocation, dispatched and accepted quantities', async () => {
  const f = fixture({ view: 'dispatch' }), shipment = f.rows[0].shipments[0];
  Object.assign(shipment, { status: 'pending', shippedAt: null, reservationState: 'reserved', receipts: [] });
  const event = JSON.parse(f.audits[0].details); Object.assign(event, { action: 'reserve', previousAuditId: null, reason: null });
  Object.assign(f.audits[0], { action: 'RESERVE_STOCK', details: JSON.stringify(event) });
  const body = await f.call(); expect(body.data[0].fulfillment.lines[0]).toMatchObject({ orderedQuantity: 100, allocatedQuantity: 30,
    dispatchedQuantity: 0, acceptedQuantity: 0, outstandingQuantity: 100, unallocatedQuantity: 70, reservedQuantity: 30, reservationEvidenceState: 'verified' });
});

test('missing legacy reservation history remains unknown instead of being reported as zero', async () => {
  const f = fixture({ view: 'dispatch' }); Object.assign(f.rows[0].shipments[0], { reservationState: null, reservationBalanceId: null,
    reservationQuantity: null, reservationAuditId: null });
  const body = await f.call(); expect(body.data[0].fulfillment.lines[0]).toMatchObject({ acceptedQuantity: 20, outstandingQuantity: 80,
    reservedQuantity: null, reservationEvidenceState: 'legacy_unknown' });
});

test('the old fully allocated and needs-review filters still exclude unsafe shipping candidates', async () => {
  const f = fixture({ view: 'dispatch' }), allocated = sourceRow(10), invalid = sourceRow(11);
  allocated.shipments[0].quantity = 100; allocated.receivableAdjustments[0].cancelledQuantity = 2;
  Object.assign(allocated.shipments[0], { reservationState: 'unreserved', reservationBalanceId: null, reservationQuantity: null, reservationAuditId: null });
  invalid.shipments[0].orderItemId = null;
  f.rows.push(allocated, invalid); const body = await f.call(); expect(body.data.map((row: any) => row.id)).toEqual([9]);
  const candidate = (prisma.order.findMany as jest.Mock).mock.calls[0][0];
  expect(candidate.where).toEqual({ status: { in: ['confirmed', 'shipped', 'delivered'] }, paymentStatus: { in: ['paid', 'partial'] } });
});

test('permission lookup failure fails closed instead of returning complete legacy items', async () => {
  const f = fixture(); (casbinAllowsAllPermissions as jest.Mock).mockRejectedValueOnce(new Error('policy store unavailable'));
  const body = await f.call(); expect(f.res.status).toHaveBeenCalledWith(500); expect(body.success).toBe(false); expect(body.data).toBeUndefined();
});

test('dispatch performs a minimal item and customer select, not just post-query monetary stripping', async () => {
  const f = fixture({ view: 'dispatch' }); await f.call(); const select = (prisma.order.findMany as jest.Mock).mock.calls[0][0].select;
  expect(select.items).toEqual({ select: { id: true, materialId: true, productName: true, quantity: true, unit: true } });
  expect(select.customer).toEqual({ select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } });
  expect(select).not.toHaveProperty('totalAmount'); expect(select).not.toHaveProperty('paymentRecords');
});

test.each(['', 'full', 'Dispatch', ['dispatch'], ['dispatch', 'full'], {}, null])('invalid view %p is rejected before querying orders or policies', async view => {
  const f = fixture({ view }); const body = await f.call(); expect(f.res.status).toHaveBeenCalledWith(400);
  expect(body.success).toBe(false); expect(prisma.order.findMany).not.toHaveBeenCalled(); expect(casbinAllowsAllPermissions).not.toHaveBeenCalled();
});
