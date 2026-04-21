/**
 * Cross-module record permission audit.
 * Covers RMA, Samples, and Contracts using the same customer-pool rule as Orders.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'cross-module-permission-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  ownedCustomerName: `XMOD-OWN-${RUN_ID}`,
  publicCustomerName: `XMOD-PUB-${RUN_ID}`,
  productName: `XMOD-PROD-${RUN_ID}`,
  contractTitle: `XMOD-CON-${RUN_ID}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  if (!response.ok) {
    throw new Error(`Login failed (${username}): ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function createCustomer(token, data) {
  const response = await apiFetch('/customers', { method: 'POST', data }, token);
  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`Customer create failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.json)}`);
  }
}

async function run() {
  try {
    const sales = await login('sales', 'sales123');
    const manager = await login('manager', 'manager123');
    recordStep({
      step: 'login-sales-manager',
      result: 'passed',
      salesUserId: sales.user.id,
      managerUserId: manager.user.id,
    });

    const ownedCustomer = await createCustomer(sales.token, {
      name: DATA.ownedCustomerName,
      nameZh: DATA.ownedCustomerName,
      nameEn: `Cross Module Owned ${RUN_ID}`,
      nameVi: `Khach rieng xmod ${RUN_ID}`,
      licenseNumber: `LIC-XMOD-OWN-${RUN_ID}`,
      creditLimit: 50000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: 'XMOD Owned Contact',
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `xmod-owned-${RUN_ID}@example.com`,
    });

    const publicCustomer = await createCustomer(manager.token, {
      name: DATA.publicCustomerName,
      nameZh: DATA.publicCustomerName,
      nameEn: `Cross Module Public ${RUN_ID}`,
      nameVi: `Khach cong xmod ${RUN_ID}`,
      licenseNumber: `LIC-XMOD-PUB-${RUN_ID}`,
      creditLimit: 50000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'public',
      contactName: 'XMOD Public Contact',
      contactPhone: `08${RUN_ID.slice(-8)}`,
      contactEmail: `xmod-public-${RUN_ID}@example.com`,
    });
    recordStep({
      step: 'create-owned-and-public-customers',
      result: 'passed',
      ownedCustomerId: ownedCustomer.id,
      publicCustomerId: publicCustomer.id,
    });

    const ownRma = await apiFetch('/rma', {
      method: 'POST',
      data: {
        customerId: Number(ownedCustomer.id),
        productName: DATA.productName,
        quantity: 1,
        unit: 'kg',
        reason: `owned rma ${RUN_ID}`,
      },
    }, sales.token);
    if (!ownRma.ok || !ownRma.json?.data?.id) {
      throw new Error(`Sales should create own-customer RMA: ${ownRma.status} ${JSON.stringify(ownRma.json)}`);
    }
    const publicRma = await apiFetch('/rma', {
      method: 'POST',
      data: {
        customerId: Number(publicCustomer.id),
        productName: DATA.productName,
        quantity: 1,
        unit: 'kg',
        reason: `public rma deny ${RUN_ID}`,
      },
    }, sales.token);
    expectStatus(publicRma, 403, 'sales public-customer RMA denied');
    recordStep({ step: 'verify-rma-customer-scope', result: 'passed', ownRmaId: ownRma.json.data.id });

    const ownSample = await apiFetch('/samples', {
      method: 'POST',
      data: {
        customerId: Number(ownedCustomer.id),
        productName: DATA.productName,
        quantity: 1,
        unit: 'kg',
        shippingAddress: `XMOD Sample Address ${RUN_ID}`,
      },
    }, sales.token);
    if (!ownSample.ok || !ownSample.json?.data?.id) {
      throw new Error(`Sales should create own-customer sample: ${ownSample.status} ${JSON.stringify(ownSample.json)}`);
    }
    const publicSample = await apiFetch('/samples', {
      method: 'POST',
      data: {
        customerId: Number(publicCustomer.id),
        productName: DATA.productName,
        quantity: 1,
        unit: 'kg',
      },
    }, sales.token);
    expectStatus(publicSample, 403, 'sales public-customer sample denied');

    const managerSample = await apiFetch('/samples', {
      method: 'POST',
      data: {
        customerId: Number(publicCustomer.id),
        productName: `${DATA.productName}-MANAGER`,
        quantity: 1,
        unit: 'kg',
      },
    }, manager.token);
    if (!managerSample.ok || !managerSample.json?.data?.id) {
      throw new Error(`Manager sample create failed: ${managerSample.status} ${JSON.stringify(managerSample.json)}`);
    }
    const deniedSampleStatus = await apiFetch(`/samples/${managerSample.json.data.id}/status`, {
      method: 'PATCH',
      data: { status: 'sent', trackingNo: `XMOD-TRACK-${RUN_ID}` },
    }, sales.token);
    expectStatus(deniedSampleStatus, 403, 'sales manager-sample status update denied');
    recordStep({
      step: 'verify-sample-customer-and-owner-scope',
      result: 'passed',
      ownSampleId: ownSample.json.data.id,
      managerSampleId: managerSample.json.data.id,
    });

    const ownContract = await apiFetch('/contracts', {
      method: 'POST',
      data: {
        customerId: Number(ownedCustomer.id),
        title: DATA.contractTitle,
        type: 'sales',
        totalAmount: 1000,
        currency: 'CNY',
        notes: `owned contract ${RUN_ID}`,
      },
    }, sales.token);
    if (!ownContract.ok || !ownContract.json?.data?.id) {
      throw new Error(`Sales should create own-customer contract: ${ownContract.status} ${JSON.stringify(ownContract.json)}`);
    }
    const publicContractDenied = await apiFetch('/contracts', {
      method: 'POST',
      data: {
        customerId: Number(publicCustomer.id),
        title: `${DATA.contractTitle}-PUBLIC-DENY`,
        type: 'sales',
        totalAmount: 1000,
        currency: 'CNY',
      },
    }, sales.token);
    expectStatus(publicContractDenied, 403, 'sales public-customer contract denied');

    const managerContract = await apiFetch('/contracts', {
      method: 'POST',
      data: {
        customerId: Number(publicCustomer.id),
        title: `${DATA.contractTitle}-MANAGER`,
        type: 'sales',
        totalAmount: 1000,
        currency: 'CNY',
      },
    }, manager.token);
    if (!managerContract.ok || !managerContract.json?.data?.id) {
      throw new Error(`Manager contract create failed: ${managerContract.status} ${JSON.stringify(managerContract.json)}`);
    }

    const deniedContractDetail = await apiFetch(`/contracts/${managerContract.json.data.id}`, {}, sales.token);
    expectStatus(deniedContractDetail, 404, 'sales manager public-contract detail hidden');
    const deniedContractUpdate = await apiFetch(`/contracts/${managerContract.json.data.id}`, {
      method: 'PATCH',
      data: { notes: `sales should not update manager public contract ${RUN_ID}` },
    }, sales.token);
    expectStatus(deniedContractUpdate, 403, 'sales manager public-contract update denied');
    const deniedContractAppend = await apiFetch(`/contracts/${managerContract.json.data.id}/items/append`, {
      method: 'POST',
      data: { note: `sales should not append manager public contract ${RUN_ID}` },
    }, sales.token);
    expectStatus(deniedContractAppend, 403, 'sales manager public-contract append denied');
    recordStep({
      step: 'verify-contract-customer-and-owner-scope',
      result: 'passed',
      ownContractId: ownContract.json.data.id,
      managerContractId: managerContract.json.data.id,
    });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'Cross-module permission audit failed');
    process.exit(1);
  }

  console.log(`Cross-module permission audit passed. Report: ${REPORT_PATH}`);
}

run();
