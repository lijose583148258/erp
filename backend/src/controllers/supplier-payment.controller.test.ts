jest.mock('../config/database', () => ({ __esModule: true, default: { $transaction: jest.fn() } }));
jest.mock('../services/supplier-payment.service', () => ({ getSupplierPaymentBundle: jest.fn() }));
jest.mock('../domain/purchase-payable', () => ({ requireReceiptPayableSource: jest.fn(() => ({ binding: { supplierId: 2 } })) }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn(action => action()) }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn() } }));
import prisma from '../config/database';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { getSupplierPaymentBundle } from '../services/supplier-payment.service';
import { SupplierPaymentController } from './supplier-payment.controller';

function fixture() {
  jest.clearAllMocks();
  const row = (id: number) => ({ id, receiptNo: `RCV-${id}`, purchaseOrderId: 1, batchNo: `Internal-${id}`, supplierBatchNo: 'Supplier-lot',
    acceptedQuantity: 1, unit: 'kg', receivedAt: new Date('2026-10-14T00:00:00Z'), purchaseOrder: { supplierId: 2, supplier: { id: 2, name: 'Supplier' } } });
  const tx = { purchaseReceipt: { findMany: jest.fn(async () => [row(1), row(2)]), count: jest.fn(async () => 2) } };
  (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
  const req: any = { user: { role: 'finance', userId: 8, dataScopes: ['finance_visible', 'procurement_visible'] }, query: {} };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res, tx, controller: new SupplierPaymentController() };
}
test('a proven historical QA reconciliation failure leaves only that candidate unknown, never zero, while other debts remain visible', async () => {
  const f = fixture();
  (getSupplierPaymentBundle as jest.Mock).mockImplementation(async (_tx, id) => {
    if (id === 1) throw new AppError('INCOMING_QUALITY_EVIDENCE_INVALID', 409, ErrorCode.CONFLICT);
    return { purchaseReceiptId: id, currency: 'USD', payableAmountNative: '10.01', payableAmountBase: '71.50',
      paidAmountNative: '0.00', paidAmountBase: '0.00', outstandingAmountNative: '10.01', outstandingAmountBase: '71.50',
      payments: [], paymentEligibility: { eligible: false, reason: 'INCOMING_QA_RELEASE_REQUIRED' } };
  });
  await f.controller.getPayables(f.req, f.res);
  const response = f.res.json.mock.calls[0][0]; expect(response.success).toBe(true);
  expect(response.data.items[0]).toMatchObject({ state: 'history_unreconciled', reason: 'INCOMING_QUALITY_EVIDENCE_INVALID',
    payableAmountNative: null, paidAmountNative: null, outstandingAmountNative: null, payments: null });
  expect(response.data.items[1]).toMatchObject({ state: 'reconciled', payableAmountNative: '10.01', outstandingAmountNative: '10.01' });
});
test.each([new Error('Database unavailable'), new AppError('UNRECOGNIZED_FAILURE', 409, ErrorCode.CONFLICT)])('unknown failures are not converted to business-safe null rows', async error => {
  const f = fixture(); (getSupplierPaymentBundle as jest.Mock).mockRejectedValue(error);
  await f.controller.getPayables(f.req, f.res);
  expect(f.res.json.mock.calls[0][0].success).toBe(false);
  expect(f.res.status).toHaveBeenCalledWith(error instanceof AppError ? 409 : 500);
});
test.each([{ scopes: ['finance_visible'] }, { scopes: ['procurement_visible'] }, { scopes: [] }])('both operational data scopes are required before any financial read (%j)', async ({ scopes }) => {
  const f = fixture(); f.req.user.dataScopes = scopes; await f.controller.getPayables(f.req, f.res);
  expect(f.res.status).toHaveBeenCalledWith(403); expect(prisma.$transaction).not.toHaveBeenCalled();
});
