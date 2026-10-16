import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderStatus } from '../types';
import { buildShipmentDraftPayload, getEligibleShipmentLines, parseShipmentDispatchTarget, parseShipmentDispatchTargets,
    projectShipmentDispatchTarget } from './shipmentDispatchTarget';

const wire = () => ({
    id: 7, orderNo: 'SO-7', status: 'shipped', customerId: 9,
    customer: { id: 9, name: '客户', nameZh: '客户', nameEn: null, nameVi: null },
    items: [{ id: 11, materialId: 21, productName: '树脂', quantity: 100, unit: 'kg' },
        { id: 12, materialId: 22, productName: '赠品', quantity: 2, unit: '桶' }],
    fulfillment: { fullyDelivered: false, needsReview: false, hasUnallocated: true, lines: [
        { orderItemId: 11, productName: '旧显示名', orderedQuantity: 100, unit: 'kg', allocatedQuantity: 40,
            dispatchedQuantity: 40, acceptedQuantity: 40, outstandingQuantity: 60, unallocatedQuantity: 60,
            reservedQuantity: 0, reservationEvidenceState: 'verified' },
        { orderItemId: 12, productName: '赠品', orderedQuantity: 2, unit: '桶', allocatedQuantity: 0,
            dispatchedQuantity: 0, acceptedQuantity: 0, outstandingQuantity: 2, unallocatedQuantity: 2,
            reservedQuantity: null, reservationEvidenceState: 'legacy_unknown' },
    ] },
});
const draft = { orderItemId: '11', quantity: '60', batchNo: ' BATCH-A ', carrier: ' Carrier ', trackingNo: '' };

test('strict wire parsing projects real logistics identities, status, reservation evidence and no prices', () => {
    const source = wire();
    Object.assign(source, { totalAmount: 999, paidAmount: 777 });
    Object.assign(source.items[0], { unitPrice: 888, totalPrice: 999, amount: 100 });
    Object.assign(source.fulfillment.lines[0], { cost: 10 });
    const target = parseShipmentDispatchTarget(source)!;
    assert.equal(target.id, '7'); assert.equal(target.customerId, '9'); assert.equal(target.customer.id, '9');
    assert.equal(target.status, 'shipped');
    assert.equal(target.fulfillment.lines[0].reservationEvidenceState, 'verified');
    assert.equal(target.fulfillment.lines[1].reservedQuantity, null);
    assert.deepEqual(Object.keys(target).sort(), ['customer', 'customerId', 'fulfillment', 'id', 'items', 'orderNo', 'status']);
    assert.deepEqual(Object.keys(target.items[0]).sort(), ['id', 'materialId', 'productName', 'quantity', 'unit']);
    assert(!JSON.stringify(target).match(/unitPrice|totalPrice|totalAmount|paidAmount|cost|amount/));
    source.items[0].quantity = 999; source.fulfillment.lines[0].unallocatedQuantity = 999;
    assert.equal(target.items[0].quantity, 100); assert.equal(target.fulfillment.lines[0].unallocatedQuantity, 60);
});

test('candidate lists reject malformed entries and duplicate order identities rather than returning a partial list', () => {
    assert.deepEqual(parseShipmentDispatchTargets([]), []);
    assert.equal(parseShipmentDispatchTargets([wire()]).length, 1);
    for (const value of [undefined, null, {}, { data: [wire()] }, [null], [wire(), wire()], [wire(), { id: 8 }]]) {
        assert.throws(() => parseShipmentDispatchTargets(value));
    }
});

test('rejects coerced or unsafe wire IDs, missing actual status and mismatched customer identities', () => {
    const mutations = [
        (source: any) => { source.id = '7'; }, (source: any) => { source.id = true; },
        (source: any) => { source.id = Number.MAX_SAFE_INTEGER + 1; }, (source: any) => { source.customerId = 0; },
        (source: any) => { source.customer.id = 8; }, (source: any) => { delete source.customer; },
        (source: any) => { source.items[0].id = '11'; }, (source: any) => { source.items[0].materialId = '21'; },
        (source: any) => { delete source.status; }, (source: any) => { source.status = 'completed'; },
        (source: any) => { delete source.orderNo; }, (source: any) => { source.orderNo = ' '; },
        (source: any) => { source.customer.nameZh = 9; },
    ];
    for (const mutate of mutations) { const source = wire(); mutate(source); assert.equal(parseShipmentDispatchTarget(source), null); }
});

test('rejects duplicate or foreign lines, inconsistent canonical quantity/unit and malformed evidence', () => {
    const mutations = [
        (source: any) => { source.items.push(source.items[0]); },
        (source: any) => { source.fulfillment.lines.push(source.fulfillment.lines[0]); },
        (source: any) => { source.fulfillment.lines[0].orderItemId = 99; },
        (source: any) => { source.fulfillment.lines.pop(); },
        (source: any) => { source.items[0].quantity = 101; }, (source: any) => { source.items[0].unit = '桶'; },
        (source: any) => { source.items[0].unit = 9; }, (source: any) => { source.items[0].productName = ''; },
        (source: any) => { source.items[0].quantity = '100'; }, (source: any) => { source.fulfillment.lines[0].acceptedQuantity = NaN; },
        (source: any) => { source.fulfillment.lines[0].unallocatedQuantity = 101; },
        (source: any) => { source.fulfillment.lines[0].allocatedQuantity = Infinity; },
        (source: any) => { source.fulfillment.lines[0].reservedQuantity = -1; },
        (source: any) => { source.fulfillment.lines[0].reservationEvidenceState = 'unknown'; },
        (source: any) => { source.fulfillment.needsReview = 'false'; },
        (source: any) => { source.fulfillment.hasUnallocated = 1; }, (source: any) => { delete source.fulfillment; },
    ];
    for (const mutate of mutations) { const source = wire(); mutate(source); assert.equal(parseShipmentDispatchTarget(source), null); }
});

test('preserves actual pending/cancelled states but only confirmed/shipped/delivered remainder is eligible', () => {
    for (const status of Object.values(OrderStatus)) {
        const target = parseShipmentDispatchTarget({ ...wire(), status })!;
        assert.equal(target.status, status);
        assert.equal(getEligibleShipmentLines(target).length, ['confirmed', 'shipped', 'delivered'].includes(status) ? 2 : 0);
    }
    for (const flag of ['fullyDelivered', 'needsReview']) {
        const source = wire(); Object.assign(source.fulfillment, { [flag]: true });
        assert.deepEqual(getEligibleShipmentLines(parseShipmentDispatchTarget(source)), []);
    }
    assert.deepEqual(getEligibleShipmentLines(undefined), []);
});

test('missing material is never bound and payload uses exact canonical item fields without cross-unit totals', () => {
    const source = wire(); (source.items[0] as any).materialId = null;
    const missing = parseShipmentDispatchTarget(source)!;
    assert.deepEqual(getEligibleShipmentLines(missing).map(line => line.orderItemId), [12]);
    assert.throws(() => buildShipmentDraftPayload(missing, draft));
    const target = parseShipmentDispatchTarget(wire())!;
    assert.deepEqual(buildShipmentDraftPayload(target, draft), {
        orderId: '7', customerId: '9', orderItemId: '11', materialId: '21', productName: '树脂', quantity: 60, unit: 'kg',
        batchNo: 'BATCH-A', carrier: 'Carrier', trackingNo: undefined,
    });
    assert.equal(buildShipmentDraftPayload(target, { ...draft, orderItemId: '12', quantity: '2', batchNo: ' ' }).unit, '桶');
    for (const quantity of ['', ' ', '0', '-1', 'NaN', 'Infinity', '60.0000001']) {
        assert.throws(() => buildShipmentDraftPayload(target, { ...draft, quantity }));
    }
});

test('preserves micro-quantities and existing floating-point readback instead of rounding/recomputing fulfillment', () => {
    const source = wire(); source.items[0].quantity = 0.000001;
    Object.assign(source.fulfillment.lines[0], { orderedQuantity: 0.000001, allocatedQuantity: 0.0000004,
        dispatchedQuantity: 0.0000004, acceptedQuantity: 0.0000004, outstandingQuantity: 0.0000006, unallocatedQuantity: 0.0000006 });
    const target = parseShipmentDispatchTarget(source)!;
    assert.equal(buildShipmentDraftPayload(target, { ...draft, quantity: '0.0000006' }).quantity, 0.0000006);
    assert.throws(() => buildShipmentDraftPayload(target, { ...draft, quantity: '0.000000600000001' }));
    source.items[0].quantity = 0.3;
    Object.assign(source.fulfillment.lines[0], { orderedQuantity: 0.3, acceptedQuantity: 0.1 + 0.2, unallocatedQuantity: 0.1 });
    assert.equal(parseShipmentDispatchTarget(source)!.fulfillment.lines[0].acceptedQuantity, 0.1 + 0.2);
});

test('mapped-identity projection permits canonical frontend strings but rejects ambiguous coercions', () => {
    const source = wire();
    assert.equal(projectShipmentDispatchTarget({ ...source, id: '7', customerId: '9', customer: { id: '9' }, orderNo: undefined })!.id, '7');
    for (const id of ['07', '7.0', ' 7', '7 ', '1e1', true, 0]) {
        assert.equal(projectShipmentDispatchTarget({ ...source, id }), null);
    }
});
