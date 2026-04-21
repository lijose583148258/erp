/**
 * Barter permission audit.
 * Covers sales scope for agreements, batches, settlements, and summary.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'barter-permission-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  ownedCustomerName: `BT-PERM-OWN-${RUN_ID}`,
  publicCustomerName: `BT-PERM-PUB-${RUN_ID}`,
  ownedCounterparty: `BT-PERM-OWN-CP-${RUN_ID}`,
  publicCounterparty: `BT-PERM-PUB-CP-${RUN_ID}`,
  productOur: `BT-PERM-GLUE-${RUN_ID}`,
  productTheir: `BT-PERM-BOARD-${RUN_ID}`,
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

function barterItems(suffix) {
  return [
    {
      side: 'counterparty',
      itemName: `${DATA.productTheir}-${suffix}`,
      specification: '600 board audit',
      unit: 'm3',
      quantity: 2,
      unitPrice: 380,
      sourceDocument: `BT-DOC-THEIR-${suffix}`,
    },
    {
      side: 'our',
      itemName: `${DATA.productOur}-${suffix}`,
      specification: 'glue audit',
      unit: 'kg',
      quantity: 4,
      unitPrice: 190,
      sourceDocument: `BT-DOC-OUR-${suffix}`,
    },
  ];
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.json)}`);
  }
}

function unwrapItems(response) {
  const data = response?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
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
      nameEn: `Barter Owned ${RUN_ID}`,
      nameVi: `Khach barter rieng ${RUN_ID}`,
      licenseNumber: `LIC-BT-OWN-${RUN_ID}`,
      creditLimit: 50000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: 'Barter Owned Contact',
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `barter-owned-${RUN_ID}@example.com`,
    });

    const publicCustomer = await createCustomer(manager.token, {
      name: DATA.publicCustomerName,
      nameZh: DATA.publicCustomerName,
      nameEn: `Barter Public ${RUN_ID}`,
      nameVi: `Khach barter cong ${RUN_ID}`,
      licenseNumber: `LIC-BT-PUB-${RUN_ID}`,
      creditLimit: 50000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'public',
      contactName: 'Barter Public Contact',
      contactPhone: `08${RUN_ID.slice(-8)}`,
      contactEmail: `barter-public-${RUN_ID}@example.com`,
    });
    recordStep({
      step: 'create-customers',
      result: 'passed',
      ownedCustomerId: ownedCustomer.id,
      publicCustomerId: publicCustomer.id,
    });

    const ownAgreement = await apiFetch('/barter/agreements', {
      method: 'POST',
      data: {
        counterpartyType: 'customer',
        counterpartyName: DATA.ownedCounterparty,
        customerId: Number(ownedCustomer.id),
        settlementMode: 'barter',
        currency: 'CNY',
        items: barterItems('OWN-AGREE'),
      },
    }, sales.token);
    if (!ownAgreement.ok || !ownAgreement.json?.data?.id) {
      throw new Error(`Sales should create own barter agreement: ${ownAgreement.status} ${JSON.stringify(ownAgreement.json)}`);
    }

    const ownBatch = await apiFetch(`/barter/agreements/${ownAgreement.json.data.id}/batches`, {
      method: 'POST',
      data: {
        items: barterItems('OWN-BATCH'),
        note: `own batch ${RUN_ID}`,
      },
    }, sales.token);
    if (!ownBatch.ok || !ownBatch.json?.data?.id) {
      throw new Error(`Sales should create own agreement batch: ${ownBatch.status} ${JSON.stringify(ownBatch.json)}`);
    }
    recordStep({
      step: 'verify-sales-own-agreement-and-batch',
      result: 'passed',
      agreementId: ownAgreement.json.data.id,
      batchSettlementId: ownBatch.json.data.id,
    });

    const publicAgreementDenied = await apiFetch('/barter/agreements', {
      method: 'POST',
      data: {
        counterpartyType: 'customer',
        counterpartyName: `${DATA.publicCounterparty}-DENY`,
        customerId: Number(publicCustomer.id),
        settlementMode: 'barter',
        currency: 'CNY',
        items: barterItems('PUB-DENY'),
      },
    }, sales.token);
    expectStatus(publicAgreementDenied, 403, 'sales public-customer agreement denied');

    const supplierAgreementDenied = await apiFetch('/barter/agreements', {
      method: 'POST',
      data: {
        counterpartyType: 'supplier',
        counterpartyName: `BT-PERM-SUP-${RUN_ID}`,
        supplierId: 1,
        settlementMode: 'barter',
        currency: 'CNY',
        items: barterItems('SUP-DENY'),
      },
    }, sales.token);
    expectStatus(supplierAgreementDenied, 403, 'sales supplier agreement denied');
    recordStep({
      step: 'verify-sales-barter-create-denials',
      result: 'passed',
      publicAgreementStatus: publicAgreementDenied.status,
      supplierAgreementStatus: supplierAgreementDenied.status,
    });

    const managerAgreement = await apiFetch('/barter/agreements', {
      method: 'POST',
      data: {
        counterpartyType: 'customer',
        counterpartyName: DATA.publicCounterparty,
        customerId: Number(publicCustomer.id),
        settlementMode: 'barter',
        currency: 'CNY',
        items: barterItems('MANAGER-AGREE'),
      },
    }, manager.token);
    if (!managerAgreement.ok || !managerAgreement.json?.data?.id) {
      throw new Error(`Manager public agreement create failed: ${managerAgreement.status} ${JSON.stringify(managerAgreement.json)}`);
    }
    const managerSettlement = await apiFetch('/barter/settlements', {
      method: 'POST',
      data: {
        counterpartyType: 'customer',
        counterpartyName: `${DATA.publicCounterparty}-SETTLEMENT`,
        customerId: Number(publicCustomer.id),
        settlementMode: 'barter',
        currency: 'CNY',
        items: barterItems('MANAGER-SETTLE'),
      },
    }, manager.token);
    if (!managerSettlement.ok || !managerSettlement.json?.data?.id) {
      throw new Error(`Manager public settlement create failed: ${managerSettlement.status} ${JSON.stringify(managerSettlement.json)}`);
    }

    const salesSearchPublicAgreements = await apiFetch(`/barter/agreements?pageSize=20&search=${encodeURIComponent(DATA.publicCounterparty)}`, {}, sales.token);
    if (!salesSearchPublicAgreements.ok) {
      throw new Error(`Sales public agreement search failed: ${salesSearchPublicAgreements.status}`);
    }
    if (unwrapItems(salesSearchPublicAgreements).some((item) => item.counterpartyName === DATA.publicCounterparty)) {
      throw new Error('Sales should not see manager public barter agreement in list');
    }

    const salesPublicAgreementDetail = await apiFetch(`/barter/agreements/${managerAgreement.json.data.id}`, {}, sales.token);
    expectStatus(salesPublicAgreementDetail, 404, 'sales public agreement detail hidden');
    const salesPublicSettlementDetail = await apiFetch(`/barter/settlements/${managerSettlement.json.data.id}`, {}, sales.token);
    expectStatus(salesPublicSettlementDetail, 404, 'sales public settlement detail hidden');
    const salesPublicBatchDenied = await apiFetch(`/barter/agreements/${managerAgreement.json.data.id}/batches`, {
      method: 'POST',
      data: {
        items: barterItems('MANAGER-BATCH-DENY'),
      },
    }, sales.token);
    expectStatus(salesPublicBatchDenied, 404, 'sales public agreement batch hidden');

    const salesSummary = await apiFetch('/barter/summary', {}, sales.token);
    if (!salesSummary.ok) {
      throw new Error(`Sales barter summary failed: ${salesSummary.status}`);
    }
    recordStep({
      step: 'verify-sales-barter-read-scope',
      result: 'passed',
      managerAgreementId: managerAgreement.json.data.id,
      managerSettlementId: managerSettlement.json.data.id,
      publicAgreementDetailStatus: salesPublicAgreementDetail.status,
      publicSettlementDetailStatus: salesPublicSettlementDetail.status,
      publicBatchStatus: salesPublicBatchDenied.status,
      salesSummary: salesSummary.json.data,
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
    console.error(report.error || 'Barter permission audit failed');
    process.exit(1);
  }

  console.log(`Barter permission audit passed. Report: ${REPORT_PATH}`);
}

run();
