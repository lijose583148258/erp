async function loginAdmin(runtime, { admin, stepTimeoutMs }) {
  return runtime.withTimeout('api-login-admin', stepTimeoutMs, async () => {
    const response = await runtime.apiFetch('/auth/login', {
      method: 'POST',
      data: admin,
    });
    runtime.expectStatus(response, [200], 'admin login');
    const data = runtime.dataOf(response);
    runtime.expect(Boolean(data?.token), 'admin login returned no token', response.json);
    runtime.expect(Boolean(data?.user), 'admin login returned no user', response.json);
    return { token: data.token, user: data.user };
  });
}

async function ensureAlternateCreator(runtime, { token, prisma, runId }) {
  const adminResponse = await runtime.apiFetch('/auth/me', {}, token).catch(() => null);
  const currentUserId = Number(runtime.dataOf(adminResponse)?.id || runtime.dataOf(adminResponse)?.user?.id || 1);
  const existing = await prisma.user.findFirst({
    where: {
      id: { not: Number.isFinite(currentUserId) ? currentUserId : 1 },
      isActive: true,
    },
    select: { id: true, username: true },
    orderBy: { id: 'asc' },
  });
  if (existing) return existing;

  const created = await runtime.apiFetch('/team', {
    method: 'POST',
    data: {
      username: `hf_creator_${runId}`.slice(0, 48),
      password: 'Audit12345',
      email: `hf_creator_${runId}@example.com`,
      role: 'sales',
      segment: 'direct',
    },
  }, token);
  runtime.expectStatus(created, [201], 'create alternate order creator');
  const user = runtime.dataOf(created);
  runtime.expect(Boolean(user?.id), 'alternate creator create returned no id', created.json);
  return { id: Number(user.id), username: user.username || user.name || `hf_creator_${runId}` };
}

async function seedBusinessChain(runtime, {
  token,
  prisma,
  runId,
  testData,
  report,
  stepTimeoutMs,
}) {
  return runtime.withTimeout('seed-collection-business-chain', stepTimeoutMs * 3, async () => {
    const alternateCreator = await ensureAlternateCreator(runtime, { token, prisma, runId });
    const customerResponse = await runtime.apiFetch('/customers', {
      method: 'POST',
      data: {
        nameZh: testData.customerNameZh,
        nameEn: testData.customerNameEn,
        nameVi: testData.customerNameVi,
        licenseNumber: `LIC-HF-${runId}`.slice(0, 64),
        creditLimit: 100000,
        riskLevel: 'medium',
        segment: 'direct',
        contactName: `HF Contact ${runId}`,
        contactPhone: '0900000000',
        contactEmail: `hf-${runId}@example.com`,
        address: `HF audit address ${runId}`,
        status: 'active',
      },
    }, token);
    runtime.expectStatus(customerResponse, [201], 'create human-flow customer');
    const customer = runtime.dataOf(customerResponse);
    runtime.expect(Boolean(customer?.id), 'customer create returned no id', customerResponse.json);

    const orderResponse = await runtime.apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [{
          productName: testData.productName,
          specification: 'human-flow-audit',
          quantity: 24,
          unit: 'kg',
          unitPrice: 100,
        }],
        paymentTerms: 1,
        notes: `collection center browser human flow ${runId}`,
      },
    }, token);
    runtime.expectStatus(orderResponse, [201], 'create human-flow order');
    const order = runtime.dataOf(orderResponse);
    runtime.expect(Boolean(order?.id), 'order create returned no id', orderResponse.json);

    await prisma.order.update({
      where: { id: Number(order.id) },
      data: {
        createdBy: alternateCreator.id,
        createdAt: new Date(Date.now() - 65 * 24 * 3600 * 1000),
        updatedAt: new Date(),
      },
    });

    const paymentResponse = await runtime.apiFetch(`/orders/${order.id}/payment`, {
      method: 'POST',
      data: {
        amount: 100,
        method: 'cash',
        payerName: `HF payer ${runId}`,
        note: testData.paymentNote,
      },
    }, token);
    runtime.expectStatus(paymentResponse, [200], 'record pending payment');

    const holdResponse = await runtime.apiFetch(`/collections/orders/${order.id}/shipment-hold`, {
      method: 'POST',
      data: {
        reason: testData.holdReason,
        source: 'manual',
      },
    }, token);
    runtime.expectStatus(holdResponse, [200], 'set order shipment hold');

    const syncResponse = await runtime.apiFetch('/collections/sync-overdue', { method: 'POST' }, token);
    runtime.expectStatus(syncResponse, [200], 'sync overdue after seed');

    const workbenchResponse = await runtime.apiFetch('/collections/workbench', {}, token);
    runtime.expectStatus(workbenchResponse, [200], 'workbench readback after seed');
    const bundle = runtime.dataOf(workbenchResponse);
    const overdue = Array.isArray(bundle?.overdue) ? bundle.overdue : [];
    const ledger = Array.isArray(bundle?.ledger) ? bundle.ledger : [];
    const holds = Array.isArray(bundle?.holds) ? bundle.holds : [];
    const seededOverdue = overdue.find((row) => Number(row.orderId) === Number(order.id));
    const seededPayment = ledger.find((row) => Number(row.orderId) === Number(order.id) && String(row.note || '').includes(testData.paymentNote));
    const seededHold = holds.find((row) => Number(row.orderId) === Number(order.id) && String(row.reason || '').includes(testData.holdReason));
    runtime.expect(Boolean(seededOverdue), 'seeded order did not appear in overdue list', { orderId: order.id, overdue });
    runtime.expect(Boolean(seededPayment?.id), 'seeded pending payment did not appear in ledger', { orderId: order.id, ledger });
    runtime.expect(Boolean(seededHold), 'seeded shipment hold did not appear in holds', { orderId: order.id, holds });

    report.seeded = {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      orderNo: order.orderNo,
      paymentId: Number(seededPayment.id),
      alternateCreatorId: alternateCreator.id,
      alternateCreatorName: alternateCreator.username,
      overdueDays: seededOverdue.daysOverdue,
    };

    return {
      customer,
      order: { ...order, id: Number(order.id), orderNo: order.orderNo },
      paymentId: Number(seededPayment.id),
    };
  });
}

module.exports = {
  loginAdmin,
  seedBusinessChain,
};
