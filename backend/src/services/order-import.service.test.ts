import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth';
import { OrderImportService, type OrderImportDependencies } from './order-import.service';

const importPayload = (customerId: number, overrides: Record<string, unknown> = {}) => [{
  customerId,
  paymentTerms: 30,
  items: [{ productName: 'Resin A', quantity: 2, unitPrice: 25, unit: 'kg' }],
  ...overrides,
}];

const requestFor = (user: AuthRequest['user']) => ({
  user,
  ip: '127.0.0.1',
  get: jest.fn(() => 'jest'),
}) as unknown as AuthRequest;

const requireResult = (response: Awaited<ReturnType<OrderImportService['importOrders']>>) => {
  if (!('result' in response) || !response.result) throw new Error('Expected import result');
  return response.result;
};

function createHarness(customer: Record<string, unknown>, creditAllowed = true) {
  const tx = {
    customer: { update: jest.fn(async () => customer) },
    order: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 91, orderNo: 'ORD-IMP-TEST' })),
    },
  } as unknown as Prisma.TransactionClient;
  const scheduleOrderSync = jest.fn();
  const writeAuditLog = jest.fn(async () => undefined);
  const checkCredit = jest.fn(async () => ({
    allow: creditAllowed,
    reason: creditAllowed ? '' : 'credit limit exceeded',
    exposure: null,
  })) as unknown as OrderImportDependencies['checkCredit'];
  const runTransaction = (
    jest.fn(async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) => operation(tx))
  ) as unknown as OrderImportDependencies['runTransaction'];
  const idempotency = {
    claim: jest.fn(async () => ({ kind: 'owner' as const, batchId: 71, leaseToken: 'lease-test' })),
    renewLease: jest.fn(async () => true),
    complete: jest.fn(async () => undefined),
  };
  const service = new OrderImportService({
    runTransaction,
    checkCredit,
    scheduleOrderSync,
    writeAuditLog,
    buildOrderNo: () => 'ORD-IMP-TEST',
    idempotency,
  });
  return { service, tx, checkCredit, scheduleOrderSync, writeAuditLog, runTransaction, idempotency };
}

describe('order import governance', () => {
  it('rejects a customer outside the actor data scope before credit or order creation', async () => {
    const harness = createHarness({
      id: 20,
      status: 'active',
      salespersonId: 99,
      poolState: 'private',
      segment: 'channel',
    });
    const req = requestFor({
      userId: 10,
      username: 'direct-sales',
      role: 'sales',
      segment: 'direct',
      dataScopes: ['own_customers'],
    });

    const response = await harness.service.importOrders(importPayload(20), req, 'idem-test-20');

    const result = requireResult(response);
    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0].message).toContain('outside your data scope');
    expect(harness.checkCredit).not.toHaveBeenCalled();
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.scheduleOrderSync).not.toHaveBeenCalled();
    expect(harness.idempotency.renewLease).toHaveBeenCalledWith(71, 'lease-test');
  });

  it('runs customer locking, credit validation, order creation, search sync, and audit for an allowed row', async () => {
    const harness = createHarness({
      id: 21,
      status: 'active',
      salespersonId: 11,
      poolState: 'private',
      segment: 'direct',
    });
    const req = requestFor({
      userId: 10,
      username: 'direct-manager',
      role: 'manager',
      segment: 'direct',
      dataScopes: ['team_customers'],
    });

    const response = await harness.service.importOrders(importPayload(21), req, 'idem-test-21');

    expect(requireResult(response)).toMatchObject({ success: 1, failed: 0, imported: 1 });
    expect(harness.tx.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 21 },
      data: { updatedAt: expect.any(Date) },
    }));
    expect(harness.checkCredit).toHaveBeenCalledWith(21, 50, harness.tx);
    expect(harness.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 21,
        totalAmount: 50,
        finalAmount: 50,
        createdBy: 10,
        importBatchId: 71,
        importRowNumber: 1,
      }),
    }));
    expect(harness.scheduleOrderSync).toHaveBeenCalledWith(91);
    expect(harness.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 10,
      action: 'IMPORT',
      resource: 'order',
    }));
    expect(harness.idempotency.complete).toHaveBeenCalledWith(71, 'lease-test', expect.objectContaining({ success: 1 }));
  });

  it('uses the same decimal line-rounding contract for imported orders', async () => {
    const harness = createHarness({
      id: 28,
      status: 'active',
      salespersonId: 10,
      poolState: 'private',
      segment: 'direct',
    });
    const req = requestFor({
      userId: 10,
      username: 'direct-sales',
      role: 'sales',
      segment: 'direct',
      dataScopes: ['own_customers'],
    });

    const response = await harness.service.importOrders(importPayload(28, {
      items: [
        { productName: 'Resin A', quantity: 1, unitPrice: 1.005, unit: 'kg' },
        { productName: 'Resin B', quantity: 3, unitPrice: 0.1, unit: 'kg' },
      ],
    }), req, 'idem-decimal-28');

    expect(requireResult(response)).toMatchObject({ success: 1, failed: 0 });
    expect(harness.checkCredit).toHaveBeenCalledWith(28, 1.31, harness.tx);
    expect(harness.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalAmount: 1.31,
        finalAmount: 1.31,
        items: {
          create: expect.arrayContaining([
            expect.objectContaining({ productName: 'Resin A', totalPrice: 1.01 }),
            expect.objectContaining({ productName: 'Resin B', totalPrice: 0.3 }),
          ]),
        },
      }),
    }));
  });

  it('preserves the row failure when customer credit validation rejects the import', async () => {
    const harness = createHarness({
      id: 22,
      status: 'active',
      salespersonId: 10,
      poolState: 'private',
      segment: 'direct',
    }, false);
    const req = requestFor({
      userId: 10,
      username: 'direct-sales',
      role: 'sales',
      segment: 'direct',
      dataScopes: ['own_customers'],
    });

    const response = await harness.service.importOrders(importPayload(22), req, 'idem-test-22');

    const result = requireResult(response);
    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0].message).toBe('credit limit exceeded');
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.scheduleOrderSync).not.toHaveBeenCalled();
  });

  it('rejects invalid numeric rows before opening a database transaction', async () => {
    const harness = createHarness({
      id: 23,
      status: 'active',
      salespersonId: 10,
      poolState: 'private',
      segment: 'direct',
    });
    const req = requestFor({
      userId: 10,
      username: 'direct-sales',
      role: 'sales',
      segment: 'direct',
      dataScopes: ['own_customers'],
    });
    const response = await harness.service.importOrders(importPayload(23, {
      items: [{ productName: 'Resin A', quantity: -1, unitPrice: 25 }],
    }), req, 'idem-test-23');

    const result = requireResult(response);
    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0].message).toContain('positive number');
    expect(harness.tx.customer.update).not.toHaveBeenCalled();
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.idempotency.renewLease).not.toHaveBeenCalled();
  });

  it('keeps non-numeric money input as a row-level validation failure', async () => {
    const harness = createHarness({
      id: 29,
      status: 'active',
      salespersonId: 10,
      poolState: 'private',
      segment: 'direct',
    });
    const req = requestFor({
      userId: 10,
      username: 'direct-sales',
      role: 'sales',
      segment: 'direct',
      dataScopes: ['own_customers'],
    });

    const response = await harness.service.importOrders(importPayload(29, {
      items: [{ productName: 'Resin A', quantity: 1, unitPrice: 'not-a-number' }],
    }), req, 'idem-invalid-money-29');

    const result = requireResult(response);
    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0].message).toContain('non-negative number');
    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.idempotency.complete).toHaveBeenCalledWith(
      71,
      'lease-test',
      expect.objectContaining({ failed: 1 }),
    );
  });

  it('keeps a committed row successful when the follow-up audit write fails', async () => {
    const harness = createHarness({
      id: 24,
      status: 'active',
      salespersonId: 10,
      poolState: 'private',
      segment: 'direct',
    });
    harness.writeAuditLog.mockRejectedValueOnce(new Error('audit store unavailable'));
    const req = requestFor({
      userId: 10,
      username: 'direct-sales',
      role: 'sales',
      segment: 'direct',
      dataScopes: ['own_customers'],
    });

    const response = await harness.service.importOrders(importPayload(24), req, 'idem-test-24');

    expect(requireResult(response)).toMatchObject({ success: 1, failed: 0, imported: 1 });
    expect(harness.tx.order.create).toHaveBeenCalledTimes(1);
    expect(harness.scheduleOrderSync).toHaveBeenCalledWith(91);
    expect(harness.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it('returns a completed exact replay without opening a transaction or duplicating audit', async () => {
    const harness = createHarness({});
    (harness.idempotency.claim as jest.Mock).mockResolvedValueOnce({
      kind: 'replay',
      batchId: 71,
      result: { success: 1, failed: 0, errors: [], attempted: 1, imported: 1 },
    });
    const req = requestFor({
      userId: 10, username: 'direct-manager', role: 'manager', segment: 'direct', dataScopes: ['team_customers'],
    });

    const response = await harness.service.importOrders(importPayload(25), req, 'idem-replay-25');

    expect(requireResult(response)).toMatchObject({ success: 1, failed: 0 });
    expect('replayed' in response && response.replayed).toBe(true);
    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects an in-progress or payload-mismatched key before business writes', async () => {
    const harness = createHarness({});
    (harness.idempotency.claim as jest.Mock).mockResolvedValueOnce({ kind: 'conflict', message: 'payload mismatch' });
    const req = requestFor({
      userId: 10, username: 'direct-manager', role: 'manager', segment: 'direct', dataScopes: ['team_customers'],
    });

    const response = await harness.service.importOrders(importPayload(26), req, 'idem-conflict-26');

    expect(response).toEqual({ error: 'payload mismatch', statusCode: 409 });
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  it('leaves transient infrastructure failures resumable instead of storing a false completed result', async () => {
    const harness = createHarness({});
    (harness.tx.customer.update as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'));
    const req = requestFor({
      userId: 10, username: 'direct-manager', role: 'manager', segment: 'direct', dataScopes: ['team_customers'],
    });

    await expect(harness.service.importOrders(importPayload(27), req, 'idem-infra-27'))
      .rejects.toThrow('database unavailable');
    expect(harness.idempotency.complete).not.toHaveBeenCalled();
  });
});
