const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const API_URL = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'masterdata-search-readback-api-audit-v1.json');
const MD_REPORT_PATH = path.join(OUTPUT_DIR, 'masterdata-search-readback-api-audit-v1.md');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  customer: {
    nameZh: `爱劳达审计客户-${RUN_ID}`,
    nameEn: `AilaoDa Audit Customer ${RUN_ID}`,
    nameVi: `Khach hang kiem thu Ai Lao Da ${RUN_ID}`,
    alias: `ALD-CUS-ALIAS-${RUN_ID}`,
    contact: `客户联系人-${RUN_ID.slice(-4)}`,
    phone: `091${RUN_ID.slice(-7)}`,
    email: `customer-${RUN_ID}@audit.local`,
    legalAddress: `越南平阳化工园客户法定地址 ${RUN_ID}`,
  },
  supplier: {
    nameZh: `爱劳达审计供应商-${RUN_ID}`,
    nameEn: `AilaoDa Audit Supplier ${RUN_ID}`,
    nameVi: `Nha cung cap kiem thu Ai Lao Da ${RUN_ID}`,
    alias: `ALD-SUP-ALIAS-${RUN_ID}`,
    contact: `供应商联系人-${RUN_ID.slice(-4)}`,
    phone: `092${RUN_ID.slice(-7)}`,
    email: `supplier-${RUN_ID}@audit.local`,
    legalAddress: `越南同奈化工原料供应商法定地址 ${RUN_ID}`,
  },
};

const report = {
  name: 'Masterdata Search Readback API Audit',
  version: '1.0',
  appUrl: APP_URL,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  mode: 'write-audit-records',
  destructiveActionsPerformed: 0,
  data: DATA,
  steps: [],
  findings: [],
  status: 'running',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function addFinding(priority, title, detail, evidence = {}) {
  report.findings.push({ priority, title, detail, evidence });
}

async function withTimeout(name, timeoutMs, fn) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs)),
    ]);
    recordStep({ name, status: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({ name, status: 'failed', durationMs: Date.now() - started, timeoutMs, error: String(error.message || error) });
    throw error;
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function must(condition, message, evidence = {}) {
  if (!condition) {
    const error = new Error(message);
    error.evidence = evidence;
    throw error;
  }
}

function includesAnyName(row, names) {
  const values = [
    row.name,
    row.nameZh,
    row.nameEn,
    row.nameVi,
    row.customerDisplayName,
    row.supplierDisplayName,
  ].map(value => String(value || ''));
  return names.some(name => values.includes(name) || values.some(value => value.includes(name)));
}

function findByNames(rows, names) {
  return rows.find(row => includesAnyName(row, names));
}

async function login() {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: 'admin', password: 'admin123' },
  });
  must(response.ok && response.json?.data?.token, `login failed: ${response.status}`, response.json);
  return response.json.data.token;
}

async function createCustomer(token) {
  const payload = {
    nameZh: DATA.customer.nameZh,
    nameEn: DATA.customer.nameEn,
    nameVi: DATA.customer.nameVi,
    nameAliases: [DATA.customer.alias],
    licenseNumber: `CUS-LIC-${RUN_ID}`,
    creditLimit: 100000,
    riskLevel: 'low',
    segment: 'mixed',
    poolState: 'internal',
    contactName: DATA.customer.contact,
    contactPhone: DATA.customer.phone,
    contactEmail: DATA.customer.email,
    addresses: [{
      type: 'legal',
      label: '法定地址',
      countryCode: 'VN',
      city: 'Binh Duong',
      fullAddress: DATA.customer.legalAddress,
      isPrimary: true,
    }],
    contacts: [{
      name: DATA.customer.contact,
      role: '采购负责人',
      phone: DATA.customer.phone,
      email: DATA.customer.email,
      language: 'zh',
      isPrimary: true,
    }],
    notes: `masterdata-search-readback-api-audit ${RUN_ID}`,
  };
  const response = await apiFetch('/customers', { method: 'POST', data: payload }, token);
  must(response.ok && response.json?.data?.id, `customer create failed: ${response.status}`, response.json);
  return response.json.data;
}

async function createSupplier(token) {
  const payload = {
    name: DATA.supplier.nameZh,
    nameZh: DATA.supplier.nameZh,
    nameEn: DATA.supplier.nameEn,
    nameVi: DATA.supplier.nameVi,
    nameAliases: [DATA.supplier.alias],
    category: '化工原料',
    rating: 4.5,
    leadTimeDays: 9,
    riskLevel: 'medium',
    status: 'active',
    contact: DATA.supplier.contact,
    contacts: [{
      name: DATA.supplier.contact,
      role: '销售负责人',
      phone: DATA.supplier.phone,
      email: DATA.supplier.email,
      language: 'zh',
      isPrimary: true,
    }],
    addresses: [{
      type: 'legal',
      label: '法定地址',
      countryCode: 'VN',
      city: 'Dong Nai',
      fullAddress: DATA.supplier.legalAddress,
      isPrimary: true,
    }],
  };
  const response = await apiFetch('/procurement/suppliers', { method: 'POST', data: payload }, token);
  must(response.ok && response.json?.data?.id, `supplier create failed: ${response.status}`, response.json);
  return response.json.data;
}

async function searchCustomers(token, keyword) {
  const response = await apiFetch(`/customers?pageSize=50&search=${encodeURIComponent(keyword)}`, {}, token);
  must(response.ok, `customer search failed for ${keyword}: ${response.status}`, response.json);
  return unwrapList(response);
}

async function verifyCustomerPagination(token) {
  const response = await apiFetch('/customers?page=1&pageSize=5&viewMode=my', {}, token);
  must(response.ok, `customer pagination failed: ${response.status}`, response.json);
  must(Number(response.json?.meta?.page) === 1, 'customer pagination page meta mismatch', response.json);
  must(Number(response.json?.meta?.pageSize) === 5, 'customer pagination pageSize meta mismatch', response.json);
  must(Number(response.json?.meta?.total) >= 0, 'customer pagination total meta missing', response.json);
  must(Array.isArray(response.json?.data) && response.json.data.length <= 5, 'customer pagination returned too many rows', response.json);
}

async function searchSuppliers(token, keyword) {
  const response = await apiFetch(`/procurement/suppliers?pageSize=50&search=${encodeURIComponent(keyword)}`, {}, token);
  must(response.ok, `supplier search failed for ${keyword}: ${response.status}`, response.json);
  return unwrapList(response);
}

async function getCustomer(token, id) {
  const response = await apiFetch(`/customers/${id}`, {}, token);
  must(response.ok && response.json?.data?.id, `customer detail failed: ${response.status}`, response.json);
  return response.json.data;
}

async function main() {
  try {
    const token = await withTimeout('login', 15000, login);
    const customer = await withTimeout('create-customer', 20000, () => createCustomer(token));
    report.created = {
      customerId: String(customer.id),
      supplierId: null,
    };
    const supplier = await withTimeout('create-supplier', 20000, () => createSupplier(token));
    report.created = {
      customerId: String(customer.id),
      supplierId: String(supplier.id),
    };

    const customerDetail = await withTimeout('customer-detail-readback', 15000, () => getCustomer(token, customer.id));
    must(customerDetail.nameZh === DATA.customer.nameZh, 'customer zh name did not read back', customerDetail);
    must(customerDetail.nameEn === DATA.customer.nameEn, 'customer en name did not read back', customerDetail);
    must(customerDetail.nameVi === DATA.customer.nameVi, 'customer vi name did not read back', customerDetail);
    must(Array.isArray(customerDetail.contacts) && customerDetail.contacts.some(item => item.name === DATA.customer.contact), 'customer contact did not read back', customerDetail);
    must(Array.isArray(customerDetail.addresses) && customerDetail.addresses.some(item => String(item.fullAddress || '').includes(DATA.customer.legalAddress)), 'customer address did not read back', customerDetail);

    const customerSearchKeys = [
      DATA.customer.nameZh,
      DATA.customer.nameEn,
      DATA.customer.nameVi,
      DATA.customer.alias,
      DATA.customer.contact,
      DATA.customer.phone,
      DATA.customer.email,
      DATA.customer.legalAddress,
    ];
    for (const key of customerSearchKeys) {
      const rows = await withTimeout(`customer-search-${key.slice(0, 24)}`, 15000, () => searchCustomers(token, key));
      must(Boolean(findByNames(rows, [DATA.customer.nameZh, DATA.customer.nameEn, DATA.customer.nameVi])), `customer not found by ${key}`, { key, rows: rows.slice(0, 3) });
    }
    await withTimeout('customer-pagination-meta', 15000, () => verifyCustomerPagination(token));

    const supplierSearchKeys = [
      DATA.supplier.nameZh,
      DATA.supplier.nameEn,
      DATA.supplier.nameVi,
      DATA.supplier.alias,
      DATA.supplier.contact,
      DATA.supplier.phone,
      DATA.supplier.email,
      DATA.supplier.legalAddress,
    ];
    for (const key of supplierSearchKeys) {
      const rows = await withTimeout(`supplier-search-${key.slice(0, 24)}`, 15000, () => searchSuppliers(token, key));
      must(Boolean(findByNames(rows, [DATA.supplier.nameZh, DATA.supplier.nameEn, DATA.supplier.nameVi])), `supplier not found by ${key}`, { key, rows: rows.slice(0, 3) });
    }

    const customerEndpointRowsForSupplier = await withTimeout('customer-endpoint-does-not-return-supplier', 15000, () => searchCustomers(token, DATA.supplier.nameZh));
    must(!findByNames(customerEndpointRowsForSupplier, [DATA.supplier.nameZh, DATA.supplier.nameEn, DATA.supplier.nameVi]), 'supplier leaked into customer search endpoint', customerEndpointRowsForSupplier.slice(0, 3));

    const supplierEndpointRowsForCustomer = await withTimeout('supplier-endpoint-does-not-return-customer', 15000, () => searchSuppliers(token, DATA.customer.nameZh));
    must(!findByNames(supplierEndpointRowsForCustomer, [DATA.customer.nameZh, DATA.customer.nameEn, DATA.customer.nameVi]), 'customer leaked into supplier search endpoint', supplierEndpointRowsForCustomer.slice(0, 3));

    report.status = 'passed';
  } catch (error) {
    addFinding('P1', 'masterdata-search-readback-failed', String(error.message || error), error.evidence || {});
    report.status = 'failed';
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.summary = {
      status: report.status,
      steps: report.steps.length,
      findings: report.findings.length,
      destructiveActionsPerformed: report.destructiveActionsPerformed,
      created: report.created || null,
    };
    ensureDir(OUTPUT_DIR);
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(MD_REPORT_PATH, buildMarkdown(report), 'utf8');
    console.log(JSON.stringify({
      status: report.status,
      summary: report.summary,
      reports: { json: REPORT_PATH, markdown: MD_REPORT_PATH },
    }, null, 2));
  }
}

function buildMarkdown(data) {
  const lines = [
    '# Masterdata Search Readback API Audit v1',
    '',
    `- status: ${data.status}`,
    `- appUrl: ${data.appUrl}`,
    `- runId: ${data.runId}`,
    `- destructiveActionsPerformed: ${data.destructiveActionsPerformed}`,
    '',
    '## Scope',
    '',
    '- Customer and supplier master data must remain separated.',
    '- Each entity must support Chinese, English, Vietnamese names, alias search, contact search, and readback.',
    '- Supplier search must not return customers; customer search must not return suppliers.',
    '',
    '## Evidence',
    '',
    `- customerId: ${data.created?.customerId || 'not-created'}`,
    `- supplierId: ${data.created?.supplierId || 'not-created'}`,
    `- steps: ${data.steps.length}`,
    `- findings: ${data.findings.length}`,
    '',
  ];
  if (data.findings.length) {
    lines.push('## Findings');
    lines.push('');
    lines.push('| Priority | Title | Detail |');
    lines.push('| --- | --- | --- |');
    for (const finding of data.findings) {
      lines.push(`| ${finding.priority} | ${finding.title} | ${String(finding.detail).replace(/\|/g, '/')} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

main();
