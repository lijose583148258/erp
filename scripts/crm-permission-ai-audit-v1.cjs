/**
 * CRM 权限与 AI 数据隔离审计（纯 fetch，不依赖浏览器）
 * 链路：login → 创建私海/公海/内部池客户 → 销售视角回读 → 敏感子接口 → 导出隔离
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

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
    throw new Error(`登录失败 (${username}): ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function createCustomer(token, data) {
  const response = await apiFetch('/customers', { method: 'POST', data }, token);
  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`客户创建失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function createTeamMember(token, data) {
  const response = await apiFetch('/team', { method: 'POST', data }, token);
  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`团队成员创建失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function searchCustomers(token, search) {
  const response = await apiFetch(`/customers?search=${encodeURIComponent(search)}&pageSize=20`, {}, token);
  if (!response.ok) {
    throw new Error(`客户搜索失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return unwrapList(response);
}

function workbookNames(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName] || {}, { defval: '' });
  return rows.map((row) => String(row['客户名称'] || row['中文名称'] || row.name || '').trim()).filter(Boolean);
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
      throw new Error(`销售用户业务线异常，期望 direct，实际 ${sales.user.segment}`);
    }
    if (channelSales.user.segment !== 'channel') {
      throw new Error(`分销销售用户业务线异常，期望 channel，实际 ${channelSales.user.segment}`);
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
      throw new Error('销售未能回读自己创建的私海客户');
    }
    if (!listContains(publicSearch, DATA.publicCustomerName)) {
      throw new Error('销售未能看到同业务线公海客户');
    }
    if (!listContains(mixedAssignedSearch, DATA.mixedAssignedCustomerName)) {
      throw new Error('销售未能看到已分配给自己的 mixed 私海客户');
    }
    if (listContains(internalSearch, DATA.internalCustomerName)) {
      throw new Error('销售不应在列表中看到内部池客户');
    }
    if (listContains(channelPublicSearchFromDirect, DATA.channelCustomerName)) {
      throw new Error('内销销售不应看到分销公海客户');
    }
    if (listContains(channelPrivateSearchFromDirect, DATA.channelPrivateCustomerName)) {
      throw new Error('内销销售不应看到分销私海客户');
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
      throw new Error('分销销售未能看到分销公海客户');
    }
    if (!listContains(channelPrivateSearch, DATA.channelPrivateCustomerName)) {
      throw new Error('分销销售未能看到自己的分销私海客户');
    }
    if (listContains(directPublicSearchFromChannel, DATA.publicCustomerName)) {
      throw new Error('分销销售不应看到内销公海客户');
    }
    if (listContains(directPrivateSearchFromChannel, DATA.ownedCustomerName)) {
      throw new Error('分销销售不应看到内销私海客户');
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
      throw new Error(`销售访问内部池详情应为 404，实际 ${internalDetail.status}`);
    }
    recordStep({ step: 'verify-internal-detail-hidden-from-sales', result: 'passed', status: internalDetail.status });

    const channelPrivateDetailFromDirect = await apiFetch(`/customers/${channelPrivateCustomer.id}`, {}, sales.token);
    if (channelPrivateDetailFromDirect.status !== 404) {
      throw new Error(`内销销售访问分销私海详情应为 404，实际 ${channelPrivateDetailFromDirect.status}`);
    }
    const mixedAssignedDetail = await apiFetch(`/customers/${mixedAssignedCustomer.id}`, {}, sales.token);
    if (!mixedAssignedDetail.ok || displayName(mixedAssignedDetail.json?.data) !== DATA.mixedAssignedCustomerName) {
      throw new Error(`销售访问已分配 mixed 私海详情失败: ${mixedAssignedDetail.status}`);
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
      throw new Error(`财务/仓库不应访问 CRM 客户列表，finance=${financeCustomerList.status}, warehouse=${warehouseCustomerList.status}`);
    }
    if (financeCustomerDetail.status !== 403) {
      throw new Error(`财务不应访问 CRM 客户详情，实际 ${financeCustomerDetail.status}`);
    }
    if (warehouseCustomerExport.status !== 403) {
      throw new Error(`仓库不应导出 CRM 客户，实际 ${warehouseCustomerExport.status}`);
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
      throw new Error(`销售编辑公海客户应为 403，实际 ${publicUpdate.status}`);
    }
    recordStep({ step: 'verify-sales-cannot-edit-public-profile', result: 'passed', status: publicUpdate.status });

    const publicAssets = await apiFetch(`/customers/${publicCustomer.id}/assets`, {}, sales.token);
    if (publicAssets.status !== 403) {
      throw new Error(`销售查看公海客户资产明细应为 403，实际 ${publicAssets.status}`);
    }
    const publicPoolHistory = await apiFetch(`/customers/${publicCustomer.id}/pool-history`, {}, sales.token);
    if (publicPoolHistory.status !== 403) {
      throw new Error(`销售查看公海客户池历史应为 403，实际 ${publicPoolHistory.status}`);
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
      throw new Error(`经理应可查看公海敏感明细，assets=${managerAssets.status}, poolHistory=${managerPoolHistory.status}`);
    }
    recordStep({
      step: 'verify-manager-sensitive-subresources',
      result: 'passed',
      assetsStatus: managerAssets.status,
      poolHistoryStatus: managerPoolHistory.status,
    });

    const salesExport = await apiFetchBuffer('/customers/export', sales.token);
    if (!salesExport.ok) {
      throw new Error(`销售导出失败: ${salesExport.status}`);
    }
    const salesExportNames = workbookNames(salesExport.buffer);
    if (!salesExportNames.includes(DATA.ownedCustomerName)) {
      throw new Error('销售导出应包含自己的私海客户');
    }
    if (!salesExportNames.includes(DATA.mixedAssignedCustomerName)) {
      throw new Error('销售导出应包含已分配给自己的 mixed 私海客户');
    }
    if (
      salesExportNames.includes(DATA.publicCustomerName) ||
      salesExportNames.includes(DATA.internalCustomerName) ||
      salesExportNames.includes(DATA.channelCustomerName) ||
      salesExportNames.includes(DATA.channelPrivateCustomerName)
    ) {
      throw new Error('销售导出不应包含公海、内部池或其他业务线客户');
    }
    recordStep({
      step: 'verify-sales-export-private-only',
      result: 'passed',
      exportedNamesMatched: salesExportNames.filter(name => name.includes(`CRM-AUDIT-`) && name.includes(RUN_ID)),
    });

    const managerExport = await apiFetchBuffer('/customers/export', manager.token);
    if (!managerExport.ok) {
      throw new Error(`经理导出失败: ${managerExport.status}`);
    }
    const managerExportNames = workbookNames(managerExport.buffer);
    if (
      !managerExportNames.includes(DATA.publicCustomerName) ||
      !managerExportNames.includes(DATA.internalCustomerName) ||
      !managerExportNames.includes(DATA.channelCustomerName) ||
      !managerExportNames.includes(DATA.mixedAssignedCustomerName)
    ) {
      throw new Error('经理导出应包含 mixed 管理视角下的公海、内部池、分销和混合客户');
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
    console.error(report.error || 'CRM 权限与 AI 数据隔离审计失败');
    process.exit(1);
  }

  console.log(`CRM permission and AI audit passed. Report: ${REPORT_PATH}`);
}

run();
