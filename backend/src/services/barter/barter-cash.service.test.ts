import prisma from '../../config/database';
import { createBarterCashObligation, voidBarterCashObligation, recordBarterRefund } from './barter-cash.service';
import { barterRefundSchema } from '../../validators/barter';

describe('barter cash obligation boundaries', () => {
  afterEach(() => jest.restoreAllMocks());
  const input = { amount: 50, currency: 'CNY', requestKey: 'ccf2caa8-667d-450c-ade1-7a35f6c70283',
    paymentReference: 'BANK-001', paymentDate: '2026-01-01', note: '核对外部退款凭证' };
  const row = { id: 7, settlementId: 3, amount: 50, currency: 'CNY', status: 'open' };
  function txMock(value: any = row) {
    const tx = { barterSettlement: { updateMany: jest.fn(async () => ({ count: 1 })) },
      barterCashObligation: { create: jest.fn(), findUnique: jest.fn(async () => value),
        updateMany: jest.fn(async () => ({ count: 1 })), findUniqueOrThrow: jest.fn(async () => value) },
      auditLog: { create: jest.fn(async () => ({})) } };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (fn: any) => fn(tx));
    return tx;
  }
  it('creates only the negative obligation in the caller transaction', async () => {
    const tx = txMock(); const base = { id: 3, currency: 'CNY', counterpartyName: '客户', cashDifference: -50 };
    await createBarterCashObligation(tx as any, base, 4);
    expect(tx.barterCashObligation.create).toHaveBeenCalledWith({ data: { settlementId: 3, amount: 50, currency: 'CNY', counterpartyName: '客户', ownerId: 4, status: 'open' } });
    await createBarterCashObligation(tx as any, { ...base, cashDifference: 50 }, 4);
    expect(tx.barterCashObligation.create).toHaveBeenCalledTimes(1);
  });
  it('rejects false amounts, currencies, dates and incomplete evidence at the API boundary', () => {
    expect(barterRefundSchema.safeParse(input).success).toBe(true);
    for (const override of [{ amount: 0 }, { amount: -50 }, { amount: 50.001 }, { currency: 'usd' },
      { paymentDate: '2026-02-30' }, { paymentDate: '2999-01-01' }, { paymentReference: '' }, { note: '' }, { requestKey: 'bad' }]) {
      expect(barterRefundSchema.safeParse({ ...input, ...override }).success).toBe(false);
    }
  });
  it('records the proof and audit in one transaction without touching order or stock APIs', async () => {
    const tx = txMock(); await recordBarterRefund(3, 4, input);
    expect(tx.barterSettlement.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.barterCashObligation.updateMany.mock.invocationCallOrder[0]);
    expect(tx.barterCashObligation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'settled', resolvedBy: 4, paymentReference: 'BANK-001' }) }));
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('rejects mismatched full amount/currency without writing an obligation or audit', async () => {
    const tx = txMock();
    await expect(recordBarterRefund(3, 4, { ...input, amount: 49 })).rejects.toThrow('全额退款');
    await expect(recordBarterRefund(3, 4, { ...input, currency: 'USD' })).rejects.toThrow('全额退款');
    expect(tx.barterCashObligation.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('replays the exact same actor/proof only, without duplicating the audit', async () => {
    const tx = txMock({ ...row, status: 'settled', ...input, resolutionNote: input.note, resolvedBy: 4 });
    await recordBarterRefund(3, 4, input);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    await expect(recordBarterRefund(3, 5, input)).rejects.toThrow('操作人');
    await expect(recordBarterRefund(3, 4, { ...input, paymentReference: 'BANK-002' })).rejects.toThrow('凭证');
    await expect(recordBarterRefund(3, 4, { ...input, requestKey: 'new' })).rejects.toThrow('重复');
  });
  it('voids an open obligation but blocks resolved, legacy and missing negative obligations', async () => {
    const tx = txMock(); await voidBarterCashObligation(tx as any, 3, 4, true);
    expect(tx.barterCashObligation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'void' }) }));
    for (const value of [null, { ...row, status: 'settled' }, { ...row, status: 'review' }]) {
      tx.barterCashObligation.findUnique.mockResolvedValue(value as any);
      await expect(voidBarterCashObligation(tx as any, 3, 4, true)).rejects.toThrow();
    }
  });
});
