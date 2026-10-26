jest.mock('../utils/businessNo', () => ({ buildBusinessNo: () => 'DSC-TEST' }));
jest.mock('../utils/raw-sql-compat', () => ({ executeRawCompat: (tx: any, sql: string, ...args: unknown[]) => tx.$executeRawUnsafe(sql, ...args),
  queryRawCompat: (tx: any, sql: string, ...args: unknown[]) => tx.$queryRawUnsafe(sql, ...args) }));
import { ReceiptDiscrepancyService } from './receipt-discrepancy.service';
import type { CreateReceiptDiscrepancyCaseInput } from './receipt-discrepancy.types';

const input: CreateReceiptDiscrepancyCaseInput = { sourceType: 'shipment_receipt', sourceRef: 'SPR-TEST', relatedModule: 'shipping',
  relatedId: 9, counterpartyType: 'customer', counterpartyId: 1, productName: 'Resin', quantity: 2, referenceQuantity: 30,
  unit: 'kg', discrepancyType: 'customer_short_signed', reason: 'Damaged packaging', createdBy: 8 };
function fixture() {
  const rules: any[] = [{ id: 7, ruleNo: 'RULE-7', name: 'Block material variance', sourceType: 'shipment_receipt',
    discrepancyType: 'customer_short_signed', counterpartyType: 'customer', quantityToleranceAbs: 1,
    actionWithinTolerance: 'allow', actionOutsideTolerance: 'block', status: 'active' }];
  const existing: any[] = [];
  const tx = { $queryRawUnsafe: jest.fn(async (sql: string, ..._args: unknown[]) => sql.includes('FROM receipt_tolerance_rules') ? rules : existing),
    $executeRawUnsafe: jest.fn(async () => 1) };
  return { tx, rules, existing };
}

test('read-only preflight uses the original real normalization/tolerance decision and blocks without business writes', async () => {
  const f = fixture();
  await expect(ReceiptDiscrepancyService.assertReceiptAllowed(f.tx as never, input)).rejects.toMatchObject({
    message: 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE', statusCode: 409,
    details: { discrepancyType: 'customer_short_signed', quantity: 2, toleranceRuleId: 7, toleranceQuantity: 1 } });
  expect(f.tx.$queryRawUnsafe).toHaveBeenCalledTimes(1); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(f.tx.$queryRawUnsafe.mock.calls[0][0]).toContain('FROM receipt_tolerance_rules');
});

test('allowed preflight returns its decision for case creation without duplicating the policy definition', async () => {
  const f = fixture(); f.rules[0].quantityToleranceAbs = 3;
  expect(await ReceiptDiscrepancyService.assertReceiptAllowed(f.tx as never, input)).toMatchObject({
    discrepancyType: 'customer_short_signed', decision: { action: 'allow', ruleId: 7, withinTolerance: true, toleranceQuantity: 3 } });
  expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
});

test('case creation rechecks the same policy independently after an earlier allowed preflight', async () => {
  const f = fixture(); f.rules[0].quantityToleranceAbs = 3;
  await ReceiptDiscrepancyService.assertReceiptAllowed(f.tx as never, input);
  f.rules[0].quantityToleranceAbs = 1;
  await expect(ReceiptDiscrepancyService.createCaseForRejectedReceipt(f.tx as never, input)).rejects.toThrow('RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE');
  expect(f.tx.$queryRawUnsafe).toHaveBeenCalledTimes(2); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
});

test('allowed case creation resolves policy once, then retains the existing insert and automatic resolution behavior', async () => {
  const f = fixture(); f.rules[0].quantityToleranceAbs = 3;
  await ReceiptDiscrepancyService.createCaseForRejectedReceipt(f.tx as never, input);
  expect(f.tx.$queryRawUnsafe.mock.calls.filter(([sql]) => sql.includes('FROM receipt_tolerance_rules'))).toHaveLength(1);
  expect(f.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  const [sql, ...args] = (f.tx.$executeRawUnsafe as jest.Mock).mock.calls[0];
  expect(sql).toContain('INSERT INTO receipt_discrepancy_cases');
  expect(args[0]).toBe('DSC-TEST'); expect(args[11]).toBe(2); expect(args[13]).toBe('customer_short_signed');
  expect(args[16]).toBe('resolved'); expect(args[17]).toBe(7); expect(args[18]).toBe('allow'); expect(args[28]).toBe(8);
});

test.each([0, -1, 0.000001, 0.0000001, NaN, Infinity])('legacy rejected-quantity threshold %s still produces no discrepancy and no policy read', async quantity => {
  const f = fixture();
  expect(await ReceiptDiscrepancyService.assertReceiptAllowed(f.tx as never, { ...input, quantity })).toBeNull();
  expect(await ReceiptDiscrepancyService.createCaseForRejectedReceipt(f.tx as never, { ...input, quantity })).toBeNull();
  expect(f.tx.$queryRawUnsafe).not.toHaveBeenCalled(); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
});

test.each([['shipment_receipt', 'customer_short_signed'], ['purchase_receipt', 'short_shipped']] as const)(
  'missing discrepancy type keeps the original %s fallback %s', async (sourceType, expected) => {
    const f = fixture(); f.rules.splice(0);
    const allowed = await ReceiptDiscrepancyService.assertReceiptAllowed(f.tx as never, { ...input, sourceType, discrepancyType: undefined });
    expect(allowed).toMatchObject({ discrepancyType: expected, decision: { action: 'manual_review' } });
    expect(f.tx.$queryRawUnsafe.mock.calls[0][2]).toBe(expected); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

test('validation faults and unknown policy reads remain failures, not allowed or policy-block decisions', async () => {
  const f = fixture();
  await expect(ReceiptDiscrepancyService.assertReceiptAllowed(f.tx as never, { ...input, sourceType: 'unknown' as never })).rejects.toThrow('Invalid discrepancy source type');
  expect(f.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  f.tx.$queryRawUnsafe.mockRejectedValueOnce(new Error('connection closed'));
  await expect(ReceiptDiscrepancyService.assertReceiptAllowed(f.tx as never, input)).rejects.toThrow('connection closed');
  expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
});
