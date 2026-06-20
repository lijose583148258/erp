/**
 * 订单 API 全链路审计（纯 fetch，不依赖浏览器）
 * 链路：login → 获取客户 → 创建订单 → 回读 → 确认 → 回读验证
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'orders-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  customerName: `ORD-API-CUST-${RUN_ID}`,
  publicCustomerName: `ORD-API-PUBLIC-${RUN_ID}`,
  productName: `ORD-API-PROD-${RUN_ID}`,
  specification: 'API-AUDIT',
  quantity: 7,
  unit: '件',
  unitPrice: 450,
  paymentTerms: 30,
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
    throw new Error(`登录失败 (${username}): ${response.status}`);
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

async function run() {
  try {
    // 步骤 1：双角色登录
    const sales = await login('sales', 'sales123');
    const manager = await login('manager', 'manager123');
    recordStep({
      step: 'login-users',
      result: 'passed',
      salesId: sales.user.id,
      managerId: manager.user.id,
    });

    // 步骤 2：创建销售本人私海客户，避免误拿公海客户造成假绿或假失败
    const customer = await createCustomer(sales.token, {
      name: DATA.customerName,
      nameZh: DATA.customerName,
      nameEn: `Order API Customer ${RUN_ID}`,
      nameVi: `Khach hang don hang ${RUN_ID}`,
      licenseNumber: `LIC-ORD-${RUN_ID}`,
      creditLimit: 50000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: 'Order API Contact',
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `orders-api-${RUN_ID}@example.com`,
      addresses: [{
        type: 'legal',
        label: '注册地址',
        countryCode: 'VN',
        fullAddress: `Order API Address ${RUN_ID}`,
        isPrimary: true,
      }],
    });
    report.customer = {
      id: String(customer.id),
      name: customer.nameZh || customer.nameEn || customer.name,
    };
    recordStep({ step: 'create-owned-private-customer', result: 'passed', customerId: customer.id });

    // 步骤 2.5：确认销售不能跳过客户池规则，直接给公海客户下订单
    const publicCustomer = await createCustomer(manager.token, {
      name: DATA.publicCustomerName,
      nameZh: DATA.publicCustomerName,
      nameEn: `Public Order API Customer ${RUN_ID}`,
      nameVi: `Khach cong don hang ${RUN_ID}`,
      licenseNumber: `LIC-ORD-PUB-${RUN_ID}`,
      creditLimit: 50000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'public',
      contactName: 'Public Order API Contact',
      contactPhone: `08${RUN_ID.slice(-8)}`,
      contactEmail: `orders-api-public-${RUN_ID}@example.com`,
    });
    const deniedPublicOrder = await apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(publicCustomer.id),
        items: [{
          productName: `${DATA.productName}-PUBLIC-DENY`,
          quantity: 1,
          unit: DATA.unit,
          unitPrice: DATA.unitPrice,
        }],
        paymentTerms: DATA.paymentTerms,
      },
    }, sales.token);
    if (deniedPublicOrder.status !== 403) {
      throw new Error(`销售给公海客户直接下单应为 403，实际 ${deniedPublicOrder.status}`);
    }
    recordStep({ step: 'verify-sales-cannot-order-public-customer', result: 'passed', status: deniedPublicOrder.status });

    // 步骤 3：创建订单
    const createOrder = await apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [{
          productName: DATA.productName,
          specification: DATA.specification,
          quantity: DATA.quantity,
          unit: DATA.unit,
          unitPrice: DATA.unitPrice,
        }],
        paymentTerms: DATA.paymentTerms,
        notes: `订单 API 审计 ${RUN_ID}`,
      },
    }, sales.token);
    if (!createOrder.ok) {
      throw new Error(`创建订单失败: ${createOrder.status}`);
    }
    const order = createOrder.json?.data;
    if (!order?.id) {
      throw new Error('创建订单返回空 ID');
    }
    report.order = {
      id: String(order.id),
      orderNo: order.orderNo,
      status: order.status,
    };
    recordStep({ step: 'create-order', result: 'passed', orderId: order.id, orderNo: order.orderNo });

    // 步骤 3.5：经理订单不能被销售跨人修改或代录回款
    const managerOrderCreate = await apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(publicCustomer.id),
        items: [{
          productName: `${DATA.productName}-MANAGER`,
          quantity: 1,
          unit: DATA.unit,
          unitPrice: DATA.unitPrice,
        }],
        paymentTerms: DATA.paymentTerms,
        notes: `经理订单权限审计 ${RUN_ID}`,
      },
    }, manager.token);
    if (!managerOrderCreate.ok || !managerOrderCreate.json?.data?.id) {
      throw new Error(`经理创建订单失败: ${managerOrderCreate.status}`);
    }
    const managerOrder = managerOrderCreate.json.data;
    const deniedSalesUpdate = await apiFetch(`/orders/${managerOrder.id}`, {
      method: 'PUT',
      data: { notes: `sales should not update manager order ${RUN_ID}` },
    }, sales.token);
    if (deniedSalesUpdate.status !== 403) {
      throw new Error(`销售跨人修改订单应为 403，实际 ${deniedSalesUpdate.status}`);
    }
    const deniedSalesPayment = await apiFetch(`/orders/${managerOrder.id}/payment`, {
      method: 'POST',
      data: { amount: 1, method: 'cash', note: `sales should not pay manager order ${RUN_ID}` },
    }, sales.token);
    if (deniedSalesPayment.status !== 403) {
      throw new Error(`销售跨人录入回款应为 403，实际 ${deniedSalesPayment.status}`);
    }
    recordStep({
      step: 'verify-sales-cannot-touch-manager-order',
      result: 'passed',
      managerOrderId: managerOrder.id,
      updateStatus: deniedSalesUpdate.status,
      paymentStatus: deniedSalesPayment.status,
    });

    // 步骤 4：回读验证订单存在
    const readback = await apiFetch(`/orders/${order.id}`, {}, sales.token);
    if (!readback.ok) {
      throw new Error(`订单回读失败: ${readback.status}`);
    }
    const readbackOrder = readback.json?.data;
    if (!readbackOrder) {
      throw new Error('订单回读返回空数据');
    }
    const items = readbackOrder.items || [];
    const matchingItem = items.find((item) => item.productName === DATA.productName);
    if (!matchingItem) {
      throw new Error(`回读的订单中未找到产品 ${DATA.productName}`);
    }
    recordStep({
      step: 'verify-order-readback',
      result: 'passed',
      orderId: order.id,
      foundProduct: matchingItem.productName,
    });

    // 步骤 5：确认订单（manager 角色）
    const confirmOrder = await apiFetch(`/orders/${order.id}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
    }, manager.token);
    if (!confirmOrder.ok) {
      throw new Error(`确认订单失败: ${confirmOrder.status}`);
    }
    recordStep({ step: 'confirm-order', result: 'passed', orderId: order.id });

    // 步骤 6：验证状态变更
    const finalReadback = await apiFetch(`/orders/${order.id}`, {}, manager.token);
    if (!finalReadback.ok) {
      throw new Error(`最终回读失败: ${finalReadback.status}`);
    }
    const finalOrder = finalReadback.json?.data;
    if (String(finalOrder?.status) !== 'confirmed') {
      throw new Error(`期望 confirmed，实际 ${finalOrder?.status}`);
    }
    report.order.status = finalOrder.status;
    recordStep({
      step: 'verify-confirmed-status',
      result: 'passed',
      orderId: order.id,
      status: finalOrder.status,
    });

    // 步骤 7：订单统计验证
    const stats = await apiFetch('/orders/stats', {}, manager.token);
    if (!stats.ok) {
      throw new Error(`订单统计获取失败: ${stats.status}`);
    }
    recordStep({ step: 'verify-order-stats', result: 'passed' });

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
    console.error(report.error || '订单 API 审计失败');
    process.exit(1);
  }

  console.log(`Orders API audit passed. Report: ${REPORT_PATH}`);
}

run();
