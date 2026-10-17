import { createSalesFulfillmentPlanSchema, approveSalesFulfillmentPlanSchema, closeSalesFulfillmentPlanSchema, cancelSalesFulfillmentPlanSchema } from './sales-fulfillment';
const valid = { idempotencyKey: 'test-plan-123', orderItemId: 1, fulfillmentOption: 'linked_purchase', sourceDocumentId: 2,
  plannedQuantity: 100, expectedFulfillmentAt: '2027-01-01T01:00:00.000Z', note: 'Actual supply source' };
describe('sales fulfillment plan boundaries', () => {
  it('accepts only a concrete purchase-backed draft', () => { expect(createSalesFulfillmentPlanSchema.parse(valid)).toEqual(valid); });
  it.each([{ fulfillmentOption: 'substitution' }, { plannedQuantity: 0 }, { plannedQuantity: -1 }, { plannedQuantity: Infinity },
    { sourceDocumentId: 0 }, { orderItemId: 1.5 }, { expectedFulfillmentAt: 'tomorrow' }, { note: '  ' }, { idempotencyKey: 'new' }, { status: 'approved' }])('rejects unsafe plan fields %s', change => {
    expect(createSalesFulfillmentPlanSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
  it('requires immutable review and replay inputs', () => {
    const cancel = { reason: 'Replace old commitment', idempotencyKey: 'cancel-key', expectedUpdatedAt: '2026-10-01T00:00:00.000Z', expectedStatus: 'approved' };
    expect(cancelSalesFulfillmentPlanSchema.parse(cancel)).toEqual(cancel);
    for (const patch of [{ expectedUpdatedAt: undefined }, { reason: ' ' }, { stockQuantity: 1 }, { paidAmount: 0 }]) {
      expect(cancelSalesFulfillmentPlanSchema.safeParse({ ...cancel, ...patch }).success).toBe(false);
    }
    expect(approveSalesFulfillmentPlanSchema.safeParse({ reason: 'independent review' }).success).toBe(false);
    expect(closeSalesFulfillmentPlanSchema.safeParse({ reason: 'source proven', idempotencyKey: 'closing-key', stockQuantity: 100 }).success).toBe(false);
    expect(closeSalesFulfillmentPlanSchema.parse({ reason: 'source proven', idempotencyKey: 'closing-key' }).reason).toBe('source proven');
  });
});
