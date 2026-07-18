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
  const service = new OrderImportService({
    runTransaction,
    checkCredit,
    scheduleOrderSync,
    writeAuditLog,
    buildOrderNo: () => 'ORD-IMP-TEST',
  });
  return { service, tx, checkCredit, scheduleOrderSync, writeAuditLog, runTransaction };
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

    const response = await harness.service.importOrders(importPayload(20), req);

    const result = requireResult(response);
    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0].message).toContain('outside your data scope');
    expect(harness.checkCredit).not.toHaveBeenCalled();
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.scheduleOrderSync).not.toHaveBeenCalled();
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

    const response = await harness.service.importOrders(importPayload(21), req);

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
      }),
    }));
    expect(harness.scheduleOrderSync).toHaveBeenCalledWith(91);
    expect(harness.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 10,
      action: 'IMPORT',
      resource: 'order',
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

    const response = await harness.service.importOrders(importPayload(22), req);

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
    }), req);

    const result = requireResult(response);
    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(result.errors[0].message).toContain('positive number');
    expect(harness.tx.customer.update).not.toHaveBeenCalled();
    expect(harness.tx.order.create).not.toHaveBeenCalled();
    expect(harness.runTransaction).not.toHaveBeenCalled();
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

    const response = await harness.service.importOrders(importPayload(24), req);

    expect(requireResult(response)).toMatchObject({ success: 1, failed: 0, imported: 1 });
    expect(harness.tx.order.create).toHaveBeenCalledTimes(1);
    expect(harness.scheduleOrderSync).toHaveBeenCalledWith(91);
    expect(harness.writeAuditLog).toHaveBeenCalledTimes(1);
  });
});
