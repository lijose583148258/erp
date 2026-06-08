const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'shipping-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  shipmentProduct: `SHIP-API-LINK-${RUN_ID}`,
  customerName: `SHIP-API-CUS-${RUN_ID}`,
  batchNo: `SHIP-BATCH-${RUN_ID}`,
  stockQuantity: 20,
  shipmentQuantity: 8,
  directReceiptProduct: `SHIP-DIRECT-RECEIPT-${RUN_ID}`,
  directReceiptBatchNo: `SHIP-DIRECT-BATCH-${RUN_ID}`,
  directReceiptStockQuantity: 10,
  directReceiptQuantity: 4,
  trackingNo: `SHIP-API-${RUN_ID}`,
  carrier: `AUDIT-CARRIER-${RUN_ID.slice(-4)}`,
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

function readReceiptShipmentStatus(responseJson) {
  return responseJson?.data?.shipment?.status || responseJson?.data?.status || null;
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

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  if (!response.ok) {
    throw new Error(`login failed for ${username}: ${response.status}`);
  }
  return response.json.data;
}

async function createAuditCustomer(token) {
  const response = await apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Shipping Customer ${RUN_ID}`,
      nameVi: `Khach Giao Hang ${RUN_ID}`,
      licenseNumber: `SHIP-LIC-${RUN_ID}`,
      creditLimit: 100000000,
      riskLevel: 'low',
      segment: 'mixed',
      poolState: 'private',
      contactName: `Ship Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `ship-customer-${RUN_ID}@example.com`,
      addresses: [{
        id: `ship-addr-${RUN_ID}`,
        type: 'shipping',
        label: '发货地址',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Audit Shipping Address, Ho Chi Minh City',
        isPrimary: true,
      }],
      contacts: [{
        name: `Ship Contact ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        email: `ship-customer-${RUN_ID}@example.com`,
        language: 'zh',
        isPrimary: true,
      }],
      notes: `发货 API 审计专用客户 ${RUN_ID}`,
    },
  }, token);

  if (!response.ok) {
    throw new Error(`create audit customer failed: ${response.status} — ${JSON.stringify(response.json)}`);
  }
  const customer = response.json?.data;
  if (!customer?.id) throw new Error('create audit customer returned empty id');
  return customer;
}

async function resolveLocation(token, locationCode) {
  const response = await apiFetch('/warehouses', {}, token);
  if (!response.ok) throw new Error(`warehouse list failed: ${response.status}`);
  const warehouses = unwrapList(response);
  for (const warehouse of warehouses) {
    const locations = Array.isArray(warehouse.locations) ? warehouse.locations : [];
    const location = locations.find((item) => String(item.code) === locationCode);
    if (location) return location;
  }
  throw new Error(`location ${locationCode} not found`);
}

async function seedFinishedGoodsStock(token, productName = DATA.shipmentProduct, batchNo = DATA.batchNo, quantity = DATA.stockQuantity) {
  const location = await resolveLocation(token, 'LOC-FG');
  const response = await apiFetch('/warehouses/stock-balances', {
    method: 'POST',
    data: {
      locationId: Number(location.id),
      productName,
      batchNo,
      quantity,
      unit: '件',
      sourceRef: `SHIPPING-API-STOCK-SEED-${RUN_ID}-${batchNo}`,
      reason: 'shipping_api_audit_seed',
      note: `Shipping API audit seed ${RUN_ID}`,
    },
  }, token);
  if (!response.ok) {
    throw new Error(`seed finished goods stock failed: ${response.status} — ${JSON.stringify(response.json)}`);
  }
  return { location, balance: response.json?.data };
}

async function verifyShippingIssue(
  token,
  shipmentNo,
  expectedRemainingQuantity,
  productName = DATA.shipmentProduct,
  batchNo = DATA.batchNo,
  shipmentQuantity = DATA.shipmentQuantity,
) {
  const balanceResponse = await apiFetch(
    `/warehouses/stock-balances?productName=${encodeURIComponent(productName)}&batchNo=${encodeURIComponent(batchNo)}&pageSize=100`,
    {},
    token,
  );
  if (!balanceResponse.ok) throw new Error(`stock balance readback failed: ${balanceResponse.status}`);
  const balances = unwrapList(balanceResponse).filter((item) => (
    String(item.productName) === productName && String(item.batchNo) === batchNo
  ));
  const fgBalance = balances.find((item) => String(item.locationCode || '') === 'LOC-FG');
  if (!fgBalance) throw new Error(`finished goods balance not found for ${productName}/${batchNo}`);
  const remainingQuantity = Number(fgBalance.quantity || 0);
  if (remainingQuantity !== Number(expectedRemainingQuantity)) {
    throw new Error(`expected remaining stock ${expectedRemainingQuantity}, got ${remainingQuantity}`);
  }

  const entryResponse = await apiFetch(
    `/warehouses/stock-entries?sourceType=shipping_issue&sourceRef=${encodeURIComponent(shipmentNo)}&limit=200`,
    {},
    token,
  );
  if (!entryResponse.ok) throw new Error(`stock entry readback failed: ${entryResponse.status}`);
  const issueEntries = unwrapList(entryResponse).filter((entry) => (
    String(entry.sourceType) === 'shipping_issue' && String(entry.sourceRef) === String(shipmentNo)
  ));
  if (issueEntries.length !== 1) {
    throw new Error(`expected exactly one shipping issue entry, got ${issueEntries.length}`);
  }

  const movement = Array.isArray(issueEntries[0].movements)
    ? issueEntries[0].movements.find((item) => (
        String(item.productName) === productName
        && String(item.batchNo) === batchNo
        && Number(item.quantityDelta || 0) === -Number(shipmentQuantity)
      ))
    : null;
  if (!movement) throw new Error(`shipping issue entry missing matching movement: ${shipmentNo}`);

  return {
    entryNo: issueEntries[0].entryNo,
    entryCount: issueEntries.length,
    remainingQuantity,
    locationCode: fgBalance.locationCode,
  };
}

async function run() {
  try {
    const manager = await login('manager', 'manager123');
    const sales = await login('sales', 'sales123');
    recordStep({ step: 'login-users', result: 'passed', managerId: manager.user.id, salesId: sales.user.id });

    const customer = await createAuditCustomer(sales.token);
    report.customer = { id: String(customer.id), name: customer.nameZh || customer.nameEn || customer.name };
    recordStep({ step: 'create-audit-customer', result: 'passed', customerId: customer.id });

    const seededStock = await seedFinishedGoodsStock(manager.token);
    report.seededStock = {
      locationId: String(seededStock.location.id),
      locationCode: seededStock.location.code,
      productName: DATA.shipmentProduct,
      batchNo: DATA.batchNo,
      quantity: DATA.stockQuantity,
    };
    recordStep({ step: 'seed-finished-goods-stock', result: 'passed', ...report.seededStock });

    const createOrder = await apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [
          {
            productName: DATA.shipmentProduct,
            specification: 'API-SHIPPING',
            quantity: DATA.shipmentQuantity,
            unit: '件',
            unitPrice: 320,
          },
        ],
        paymentTerms: 30,
        notes: `Shipping API audit ${RUN_ID}`,
      },
    }, sales.token);
    if (!createOrder.ok) {
      throw new Error(`create order failed: ${createOrder.status}`);
    }
    const order = createOrder.json?.data;
    report.order = { id: String(order.id), orderNo: order.orderNo };
    recordStep({ step: 'create-order', result: 'passed', orderId: order.id });

    const confirmOrder = await apiFetch(`/orders/${order.id}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
    }, manager.token);
    if (!confirmOrder.ok) {
      throw new Error(`confirm order failed: ${confirmOrder.status}`);
    }
    recordStep({ step: 'confirm-order', result: 'passed', orderId: order.id });

    const createShipment = await apiFetch('/shipping', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        orderId: Number(order.id),
        productName: DATA.shipmentProduct,
        quantity: DATA.shipmentQuantity,
        unit: '件',
        batchNo: DATA.batchNo,
        carrier: DATA.carrier,
        trackingNo: DATA.trackingNo,
      },
    }, manager.token);
    if (!createShipment.ok) {
      throw new Error(`create shipment failed: ${createShipment.status}`);
    }
    const shipment = createShipment.json?.data;
    report.shipment = { id: String(shipment.id), shipmentNo: shipment.shipmentNo, status: shipment.status };
    recordStep({ step: 'create-shipment', result: 'passed', shipmentId: shipment.id });

    const dispatchShipment = await apiFetch(`/shipping/${shipment.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    }, manager.token);
    if (!dispatchShipment.ok) {
      throw new Error(`dispatch shipment failed: ${dispatchShipment.status} — ${JSON.stringify(dispatchShipment.json)}`);
    }
    report.shipment.status = dispatchShipment.json?.data?.status || 'in_transit';
    report.shipment.batchNo = dispatchShipment.json?.data?.batchNo || DATA.batchNo;
    recordStep({ step: 'dispatch-shipment', result: 'passed', shipmentId: shipment.id });

    const issueEvidence = await verifyShippingIssue(
      manager.token,
      shipment.shipmentNo,
      DATA.stockQuantity - DATA.shipmentQuantity,
    );
    report.issueEvidence = issueEvidence;
    recordStep({ step: 'verify-shipping-issue-stock', result: 'passed', ...issueEvidence });

    const duplicateDispatch = await apiFetch(`/shipping/${shipment.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    }, manager.token);
    if (!duplicateDispatch.ok) {
      throw new Error(`duplicate dispatch failed unexpectedly: ${duplicateDispatch.status}`);
    }
    const duplicateIssueEvidence = await verifyShippingIssue(
      manager.token,
      shipment.shipmentNo,
      DATA.stockQuantity - DATA.shipmentQuantity,
    );
    if (duplicateIssueEvidence.entryCount !== issueEvidence.entryCount) {
      throw new Error(`duplicate dispatch changed issue entry count: ${duplicateIssueEvidence.entryCount}`);
    }
    recordStep({ step: 'verify-dispatch-idempotency', result: 'passed', status: duplicateDispatch.status });

    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';
    const uploadReceipt = await apiFetch(`/shipping/${shipment.id}/receipt`, {
      method: 'POST',
      data: {
        fileName: `receipt-${RUN_ID}.png`,
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${pngBase64}`,
      },
    }, manager.token);
    if (!uploadReceipt.ok) {
      throw new Error(`upload receipt failed: ${uploadReceipt.status} — ${JSON.stringify(uploadReceipt.json)}`);
    }
    report.shipment.status = readReceiptShipmentStatus(uploadReceipt.json) || 'delivered';
    recordStep({ step: 'upload-receipt', result: 'passed', shipmentId: shipment.id });

    const duplicateReceipt = await apiFetch(`/shipping/${shipment.id}/receipt`, {
      method: 'POST',
      data: {
        fileName: `receipt-duplicate-${RUN_ID}.png`,
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${pngBase64}`,
      },
    }, manager.token);
    if (duplicateReceipt.status !== 409) {
      throw new Error(`duplicate receipt expected 409, got ${duplicateReceipt.status}`);
    }
    recordStep({ step: 'verify-receipt-idempotency', result: 'passed', status: duplicateReceipt.status });

    const directSeededStock = await seedFinishedGoodsStock(
      manager.token,
      DATA.directReceiptProduct,
      DATA.directReceiptBatchNo,
      DATA.directReceiptStockQuantity,
    );
    recordStep({
      step: 'seed-direct-receipt-stock',
      result: 'passed',
      locationId: String(directSeededStock.location.id),
      locationCode: directSeededStock.location.code,
      productName: DATA.directReceiptProduct,
      batchNo: DATA.directReceiptBatchNo,
      quantity: DATA.directReceiptStockQuantity,
    });

    const createDirectOrder = await apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [
          {
            productName: DATA.directReceiptProduct,
            specification: 'API-SHIPPING-DIRECT',
            quantity: DATA.directReceiptQuantity,
            unit: '件',
            unitPrice: 360,
          },
        ],
        paymentTerms: 30,
        notes: `Shipping direct receipt audit ${RUN_ID}`,
      },
    }, sales.token);
    if (!createDirectOrder.ok) {
      throw new Error(`create direct receipt order failed: ${createDirectOrder.status}`);
    }
    const directOrder = createDirectOrder.json?.data;
    const confirmDirectOrder = await apiFetch(`/orders/${directOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
    }, manager.token);
    if (!confirmDirectOrder.ok) {
      throw new Error(`confirm direct receipt order failed: ${confirmDirectOrder.status}`);
    }

    const createDirectShipment = await apiFetch('/shipping', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        orderId: Number(directOrder.id),
        productName: DATA.directReceiptProduct,
        quantity: DATA.directReceiptQuantity,
        unit: '件',
        batchNo: DATA.directReceiptBatchNo,
        carrier: DATA.carrier,
        trackingNo: `${DATA.trackingNo}-DIRECT`,
      },
    }, manager.token);
    if (!createDirectShipment.ok) {
      throw new Error(`create direct receipt shipment failed: ${createDirectShipment.status} — ${JSON.stringify(createDirectShipment.json)}`);
    }
    const directShipment = createDirectShipment.json?.data;

    const dispatchDirectShipment = await apiFetch(`/shipping/${directShipment.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    }, manager.token);
    if (!dispatchDirectShipment.ok) {
      throw new Error(`dispatch direct receipt shipment failed: ${dispatchDirectShipment.status} - ${JSON.stringify(dispatchDirectShipment.json)}`);
    }
    recordStep({ step: 'dispatch-direct-receipt-shipment', result: 'passed', shipmentId: directShipment.id });

    const uploadDirectReceipt = await apiFetch(`/shipping/${directShipment.id}/receipt`, {
      method: 'POST',
      data: {
        fileName: `receipt-direct-${RUN_ID}.png`,
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${pngBase64}`,
      },
    }, manager.token);
    if (!uploadDirectReceipt.ok) {
      throw new Error(`direct receipt upload failed: ${uploadDirectReceipt.status} — ${JSON.stringify(uploadDirectReceipt.json)}`);
    }
    const directReceiptStatus = readReceiptShipmentStatus(uploadDirectReceipt.json);
    if (String(directReceiptStatus) !== 'delivered') {
      throw new Error(`direct receipt expected delivered, got ${directReceiptStatus}`);
    }
    const directIssueEvidence = await verifyShippingIssue(
      manager.token,
      directShipment.shipmentNo,
      DATA.directReceiptStockQuantity - DATA.directReceiptQuantity,
      DATA.directReceiptProduct,
      DATA.directReceiptBatchNo,
      DATA.directReceiptQuantity,
    );
    report.directReceipt = {
      orderId: String(directOrder.id),
      shipmentId: String(directShipment.id),
      shipmentNo: directShipment.shipmentNo,
      issueEvidence: directIssueEvidence,
    };
    recordStep({ step: 'verify-direct-receipt-posts-stock-issue', result: 'passed', ...directIssueEvidence });

    const shipmentReadback = await apiFetch(`/shipping?pageSize=50&orderId=${order.id}`, {}, manager.token);
    if (!shipmentReadback.ok) {
      throw new Error(`shipment readback failed: ${shipmentReadback.status}`);
    }
    const shipments = Array.isArray(shipmentReadback.json?.data) ? shipmentReadback.json.data : [];
    const linkedShipment = shipments.find((item) => String(item.id) === String(shipment.id));
    if (!linkedShipment || linkedShipment.status !== 'delivered' || !linkedShipment.signedReceiptUrl) {
      throw new Error('shipment did not reach delivered with signed receipt');
    }
    recordStep({
      step: 'verify-shipment-readback',
      result: 'passed',
      shipmentId: shipment.id,
      signedReceiptUrl: linkedShipment.signedReceiptUrl,
    });

    const orderReadback = await apiFetch(`/orders/${order.id}`, {}, manager.token);
    if (!orderReadback.ok) {
      throw new Error(`order readback failed: ${orderReadback.status}`);
    }
    if (String(orderReadback.json?.data?.status) !== 'delivered') {
      throw new Error(`expected delivered order, got ${orderReadback.json?.data?.status}`);
    }
    recordStep({ step: 'verify-order-readback', result: 'passed', orderId: order.id, orderStatus: orderReadback.json.data.status });

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
    console.error(report.error || 'shipping api audit failed');
    process.exit(1);
  }

  console.log(`Shipping API audit passed. Report: ${REPORT_PATH}`);
}

run();
