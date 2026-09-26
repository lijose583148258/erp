import assert from 'node:assert/strict';
import test from 'node:test';
import type { SalesOrder } from '../../types';
import { buildSalesOrderShipmentPayload, getEligibleShipmentLines } from './salesOrderShipmentHelpers';

const fixture = () => ({
    id: '7', customerId: '9', status: 'shipped',
    items: [{ id: 11, materialId: 21, productName: '树脂', quantity: 100, unit: 'kg' },
        { id: 12, materialId: 22, productName: '赠品', quantity: 2, unit: '桶' }],
    fulfillment: { fullyDelivered: false, needsReview: false, lines: [
        { orderItemId: 11, productName: '旧显示名', orderedQuantity: 100, unit: 'kg', acceptedQuantity: 40, unallocatedQuantity: 60 },
        { orderItemId: 12, productName: '赠品', orderedQuantity: 2, unit: '桶', acceptedQuantity: 0, unallocatedQuantity: 2 },
    ] },
} as unknown as SalesOrder);
const draft = { orderItemId: '11', quantity: '60', batchNo: ' BATCH-A ', carrier: ' Carrier ', trackingNo: '' };

test('uses the exact bound line and canonical unit rather than adding unlike units', () => {
    const order = fixture();
    assert.deepEqual(getEligibleShipmentLines(order).map(line => [line.orderItemId, line.unallocatedQuantity, line.unit]), [[11, 60, 'kg'], [12, 2, '桶']]);
    assert.deepEqual(buildSalesOrderShipmentPayload(order, draft), {
        orderId: '7', orderItemId: '11', customerId: '9', materialId: '21', productName: '树脂', unit: 'kg', quantity: 60,
        batchNo: 'BATCH-A', carrier: 'Carrier', trackingNo: undefined,
    });
    assert.equal(buildSalesOrderShipmentPayload(order, { ...draft, orderItemId: '12', quantity: '2' }).unit, '桶');
});

test('allows confirmed, shipped and legacy delivered remainder only', () => {
    for (const status of ['confirmed', 'shipped', 'delivered']) assert.equal(getEligibleShipmentLines({ ...fixture(), status } as SalesOrder).length, 2);
    for (const status of ['pending', 'cancelled', 'completed', 'unknown']) assert.deepEqual(getEligibleShipmentLines({ ...fixture(), status } as SalesOrder), []);
});

test('rejects missing fulfillment, full delivery and evidence requiring review', () => {
    assert.deepEqual(getEligibleShipmentLines({ ...fixture(), fulfillment: undefined }), []);
    for (const key of ['fullyDelivered', 'needsReview']) {
        const order = fixture(); (order.fulfillment as any)[key] = true;
        assert.deepEqual(getEligibleShipmentLines(order), []);
    }
    assert.deepEqual(getEligibleShipmentLines(null), []);
});

test('rejects missing material or exact item identity, duplicates and mixed-unit binding', () => {
    for (const mutation of [
        (order: SalesOrder) => { order.items[0].materialId = null; },
        (order: SalesOrder) => { (order.items[0] as any).id = undefined; },
        (order: SalesOrder) => { order.items.push(order.items[0]); },
        (order: SalesOrder) => { order.fulfillment!.lines.push(order.fulfillment!.lines[0]); },
        (order: SalesOrder) => { order.items[0].unit = '桶'; },
        (order: SalesOrder) => { order.items[0].quantity = 101; },
    ]) {
        const order = fixture(); mutation(order);
        assert(!getEligibleShipmentLines(order).some(line => line.orderItemId === 11));
        assert.throws(() => buildSalesOrderShipmentPayload(order, draft));
    }
});

test('rejects an empty, nonpositive, non-finite or excessive quantity and requires a batch', () => {
    for (const quantity of ['', ' ', '0', '-1', 'NaN', 'Infinity', '61', '60.0000001']) {
        assert.throws(() => buildSalesOrderShipmentPayload(fixture(), { ...draft, quantity }));
    }
    assert.throws(() => buildSalesOrderShipmentPayload(fixture(), { ...draft, batchNo: ' ' }));
    assert.throws(() => buildSalesOrderShipmentPayload(fixture(), { ...draft, orderItemId: '999' }));
});

test('does not silently reuse an earlier quantity after refreshed allocation consumes it', () => {
    const order = fixture(); order.fulfillment!.lines[0].unallocatedQuantity = 20;
    assert.throws(() => buildSalesOrderShipmentPayload(order, draft));
    assert.equal(buildSalesOrderShipmentPayload(order, { ...draft, quantity: '20' }).quantity, 20);
    order.fulfillment!.lines[0].unallocatedQuantity = 0;
    assert(!getEligibleShipmentLines(order).some(line => line.orderItemId === 11));
});

test('preserves a positive micro-quantity remainder without allowing epsilon over-allocation', () => {
    const order = fixture(); order.items[0].quantity = 0.000001;
    Object.assign(order.fulfillment!.lines[0], { orderedQuantity: 0.000001, acceptedQuantity: 0.0000004, unallocatedQuantity: 0.0000006 });
    assert.equal(buildSalesOrderShipmentPayload(order, { ...draft, quantity: '0.0000006' }).quantity, 0.0000006);
    assert.throws(() => buildSalesOrderShipmentPayload(order, { ...draft, quantity: '0.000001' }));
});
