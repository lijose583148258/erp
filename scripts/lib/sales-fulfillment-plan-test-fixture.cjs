// Synthetic contract fixture only; never used as business acceptance evidence.
const { requiredChecks, requiredRejections } = require('./sales-fulfillment-plan-proof.cjs');
function salesPlanFixture(stamp = {}) {
  const closed = { stockChanged: false, moneyChanged: false, committedQuantity: 100, receivedQuantity: 100, deliveredFromSource: 100,
    purchaseReceiptIds: [1], shipmentIds: [1], shipmentReceiptIds: [1] };
  const plan = { id: 1, status: 'closed', createdBy: 1, approvedBy: 2, closeoutSnapshot: JSON.stringify(closed) };
  const business = { balances: [{ quantity: 0 }], ledger: [{ quantityDelta: 100, costAmountDelta: 1000 }, { quantityDelta: -100, costAmountDelta: -1000 }], payments: [], order: { paidAmount: 0 } };
  return { ...stamp, status: 'passed', checks: Object.fromEntries(requiredChecks.map(id => [id, true])),
    screenshots: ['sales-plan-mobile-draft.png', 'sales-plan-independent-approval.png', 'sales-plan-closed-readback.png',
      'sales-presale-partial-100-of-150.png', 'sales-presale-complete-150-of-150.png'].map(name => ({ name, loadingHidden: true, unobscured: true })),
    presale: presaleFixture(),
    rejections: requiredRejections.map(name => ({ name, status: 409, unchanged: true })),
    browserCreate: { httpStatus: 201, planId: 1, injectedReadbacks: 1, getOnlyRecovery: true },
    browserApproval: { planId: 1, status: 200, actor: 2 }, browserClose: { planId: 1, status: 200 },
    beforePlan: { balances: [], ledger: [], payments: [], order: { paidAmount: 0 } }, beforeClose: structuredClone(business),
    finalState: { plans: [plan], business, audits: ['CREATE', 'APPROVE', 'CLOSE'].map(a => ({ resourceId: 1, action: `${a}_SALES_FULFILLMENT_PLAN` })) },
    finalReadbacks: [0, 1].map(() => ({ scope: 'linked_purchase_only', physicalStockReserved: false, confirmationGateEnforced: false,
      fulfillment: { fullyDelivered: true }, plans: [{ ...plan, closeoutSnapshot: structuredClone(closed) }] })),
    concurrency: { sourceQuantity: 50, results: [{ status: 200 }, { status: 409 }], audits: [{}], readbacks: [0, 1].map(() => ({ plans: [{ status: 'approved', plannedQuantity: 50 }] })) },
  };
}
function presaleFixture() {
  const order = { id: 3, finalAmount: 1500, paidAmount: 0, items: [{ id: 9, materialId: 7, quantity: 150, unit: 'kg' }], shipments: [] };
  const original = { order, balances: [{ materialId: 7, quantity: 100 }], ledger: [{ costAmountDelta: 1000 }], payments: [] };
  const shipments = [100, 50].map((quantity, index) => ({ id: index + 1, orderItemId: 9, materialId: 7, quantity, status: 'delivered',
    batchNo: ['existing', 'replenish'][index], shipmentNo: `SHP-${index}`, receipts: [{ acceptedQuantity: quantity, rejectedQuantity: 0 }] }));
  const partial = structuredClone(original); partial.balances[0].quantity = 0; partial.order.shipments = [structuredClone(shipments[0])];
  const beforeShortage = structuredClone(partial); beforeShortage.order.shipments.push({ ...shipments[1], status: 'pending', batchNo: null, receipts: [] });
  const final = structuredClone(partial); final.order.shipments = shipments;
  final.batches = ['existing', 'replenish'].map((batchNo, index) => ({ id: index + 1, materialId: 7, stockQuantity: 0, batchNo }));
  final.ledger = [100, 50].flatMap((q, index) => [1, -1].map(sign => ({ batchId: index + 1, quantityDelta: q * sign, costAmountDelta: q * sign * 10 })));
  final.entries = shipments.map(s => ({ sourceType: 'shipping_issue', sourceRef: s.shipmentNo, movements: [{ batchNo: s.batchNo, quantityDelta: -s.quantity }] }));
  const closeout = { committedQuantity: 50, receivedQuantity: 50, deliveredFromSource: 50, purchaseReceiptIds: [8], shipmentIds: [2] };
  const plan = { id: 6, orderId: 3, orderItemId: 9, sourceDocumentId: 4, status: 'closed', plannedQuantity: 50,
    createdBy: 1, approvedBy: 2, closeoutSnapshot: JSON.stringify(closeout) };
  const readbacks = remaining => [0, 1].map(() => ({ id: 3, finalAmount: 1500, paidAmount: 0,
    fulfillment: { lines: [{ orderItemId: 9, outstandingQuantity: remaining }], fullyDelivered: remaining === 0 } }));
  return { orderId: 3, orderItemId: 9, materialId: 7, existingBatch: 'existing', replenishmentBatch: 'replenish',
    original, partial, beforeShortage, afterShortage: structuredClone(beforeShortage), shortageResponse: { status: 409 }, final,
    partialReadbacks: readbacks(50), finalReadbacks: readbacks(0), partialBrowserText: '待交 50 kg', finalBrowserText: '已交付待回款',
    purchase: { id: 4, salesOrderId: 3, materialId: 7, quantity: 50, receipts: [{ id: 8, batchNo: 'replenish', acceptedQuantity: 50 }] }, plan,
    planReadbacks: [0, 1].map(() => ({ plans: [{ ...plan, closeoutSnapshot: structuredClone(closeout) }] })),
    planAudits: ['CREATE', 'APPROVE', 'CLOSE'].map(a => ({ resourceId: 6, action: `${a}_SALES_FULFILLMENT_PLAN` })),
  };
}
module.exports = { salesPlanFixture };
