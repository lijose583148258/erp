// Synthetic contract fixture only; never used as business acceptance evidence.
const { requiredChecks, requiredRejections } = require('./sales-fulfillment-plan-proof.cjs');
function salesPlanFixture(stamp = {}) {
  const closed = { stockChanged: false, moneyChanged: false, committedQuantity: 100, receivedQuantity: 100, deliveredFromSource: 100,
    purchaseReceiptIds: [1], shipmentIds: [1], shipmentReceiptIds: [1] };
  const plan = { id: 1, status: 'closed', createdBy: 1, approvedBy: 2, closeoutSnapshot: JSON.stringify(closed) };
  const business = { balances: [{ quantity: 0 }], ledger: [{ quantityDelta: 100, costAmountDelta: 1000 }, { quantityDelta: -100, costAmountDelta: -1000 }], payments: [], order: { paidAmount: 0 } };
  return { ...stamp, status: 'passed', checks: Object.fromEntries(requiredChecks.map(id => [id, true])),
    screenshots: ['sales-plan-mobile-draft.png', 'sales-plan-independent-approval.png', 'sales-plan-closed-readback.png'].map(name => ({ name, loadingHidden: true, unobscured: true })),
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
module.exports = { salesPlanFixture };
