const PASSWORD = 'Audit12345';

function createAuditData(runId) {
  return {
    roles: {
      viewer: `coll_ui_view_${runId}`.slice(0, 48),
      operator: `coll_ui_oper_${runId}`.slice(0, 48),
      finance: `coll_ui_fin_${runId}`.slice(0, 48),
    },
    users: {
      viewer: `coll_ui_viewer_${runId}`.slice(0, 48),
      operator: `coll_ui_operator_${runId}`.slice(0, 48),
      finance: `coll_ui_finance_${runId}`.slice(0, 48),
    },
  };
}

function createCollectionUiPermissionSeeder({
  apiFetch,
  dataOf,
  expect,
  expectStatus,
  prisma,
  runId,
}) {
  async function createRole(token, { code, dataScopes, permissions }) {
    const response = await apiFetch('/roles', {
      method: 'POST',
      data: {
        code,
        name: code,
        description: `Created by collection-ui-permission-browser-audit-v1 ${runId}`,
        isActive: true,
        dataScopes,
        permissions,
      },
    }, token);
    expectStatus(response, [201], `create role ${code}`);
    return dataOf(response);
  }

  async function createTeamMember(token, { username, role, segment = 'direct' }) {
    const response = await apiFetch('/team', {
      method: 'POST',
      data: {
        username,
        password: PASSWORD,
        email: `${username}@example.com`,
        role,
        segment,
      },
    }, token);
    expectStatus(response, [201], `create user ${username}`);
    return dataOf(response);
  }

  async function createCustomer(token, label) {
    const response = await apiFetch('/customers', {
      method: 'POST',
      data: {
        nameZh: `${label}-客户`,
        nameEn: `${label} Customer`,
        nameVi: `${label} Khach Hang`,
        licenseNumber: `LIC-${label}`.slice(0, 64),
        creditLimit: 100000,
        riskLevel: 'medium',
        segment: 'direct',
        contactName: `${label} Contact`,
        contactPhone: '0900000000',
        contactEmail: `${label.toLowerCase()}@example.com`,
        address: `${label} audit address`,
        status: 'active',
      },
    }, token);
    expectStatus(response, [201], `create customer ${label}`);
    const customer = dataOf(response);
    expect(Boolean(customer?.id), `create customer ${label} returned no id`, response.json);
    return customer;
  }

  async function createOrder(token, customerId, label) {
    const response = await apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customerId),
        items: [{
          productName: `${label}-胶水`,
          specification: 'collection-ui-permission-audit',
          quantity: 10,
          unit: 'kg',
          unitPrice: 120,
        }],
        paymentTerms: 30,
        notes: `collection ui permission audit ${runId}`,
      },
    }, token);
    expectStatus(response, [201], `create order ${label}`);
    const order = dataOf(response);
    expect(Boolean(order?.id), `create order ${label} returned no id`, response.json);
    return order;
  }

  async function recordPayment(token, orderId, label) {
    const response = await apiFetch(`/orders/${orderId}/payment`, {
      method: 'POST',
      data: {
        amount: 100,
        method: 'cash',
        payerName: `${label} payer`,
        note: `pending payment ${runId} ${label}`,
      },
    }, token);
    expectStatus(response, [200], `record payment ${label}`);
  }

  async function makeOrderOverdue(orderId) {
    const createdAt = new Date(Date.now() - 65 * 24 * 3600 * 1000);
    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { createdAt },
    });
  }

  async function seedBusinessChain(actor, label) {
    const customer = await createCustomer(actor.token, label);
    const order = await createOrder(actor.token, customer.id, label);
    await recordPayment(actor.token, order.id, label);
    await makeOrderOverdue(order.id);
    return { customer, order };
  }

  return {
    createRole,
    createTeamMember,
    seedBusinessChain,
  };
}

module.exports = {
  PASSWORD,
  createAuditData,
  createCollectionUiPermissionSeeder,
};
