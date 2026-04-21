/**
 * 供应商权限与采购敏感数据审计（纯 fetch，不依赖浏览器）
 * 链路：login → 创建供应商 → 分角色回读 → 搜索反查 → 采购订单权限 → B2B 枚举防护
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'supplier-permission-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  supplierName: `SUP-AUDIT-${RUN_ID}`,
  supplierContact: `Supplier Contact ${RUN_ID.slice(-4)}`,
  supplierPhone: `097${RUN_ID.slice(-7)}`,
  supplierEmail: `supplier-${RUN_ID}@example.com`,
  supplierAddress: `Supplier Sensitive Address ${RUN_ID}`,
  salesCustomerName: `SUP-AUDIT-SALES-CUS-${RUN_ID}`,
  managerCustomerName: `SUP-AUDIT-MGR-CUS-${RUN_ID}`,
  salesOrderItem: `SUP-AUDIT-SALES-ITEM-${RUN_ID}`,
  managerOrderItem: `SUP-AUDIT-MGR-ITEM-${RUN_ID}`,
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

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function assertNoSupplierByName(token, name) {
  if (!name) return;
  const rows = await searchSuppliers(token, name);
  const found = rows.find((row) => String(row.name) === String(name) || String(row.nameZh) === String(name));
  if (found) {
    throw new Error(`非法供应商被写入数据库: ${JSON.stringify(found)}`);
  }
}

async function assertSupplierCreateRejected(token, label, payload, expectedStatus) {
  const response = await apiFetch('/procurement/suppliers', {
    method: 'POST',
    data: payload,
  }, token);
  if (response.status !== expectedStatus) {
    throw new Error(`${label} 期望 HTTP ${expectedStatus}，实际 ${response.status} ${JSON.stringify(response.json)}`);
  }
  await assertNoSupplierByName(token, payload.name || payload.nameZh || payload.nameEn || payload.nameVi);
  return response.status;
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

async function createSupplier(token) {
  const response = await apiFetch('/procurement/suppliers', {
    method: 'POST',
    data: {
      name: DATA.supplierName,
      nameZh: DATA.supplierName,
      nameEn: `Supplier EN ${RUN_ID}`,
      nameVi: `Nha cung cap ${RUN_ID}`,
      nameAliases: [`SUP-ALIAS-${RUN_ID}`],
      category: 'Chemical raw materials',
      rating: 4.5,
      leadTimeDays: 9,
      riskLevel: 'medium',
      contact: DATA.supplierContact,
      status: 'active',
      contacts: [{
        name: DATA.supplierContact,
        phone: DATA.supplierPhone,
        email: DATA.supplierEmail,
        isPrimary: true,
      }],
      addresses: [{
        type: 'legal',
        label: '供应商注册地址',
        countryCode: 'VN',
        city: 'Hanoi',
        fullAddress: DATA.supplierAddress,
        isPrimary: true,
      }],
    },
  }, token);

  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`供应商创建失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function searchSuppliers(token, search) {
  const response = await apiFetch(`/procurement/suppliers?pageSize=50&search=${encodeURIComponent(search)}`, {}, token);
  if (!response.ok) {
    throw new Error(`供应商搜索失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return unwrapList(response);
}

function findSupplier(rows) {
  return rows.find((row) => String(row.name) === DATA.supplierName || String(row.nameZh) === DATA.supplierName);
}

async function createCustomer(token, name, poolState = 'private') {
  const response = await apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: name,
      nameEn: `Customer EN ${RUN_ID}`,
      nameVi: `Khach ${RUN_ID}`,
      licenseNumber: `LIC-${name}`,
      creditLimit: 100000,
      riskLevel: 'low',
      segment: 'direct',
      poolState,
      contactName: `Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `096${RUN_ID.slice(-7)}`,
      contactEmail: `customer-${RUN_ID}@example.com`,
      addresses: [{
        type: 'legal',
        label: '注册地址',
        countryCode: 'VN',
        fullAddress: `Customer Address ${RUN_ID}`,
        isPrimary: true,
      }],
    },
  }, token);
  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`客户创建失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function createSalesOrder(token, customerId, itemName) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName: itemName,
        specification: 'SUP-AUDIT',
        quantity: 2,
        unit: 'kg',
        unitPrice: 360,
      }],
      paymentTerms: 30,
      notes: `供应商权限审计 ${RUN_ID}`,
    },
  }, token);
  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`销售订单创建失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function createPurchaseOrder(token, supplierId, salesOrderId, itemName) {
  const response = await apiFetch('/procurement/orders', {
    method: 'POST',
    data: {
      supplierId: Number(supplierId),
      item: itemName,
      quantity: 6,
      unit: 'kg',
      price: 1280,
      eta: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: 'pending',
      salesOrderId: Number(salesOrderId),
      isB2B: true,
    },
  }, token);
  if (!response.ok || !response.json?.data?.id) {
    throw new Error(`采购订单创建失败: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function run() {
  try {
    const [manager, sales, finance, warehouse] = await Promise.all([
      login('manager', 'manager123'),
      login('sales', 'sales123'),
      login('finance', 'finance123'),
      login('warehouse', 'warehouse123'),
    ]);
    recordStep({
      step: 'login-roles',
      result: 'passed',
      managerRole: manager.user.role,
      salesRole: sales.user.role,
      financeRole: finance.user.role,
      warehouseRole: warehouse.user.role,
    });

    const invalidSupplierBase = {
      name: `SUP-BAD-BASE-${RUN_ID}`,
      nameZh: `供应商坏数据-${RUN_ID}`,
      nameEn: `Bad Supplier ${RUN_ID}`,
      category: 'Chemical raw materials',
      rating: 4,
      leadTimeDays: 7,
      riskLevel: 'medium',
      contact: `Bad Contact ${RUN_ID.slice(-4)}`,
      status: 'active',
      contacts: [{ name: `Bad Contact ${RUN_ID.slice(-4)}`, phone: DATA.supplierPhone }],
      addresses: [{ label: 'bad address', countryCode: 'VN', fullAddress: DATA.supplierAddress }],
    };
    const invalidSupplierStatuses = {
      emptyName: await assertSupplierCreateRejected(manager.token, '空名称供应商', {
        ...invalidSupplierBase,
        name: '',
        nameZh: '',
        nameEn: '',
        nameVi: '',
      }, 400),
      emptyCategory: await assertSupplierCreateRejected(manager.token, '空分类供应商', {
        ...invalidSupplierBase,
        name: `SUP-BAD-CATEGORY-${RUN_ID}`,
        nameZh: `供应商坏分类-${RUN_ID}`,
        category: '',
      }, 400),
      invalidRating: await assertSupplierCreateRejected(manager.token, '非法评级供应商', {
        ...invalidSupplierBase,
        name: `SUP-BAD-RATING-${RUN_ID}`,
        nameZh: `供应商坏评级-${RUN_ID}`,
        rating: 9,
      }, 400),
      invalidLeadTime: await assertSupplierCreateRejected(manager.token, '非法交期供应商', {
        ...invalidSupplierBase,
        name: `SUP-BAD-LEAD-${RUN_ID}`,
        nameZh: `供应商坏交期-${RUN_ID}`,
        leadTimeDays: -1,
      }, 400),
      invalidRiskLevel: await assertSupplierCreateRejected(manager.token, '非法风险等级供应商', {
        ...invalidSupplierBase,
        name: `SUP-BAD-RISK-${RUN_ID}`,
        nameZh: `供应商坏风险-${RUN_ID}`,
        riskLevel: 'critical',
      }, 400),
      invalidStatus: await assertSupplierCreateRejected(manager.token, '非法状态供应商', {
        ...invalidSupplierBase,
        name: `SUP-BAD-STATUS-${RUN_ID}`,
        nameZh: `供应商坏状态-${RUN_ID}`,
        status: 'deleted',
      }, 400),
      invalidContacts: await assertSupplierCreateRejected(manager.token, '非法联系人供应商', {
        ...invalidSupplierBase,
        name: `SUP-BAD-CONTACTS-${RUN_ID}`,
        nameZh: `供应商坏联系人-${RUN_ID}`,
        contacts: ['not-an-object'],
      }, 400),
      invalidAddresses: await assertSupplierCreateRejected(manager.token, '非法地址供应商', {
        ...invalidSupplierBase,
        name: `SUP-BAD-ADDRESS-${RUN_ID}`,
        nameZh: `供应商坏地址-${RUN_ID}`,
        addresses: { label: 'not-array' },
      }, 400),
    };
    recordStep({
      step: 'block-invalid-supplier-create',
      result: 'passed',
      statuses: invalidSupplierStatuses,
    });

    const supplier = await createSupplier(manager.token);
    report.created = { supplierId: String(supplier.id) };
    recordStep({ step: 'create-sensitive-supplier', result: 'passed', supplierId: supplier.id });

    const managerRows = await searchSuppliers(manager.token, DATA.supplierName);
    const managerSupplier = findSupplier(managerRows);
    if (!managerSupplier) throw new Error('经理未能回读供应商');
    if (!managerSupplier.contacts?.length || !managerSupplier.addresses?.length || !managerSupplier.contact) {
      throw new Error('经理视角供应商敏感资料不完整');
    }
    recordStep({ step: 'verify-manager-supplier-full-view', result: 'passed' });

    const salesRows = await searchSuppliers(sales.token, DATA.supplierName);
    const salesSupplier = findSupplier(salesRows);
    if (!salesSupplier) throw new Error('销售应能查询供应商基础名称用于货抵/联想选择');
    if ((salesSupplier.contacts || []).length || (salesSupplier.addresses || []).length || salesSupplier.contact) {
      throw new Error('销售视角不应返回供应商联系人/地址/主联系人');
    }
    recordStep({ step: 'verify-sales-supplier-redacted-view', result: 'passed' });

    const salesPhoneSearch = await searchSuppliers(sales.token, DATA.supplierPhone);
    if (findSupplier(salesPhoneSearch)) {
      throw new Error('销售不应通过供应商电话反查供应商');
    }
    const salesAddressSearch = await searchSuppliers(sales.token, DATA.supplierAddress);
    if (findSupplier(salesAddressSearch)) {
      throw new Error('销售不应通过供应商地址反查供应商');
    }
    recordStep({ step: 'verify-sales-cannot-reverse-search-sensitive-supplier-fields', result: 'passed' });

    const financeRows = await searchSuppliers(finance.token, DATA.supplierPhone);
    const financeSupplier = findSupplier(financeRows);
    if (!financeSupplier || !financeSupplier.contacts?.length) {
      throw new Error('财务应能按供应商敏感资料检索并查看联系人');
    }
    recordStep({ step: 'verify-finance-supplier-sensitive-read', result: 'passed' });

    const salesOrdersList = await apiFetch('/procurement/orders?pageSize=5', {}, sales.token);
    if (salesOrdersList.status !== 403) {
      throw new Error(`销售查看采购订单列表应为 403，实际 ${salesOrdersList.status}`);
    }
    const financeOrdersList = await apiFetch('/procurement/orders?pageSize=5', {}, finance.token);
    if (!financeOrdersList.ok) {
      throw new Error(`财务查看采购订单列表应为 200，实际 ${financeOrdersList.status}`);
    }
    const financeCreateOrder = await apiFetch('/procurement/orders', {
      method: 'POST',
      data: {
        supplierId: Number(supplier.id),
        item: `FINANCE-SHOULD-NOT-CREATE-${RUN_ID}`,
        quantity: 1,
        unit: 'kg',
        price: 1,
        eta: new Date().toISOString().slice(0, 10),
      },
    }, finance.token);
    if (financeCreateOrder.status !== 403) {
      throw new Error(`财务创建采购单应为 403，实际 ${financeCreateOrder.status}`);
    }
    recordStep({
      step: 'verify-procurement-order-role-boundaries',
      result: 'passed',
      salesListStatus: salesOrdersList.status,
      financeListStatus: financeOrdersList.status,
      financeCreateStatus: financeCreateOrder.status,
    });

    const salesCustomer = await createCustomer(sales.token, DATA.salesCustomerName, 'private');
    const salesOrder = await createSalesOrder(sales.token, salesCustomer.id, DATA.salesOrderItem);
    const managerCustomer = await createCustomer(manager.token, DATA.managerCustomerName, 'internal');
    const managerOrder = await createSalesOrder(manager.token, managerCustomer.id, DATA.managerOrderItem);
    const salesLinkedPO = await createPurchaseOrder(warehouse.token, supplier.id, salesOrder.id, `PO-LINK-SALES-${RUN_ID}`);
    const managerLinkedPO = await createPurchaseOrder(warehouse.token, supplier.id, managerOrder.id, `PO-LINK-MGR-${RUN_ID}`);
    report.created = {
      ...report.created,
      salesCustomerId: String(salesCustomer.id),
      salesOrderId: String(salesOrder.id),
      managerCustomerId: String(managerCustomer.id),
      managerOrderId: String(managerOrder.id),
      salesLinkedPurchaseOrderId: String(salesLinkedPO.id),
      managerLinkedPurchaseOrderId: String(managerLinkedPO.id),
    };
    recordStep({ step: 'create-b2b-linked-orders', result: 'passed', ...report.created });

    const ownB2B = await apiFetch(`/procurement/b2b-status/${salesOrder.id}`, {}, sales.token);
    if (!ownB2B.ok || !ownB2B.json?.data?.linked) {
      throw new Error(`销售查看自己订单 B2B 状态应成功，实际 ${ownB2B.status} ${JSON.stringify(ownB2B.json)}`);
    }

    const foreignB2B = await apiFetch(`/procurement/b2b-status/${managerOrder.id}`, {}, sales.token);
    if (foreignB2B.status !== 404) {
      throw new Error(`销售枚举他人订单 B2B 状态应为 404，实际 ${foreignB2B.status}`);
    }
    recordStep({
      step: 'verify-sales-b2b-status-owner-scope',
      result: 'passed',
      ownStatus: ownB2B.status,
      ownLinked: Boolean(ownB2B.json?.data?.linked),
      foreignStatus: foreignB2B.status,
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
    console.error(report.error || '供应商权限审计失败');
    process.exit(1);
  }

  console.log(`Supplier permission API audit passed. Report: ${REPORT_PATH}`);
}

run();
