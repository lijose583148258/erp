/**
 * CRM permission and AI-data isolation audit using fetch only.
 * Covers login, customer-pool visibility, role read-back, sensitive AI
 * boundaries, and export isolation.
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'crm-permission-ai-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  ownedCustomerName: `CRM-AUDIT-PRIVATE-${RUN_ID}`,
  publicCustomerName: `CRM-AUDIT-PUBLIC-${RUN_ID}`,
  internalCustomerName: `CRM-AUDIT-INTERNAL-${RUN_ID}`,
  channelCustomerName: `CRM-AUDIT-CHANNEL-PUBLIC-${RUN_ID}`,
  channelPrivateCustomerName: `CRM-AUDIT-CHANNEL-PRIVATE-${RUN_ID}`,
  mixedAssignedCustomerName: `CRM-AUDIT-MIXED-ASSIGNED-${RUN_ID}`,
  channelUsername: `audit_channel_sales_${RUN_ID}`,
  channelPassword: `Channel${RUN_ID}!`,
  contactPhone: `09${RUN_ID.slice(-8)}`,
  contactEmail: `crm-audit-${RUN_ID}@example.com`,
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
  return { ok: response.ok, status: response.status, json, text };
}

async function apiFetchBuffer(endpoint, token = '') {
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { ok: response.ok, status: response.status, buffer };
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function displayName(row) {
  return row?.nameZh || row?.nameEn || row?.nameVi || row?.name || '';
}

function listContains(rows, name) {
  return rows.some((row) => displayName(row) === name);
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
    throw new Error(`Customer creation failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function createTeamMember(token, data) {
  const response = await apiFetch('/team', { method: 'POST', data }, token);
  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`Team member creation failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function searchCustomers(token, search) {
  const response = await apiFetch(`/customers?search=${encodeURIComponent(search)}&pageSize=20`, {}, token);
  if (!response.ok) {
    throw new Error(`Customer search failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return unwrapList(response);
}

function normalizeExcelValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text || '');
  if (typeof value === 'object' && 'result' in value) return String(value.result || '');
  return String(value);
}

async function workbookNames(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const names = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = normalizeExcelValue(cell.value).trim();
      if (value.includes('CRM-AUDIT-')) names.push(value);
    });
  });
  return names;
}

async function run() {
  try {
    const admin = await login('admin', 'admin123');
    const sales = await login('sales', 'sales123');
    const manager = await login('manager', 'manager123');
    const finance = await login('finance', 'finance123');
    const warehouse = await login('warehouse', 'warehouse123');
    const channelMember = await createTeamMember(admin.token, {
      username: DATA.channelUsername,
      password: DATA.channelPassword,
      email: `${DATA.channelUsername}@example.com`,
      role: 'sales',
      segment: 'channel',
    });
    const channelSales = await login(DATA.channelUsername, DATA.channelPassword);
    recordStep({
      step: 'login-role-matrix-and-create-channel-sales',
      result: 'passed',
      adminUserId: admin.user.id,
      salesUserId: sales.user.id,
      salesSegment: sales.user.segment,
      managerUserId: manager.user.id,
      managerSegment: manager.user.segment,
      financeUserId: finance.user.id,
      warehouseUserId: warehouse.user.id,
      channelUserId: channelSales.user.id,
      channelSegment: channelSales.user.segment,
      channelMemberId: channelMember.id,
    });

    if (sales.user.segment !== 'direct') {
      throw new Error(`Sales user segment mismatch: expected direct, actual ${sales.user.segment}`);
    }
    if (channelSales.user.segment !== 'channel') {
      throw new Error(`Channel sales user segment mismatch: expected channel, actual ${channelSales.user.segment}`);
    }

    const ownedCustomer = await createCustomer(sales.token, {
      nameZh: DATA.ownedCustomerName,
      nameEn: `Private Customer ${RUN_ID}`,
      nameVi: `Khach rieng ${RUN_ID}`,
      licenseNumber: `LIC-PRIV-${RUN_ID}`,
      creditLimit: 50000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: 'Private Contact',
      contactPhone: DATA.contactPhone,
      contactEmail: DATA.contactEmail,
      addresses: [{
        type: 'legal',
        label: '注册地址',
        countryCode: 'VN',
        fullAddress: `Private Audit Address ${RUN_ID}`,
        isPrimary: true,
      }],
    });

    const publicCustomer = await createCustomer(manager.token, {
      nameZh: DATA.publicCustomerName,
      nameEn: `Public Customer ${RUN_ID}`,
      nameVi: `Khach cong ${RUN_ID}`,
      licenseNumber: `LIC-PUB-${RUN_ID}`,
      creditLimit: 90000,
      riskLevel: 'medium',
      segment: 'direct',
      poolState: 'public',
      contactName: 'Public Contact',
      contactPhone: DATA.contactPhone,
      contactEmail: DATA.contactEmail,
      addresses: [{
        type: 'office',
        label: '办公地址',
        countryCode: 'CN',
        fullAddress: `Public Audit Address ${RUN_ID}`,
        isPrimary: true,
      }],
    });

    const internalCustomer = await createCustomer(manager.token, {
      nameZh: DATA.internalCustomerName,
      nameEn: `Internal Customer ${RUN_ID}`,
      nameVi: `Khach noi bo ${RUN_ID}`,
      licenseNumber: `LIC-INT-${RUN_ID}`,
      creditLimit: 120000,
      riskLevel: 'high',
      segment: 'direct',
      poolState: 'internal',
      contactName: 'Internal Contact',
      contactPhone: DATA.contactPhone,
      contactEmail: DATA.contactEmail,
      addresses: [{
        type: 'billing',
        label: '账单地址',
        countryCode: 'US',
        fullAddress: `Internal Audit Address ${RUN_ID}`,
        isPrimary: true,
      }],
    });

    const channelCustomer = await createCustomer(manager.token, {
      nameZh: DATA.channelCustomerName,
      nameEn: `Channel Public Customer ${RUN_ID}`,
      nameVi: `Khach kenh ${RUN_ID}`,
      licenseNumber: `LIC-CH-PUB-${RUN_ID}`,
      creditLimit: 70000,
      riskLevel: 'low',
      segment: 'channel',
      poolState: 'public',
      contactName: 'Channel Public Contact',
      contactPhone: DATA.contactPhone,
      contactEmail: DATA.contactEmail,
      addresses: [{
        type: 'office',
        label: '分销办公地址',
        countryCode: 'VN',
        fullAddress: `Channel Public Audit Address ${RUN_ID}`,
        isPrimary: true,
      }],
    });

    const channelPrivateCustomer = await createCustomer(manager.token, {
      nameZh: DATA.channelPrivateCustomerName,
      nameEn: `Channel Private Customer ${RUN_ID}`,
      nameVi: `Khach rieng kenh ${RUN_ID}`,
      licenseNumber: `LIC-CH-PRI-${RUN_ID}`,
      creditLimit: 75000,
      riskLevel: 'medium',
      segment: 'channel',
      poolState: 'private',
      salespersonId: Number(channelSales.user.id),
      contactName: 'Channel Private Contact',
      contactPhone: DATA.contactPhone,
      contactEmail: DATA.contactEmail,
      addresses: [{
        type: 'legal',
        label: '分销法定地址',
        countryCode: 'VN',
        fullAddress: `Channel Private Audit Address ${RUN_ID}`,
        isPrimary: true,
      }],
    });

    const mixedAssignedCustomer = await createCustomer(manager.token, {
      nameZh: DATA.mixedAssignedCustomerName,
      nameEn: `Mixed Assigned Customer ${RUN_ID}`,
      nameVi: `Khach hon hop ${RUN_ID}`,
      licenseNumber: `LIC-MIX-PRI-${RUN_ID}`,
      creditLimit: 88000,
      riskLevel: 'low',
      segment: 'mixed',
      poolState: 'private',
      salespersonId: Number(sales.user.id),
      contactName: 'Mixed Assigned Contact',
      contactPhone: DATA.contactPhone,
      contactEmail: DATA.contactEmail,
      addresses: [{
        type: 'legal',
        label: '混合法定地址',
        countryCode: 'CN',
        fullAddress: `Mixed Assigned Audit Address ${RUN_ID}`,
        isPrimary: true,
      }],
    });

    report.created = {
      ownedCustomerId: String(ownedCustomer.id),
      publicCustomerId: String(publicCustomer.id),
      internalCustomerId: String(internalCustomer.id),
      channelCustomerId: String(channelCustomer.id),
      channelPrivateCustomerId: String(channelPrivateCustomer.id),
      mixedAssignedCustomerId: String(mixedAssignedCustomer.id),
      channelUserId: String(channelSales.user.id),
    };
    recordStep({ step: 'create-three-pool-customers', result: 'passed', ...report.created });

    const ownedSearch = await searchCustomers(sales.token, DATA.ownedCustomerName);
    const publicSearch = await searchCustomers(sales.token, DATA.publicCustomerName);
    const internalSearch = await searchCustomers(sales.token, DATA.internalCustomerName);
    const channelPublicSearchFromDirect = await searchCustomers(sales.token, DATA.channelCustomerName);
    const channelPrivateSearchFromDirect = await searchCustomers(sales.token, DATA.channelPrivateCustomerName);
    const mixedAssignedSearch = await searchCustomers(sales.token, DATA.mixedAssignedCustomerName);
    if (!listContains(ownedSearch, DATA.ownedCustomerName)) {
      throw new Error('Sales user could not read back its own private-pool customer');
    }
    if (!listContains(publicSearch, DATA.publicCustomerName)) {
      throw new Error('Sales user could not see the same-segment public-pool customer');
    }
    if (!listContains(mixedAssignedSearch, DATA.mixedAssignedCustomerName)) {
      throw new Error('Sales user could not see its assigned mixed private-pool customer');
    }
    if (listContains(internalSearch, DATA.internalCustomerName)) {
      throw new Error('Sales user must not see internal-pool customers in the list');
    }
    if (listContains(channelPublicSearchFromDirect, DATA.channelCustomerName)) {
      throw new Error('Direct sales user must not see channel public-pool customers');
    }
    if (listContains(channelPrivateSearchFromDirect, DATA.channelPrivateCustomerName)) {
      throw new Error('Direct sales user must not see channel private-pool customers');
    }
    recordStep({
      step: 'verify-sales-list-scope',
      result: 'passed',
      ownedVisible: true,
      publicVisible: true,
      mixedAssignedVisible: true,
      internalHidden: true,
      channelPublicHidden: true,
      channelPrivateHidden: true,
    });

    const channelPublicSearch = await searchCustomers(channelSales.token, DATA.channelCustomerName);
    const channelPrivateSearch = await searchCustomers(channelSales.token, DATA.channelPrivateCustomerName);
    const directPublicSearchFromChannel = await searchCustomers(channelSales.token, DATA.publicCustomerName);
    const directPrivateSearchFromChannel = await searchCustomers(channelSales.token, DATA.ownedCustomerName);
    if (!listContains(channelPublicSearch, DATA.channelCustomerName)) {
      throw new Error('Channel sales user could not see channel public-pool customers');
    }
    if (!listContains(channelPrivateSearch, DATA.channelPrivateCustomerName)) {
      throw new Error('Channel sales user could not see its own channel private-pool customers');
    }
    if (listContains(directPublicSearchFromChannel, DATA.publicCustomerName)) {
      throw new Error('Channel sales user must not see direct public-pool customers');
    }
    if (listContains(directPrivateSearchFromChannel, DATA.ownedCustomerName)) {
      throw new Error('Channel sales user must not see direct private-pool customers');
    }
    recordStep({
      step: 'verify-channel-sales-scope',
      result: 'passed',
      channelPublicVisible: true,
      channelPrivateVisible: true,
      directPublicHidden: true,
      directPrivateHidden: true,
    });

    const internalDetail = await apiFetch(`/customers/${internalCustomer.id}`, {}, sales.token);
    if (internalDetail.status !== 404) {
      throw new Error(`Sales access to an internal-pool detail must be 404, actual ${internalDetail.status}`);
    }
    recordStep({ step: 'verify-internal-detail-hidden-from-sales', result: 'passed', status: internalDetail.status });

    const channelPrivateDetailFromDirect = await apiFetch(`/customers/${channelPrivateCustomer.id}`, {}, sales.token);
    if (channelPrivateDetailFromDirect.status !== 404) {
      throw new Error(`Direct sales access to a channel private-pool detail must be 404, actual ${channelPrivateDetailFromDirect.status}`);
    }
    const mixedAssignedDetail = await apiFetch(`/customers/${mixedAssignedCustomer.id}`, {}, sales.token);
    if (!mixedAssignedDetail.ok || displayName(mixedAssignedDetail.json?.data) !== DATA.mixedAssignedCustomerName) {
      throw new Error(`Sales access to the assigned mixed private-pool detail failed: ${mixedAssignedDetail.status}`);
    }
    recordStep({
      step: 'verify-cross-segment-detail-and-mixed-assigned-detail',
      result: 'passed',
      crossSegmentStatus: channelPrivateDetailFromDirect.status,
      mixedAssignedVisible: true,
    });

    const financeCustomerList = await apiFetch('/customers?pageSize=5', {}, finance.token);
    const warehouseCustomerList = await apiFetch('/customers?pageSize=5', {}, warehouse.token);
    const financeCustomerDetail = await apiFetch(`/customers/${ownedCustomer.id}`, {}, finance.token);
    const warehouseCustomerExport = await apiFetchBuffer('/customers/export', warehouse.token);
    if (financeCustomerList.status !== 403 || warehouseCustomerList.status !== 403) {
      throw new Error(`Finance/warehouse must not access the CRM customer list, finance=${financeCustomerList.status}, warehouse=${warehouseCustomerList.status}`);
    }
    if (financeCustomerDetail.status !== 403) {
      throw new Error(`Finance must not access CRM customer detail, actual ${financeCustomerDetail.status}`);
    }
    if (warehouseCustomerExport.status !== 403) {
      throw new Error(`Warehouse must not export CRM customers, actual ${warehouseCustomerExport.status}`);
    }
    recordStep({
      step: 'verify-non-crm-roles-forbidden',
      result: 'passed',
      financeListStatus: financeCustomerList.status,
      warehouseListStatus: warehouseCustomerList.status,
      financeDetailStatus: financeCustomerDetail.status,
      warehouseExportStatus: warehouseCustomerExport.status,
    });

    const publicUpdate = await apiFetch(`/customers/${publicCustomer.id}`, {
      method: 'PUT',
      data: { notes: `sales should not edit public customer ${RUN_ID}` },
    }, sales.token);
    if (publicUpdate.status !== 403) {
      throw new Error(`Sales editing a public-pool customer must be 403, actual ${publicUpdate.status}`);
    }
    recordStep({ step: 'verify-sales-cannot-edit-public-profile', result: 'passed', status: publicUpdate.status });

    const publicAssets = await apiFetch(`/customers/${publicCustomer.id}/assets`, {}, sales.token);
    if (publicAssets.status !== 403) {
      throw new Error(`Sales access to public-pool assets must be 403, actual ${publicAssets.status}`);
    }
    const publicPoolHistory = await apiFetch(`/customers/${publicCustomer.id}/pool-history`, {}, sales.token);
    if (publicPoolHistory.status !== 403) {
      throw new Error(`Sales access to public-pool history must be 403, actual ${publicPoolHistory.status}`);
    }
    recordStep({
      step: 'verify-public-sensitive-subresources-forbidden',
      result: 'passed',
      assetsStatus: publicAssets.status,
      poolHistoryStatus: publicPoolHistory.status,
    });

    const managerAssets = await apiFetch(`/customers/${publicCustomer.id}/assets`, {}, manager.token);
    const managerPoolHistory = await apiFetch(`/customers/${publicCustomer.id}/pool-history`, {}, manager.token);
    if (!managerAssets.ok || !managerPoolHistory.ok) {
      throw new Error(`Manager should access public-pool sensitive details, assets=${managerAssets.status}, poolHistory=${managerPoolHistory.status}`);
    }
    recordStep({
      step: 'verify-manager-sensitive-subresources',
      result: 'passed',
      assetsStatus: managerAssets.status,
      poolHistoryStatus: managerPoolHistory.status,
    });

    const salesExport = await apiFetchBuffer('/customers/export', sales.token);
    if (!salesExport.ok) {
      throw new Error(`Sales export failed: ${salesExport.status}`);
    }
    const salesExportNames = await workbookNames(salesExport.buffer);
    if (!salesExportNames.includes(DATA.ownedCustomerName)) {
      throw new Error('Sales export must include the user-owned private-pool customer');
    }
    if (!salesExportNames.includes(DATA.mixedAssignedCustomerName)) {
      throw new Error('Sales export must include the assigned mixed private-pool customer');
    }
    if (
      salesExportNames.includes(DATA.publicCustomerName) ||
      salesExportNames.includes(DATA.internalCustomerName) ||
      salesExportNames.includes(DATA.channelCustomerName) ||
      salesExportNames.includes(DATA.channelPrivateCustomerName)
    ) {
      throw new Error('Sales export must not include public-pool, internal-pool, or other-segment customers');
    }
    recordStep({
      step: 'verify-sales-export-private-only',
      result: 'passed',
      exportedNamesMatched: salesExportNames.filter(name => name.includes(`CRM-AUDIT-`) && name.includes(RUN_ID)),
    });

    const managerExport = await apiFetchBuffer('/customers/export', manager.token);
    if (!managerExport.ok) {
      throw new Error(`Manager export failed: ${managerExport.status}`);
    }
    const managerExportNames = await workbookNames(managerExport.buffer);
    if (
      !managerExportNames.includes(DATA.publicCustomerName) ||
      !managerExportNames.includes(DATA.internalCustomerName) ||
      !managerExportNames.includes(DATA.channelCustomerName) ||
      !managerExportNames.includes(DATA.mixedAssignedCustomerName)
    ) {
      throw new Error('Manager export must include public, internal, channel, and mixed customers in the manager view');
    }
    recordStep({
      step: 'verify-manager-export-scope',
      result: 'passed',
      publicExported: true,
      internalExported: true,
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
    console.error(report.error || 'CRM permission and AI-data isolation audit failed');
    process.exit(1);
  }

  console.log(`CRM permission and AI audit passed. Report: ${REPORT_PATH}`);
}

run();
