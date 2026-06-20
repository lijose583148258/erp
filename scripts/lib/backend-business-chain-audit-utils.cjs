const fs = require('fs');

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';

function createBackendBusinessChainContext({
  appUrl,
  outputDir,
  reportPath,
  runId,
  data,
  requestTimeoutMs,
}) {
  const report = {
    appUrl,
    startedAt: new Date().toISOString(),
    runId,
    data,
    status: 'running',
    steps: [],
    checkpoints: {},
    failure: null,
  };

  function ensureOutputDir() {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  function normalizeBody(body) {
    if (body == null) return undefined;
    return JSON.stringify(body);
  }

  function unwrapData(payload) {
    return payload?.json?.data ?? null;
  }

  function unwrapList(payload) {
    const responseData = unwrapData(payload);
    if (Array.isArray(responseData)) return responseData;
    if (Array.isArray(responseData?.items)) return responseData.items;
    return [];
  }

  function recordStep(step) {
    report.steps.push({ at: new Date().toISOString(), ...step });
  }

  function summarizeError(error) {
    if (!error) return { message: 'Unknown error' };
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code || null,
        status: error.status || null,
        details: error.details || null,
      };
    }
    if (typeof error === 'object') {
      return { ...error };
    }
    return { message: String(error) };
  }

  async function saveReport() {
    ensureOutputDir();
    report.endedAt = new Date().toISOString();
    report.durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  function fail(stage, error, extra = {}) {
    report.status = 'failed';
    report.failure = {
      stage,
      ...summarizeError(error),
      ...extra,
    };
  }

  function parseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async function apiFetch(endpoint, options = {}, token = '') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Timeout after ${requestTimeoutMs}ms`)), requestTimeoutMs);
    try {
      const response = await fetch(`${appUrl}api${endpoint}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
        body: normalizeBody(options.data),
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        json: parseJson(text),
        text,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout after ${requestTimeoutMs}ms for ${endpoint}`);
        timeoutError.code = 'REQUEST_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function expectOk(label, promiseFactory) {
    const response = await promiseFactory();
    if (!response.ok) {
      const error = new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
      error.status = response.status;
      error.details = response.json;
      throw error;
    }
    return response;
  }

  async function login(username, password) {
    const response = await expectOk(`login ${username}`, () => apiFetch('/auth/login', {
      method: 'POST',
      data: { username, password },
    }));
    const responseData = unwrapData(response);
    if (!responseData?.token || !responseData?.user?.id) {
      throw new Error(`login ${username} returned missing token/user`);
    }
    return responseData;
  }

  function buildAddress(label, city) {
    return {
      type: 'legal',
      label,
      countryCode: 'VN',
      city,
      fullAddress: `${label} ${city} ${runId}`,
      isPrimary: true,
    };
  }

  async function getWarehouses(token) {
    const response = await expectOk('list warehouses', () => apiFetch('/warehouses', {}, token));
    const warehouses = unwrapList(response);
    const warehouse = warehouses.find((item) => String(item.code) === 'WH-MAIN');
    const locations = warehouse?.locations || [];
    const rawLocation = locations.find((item) => String(item.code) === 'LOC-RAW');
    const fgLocation = locations.find((item) => String(item.code) === 'LOC-FG');
    if (!warehouse) throw new Error('WH-MAIN warehouse not found');
    if (!rawLocation) throw new Error('location LOC-RAW not found');
    if (!fgLocation) throw new Error('location LOC-FG not found');
    return { warehouse, rawLocation, fgLocation, warehouses };
  }

  async function createSupplier(manager) {
    const response = await expectOk('create supplier', () => apiFetch('/procurement/suppliers', {
      method: 'POST',
      data: {
        name: data.supplierName,
        nameZh: data.supplierName,
        nameEn: `Supplier EN ${runId}`,
        nameVi: `Nha cung cap ${runId}`,
        nameAliases: [`SUP-${runId}`, `SUPPLIER-${runId}`],
        category: 'Raw Materials',
        riskLevel: 'low',
        contact: `SUP-CONTACT-${runId.slice(-4)}`,
        addresses: [buildAddress('legal', 'Hanoi'), buildAddress('billing', 'Hanoi')],
        contacts: [{
          name: `Supplier Contact ${runId.slice(-4)}`,
          phone: `09${runId.slice(-8)}`,
          email: `supplier-${runId}@example.com`,
          language: 'zh',
          isPrimary: true,
        }],
      },
    }, manager.token));
    const supplier = unwrapData(response);
    if (!supplier?.id) throw new Error('create supplier returned missing id');
    return supplier;
  }

  async function createCustomer(sales) {
    const response = await expectOk('create customer', () => apiFetch('/customers', {
      method: 'POST',
      data: {
        name: data.customerName,
        nameZh: data.customerName,
        nameEn: `Customer EN ${runId}`,
        nameVi: `Khach hang ${runId}`,
        licenseNumber: `LIC-${runId}`,
        creditLimit: 1000000,
        riskLevel: 'low',
        segment: 'direct',
        poolState: 'private',
        contactName: `Customer Contact ${runId.slice(-4)}`,
        contactPhone: `08${runId.slice(-8)}`,
        contactEmail: `customer-${runId}@example.com`,
        addresses: [
          { type: 'shipping', label: 'shipping', countryCode: 'VN', city: 'Ho Chi Minh', fullAddress: `Customer shipping address ${runId}`, isPrimary: true },
          { type: 'legal', label: 'legal', countryCode: 'VN', city: 'Ho Chi Minh', fullAddress: `Customer legal address ${runId}` },
        ],
        contacts: [{
          name: `Customer Contact ${runId.slice(-4)}`,
          phone: `08${runId.slice(-8)}`,
          email: `customer-${runId}@example.com`,
          language: 'zh',
          isPrimary: true,
        }],
      },
    }, sales.token));
    const customer = unwrapData(response);
    if (!customer?.id) throw new Error('create customer returned missing id');
    return customer;
  }

  async function createSalesOrder(sales, customerId) {
    const response = await expectOk('create sales order', () => apiFetch('/orders', {
      method: 'POST',
      data: {
        customerId: Number(customerId),
        items: [{
          productName: data.orderProduct,
          specification: 'CHAIN-AUDIT',
          quantity: data.orderQuantity,
          unit: 'kg',
          unitPrice: data.orderUnitPrice,
        }],
        paymentTerms: 30,
        notes: `backend-business-chain-audit ${runId}`,
      },
    }, sales.token));
    const order = unwrapData(response);
    if (!order?.id || order.finalAmount == null) throw new Error('create sales order returned missing id/finalAmount');
    return order;
  }

  async function confirmSalesOrder(manager, orderId) {
    const response = await expectOk('confirm sales order', () => apiFetch(`/orders/${orderId}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
    }, manager.token));
    const order = unwrapData(response);
    if (!order?.id) throw new Error('confirm sales order returned missing order data');
    return order;
  }

  async function recordPayment(sales, orderId, amount) {
    const response = await expectOk('record payment', () => apiFetch(`/orders/${orderId}/payment`, {
      method: 'POST',
      data: {
        amount,
        method: data.paymentMethod,
        payerName: data.customerName,
        note: `payment for backend-business-chain-audit ${runId}`,
      },
    }, sales.token));
    const order = unwrapData(response);
    if (!order?.id) throw new Error('record payment returned missing order');
    return order;
  }

  async function verifyPayment(finance, orderId, paymentId) {
    const response = await expectOk('verify payment', () => apiFetch(`/orders/${orderId}/payment/${paymentId}/verify`, {
      method: 'POST',
    }, finance.token));
    const order = unwrapData(response);
    if (!order?.id) throw new Error('verify payment returned missing order');
    return order;
  }

  async function createPurchaseOrder(manager, supplierId, salesOrderId) {
    const response = await expectOk('create purchase order', () => apiFetch('/procurement/orders', {
      method: 'POST',
      data: {
        supplierId: Number(supplierId),
        item: data.rawItem,
        quantity: data.procurementQuantity,
        unit: 'kg',
        price: 15,
        eta: '2026-05-31',
        salesOrderId: Number(salesOrderId),
        isB2B: true,
      },
    }, manager.token));
    const order = unwrapData(response);
    if (!order?.id) throw new Error('create purchase order returned missing id');
    return order;
  }

  async function approvePurchaseOrder(manager, purchaseOrderId) {
    const response = await expectOk('approve purchase order', () => apiFetch(`/procurement/orders/${purchaseOrderId}/status`, {
      method: 'PATCH',
      data: { status: 'approved' },
    }, manager.token));
    const order = unwrapData(response);
    if (!order?.id) throw new Error('approve purchase order returned missing order');
    return order;
  }

  async function createPurchaseReceipt(manager, purchaseOrderId) {
    const response = await expectOk('create purchase receipt', () => apiFetch(`/procurement/orders/${purchaseOrderId}/receipts`, {
      method: 'POST',
      data: {
        quantity: data.procurementQuantity,
        acceptedQuantity: data.procurementAcceptedQuantity,
        rejectedQuantity: data.procurementRejectedQuantity,
        batchNo: data.rawBatchNo,
        discrepancyReason: 'accept partial receipt for audit',
        note: `backend-business-chain-audit ${runId}`,
      },
    }, manager.token));
    const responseData = unwrapData(response);
    const receipt = Array.isArray(responseData?.receipts) ? responseData.receipts[0] : null;
    if (!responseData?.purchaseOrder?.id || !receipt?.receiptNo) {
      throw new Error('create purchase receipt returned missing purchaseOrder/receipt row');
    }
    responseData.receiptNo = receipt.receiptNo;
    return responseData;
  }

  async function readPurchaseReceipts(manager, purchaseOrderId) {
    const response = await expectOk('read purchase receipts', () => apiFetch(`/procurement/orders/${purchaseOrderId}/receipts`, {}, manager.token));
    const responseData = unwrapData(response);
    if (!responseData?.purchaseOrder?.id || !Array.isArray(responseData.receipts)) {
      throw new Error('read purchase receipts returned unexpected shape');
    }
    return responseData;
  }

  async function seedFinishedGoodsStock(warehouse, fgLocationId, quantity) {
    const response = await expectOk('seed finished goods stock', () => apiFetch('/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(fgLocationId),
        productName: data.orderProduct,
        batchNo: data.fgBatchNo,
        quantity,
        unit: 'kg',
        note: `setup FG seed for backend-business-chain-audit ${runId}`,
      },
    }, warehouse.token));
    const balance = unwrapData(response);
    if (!balance?.id) throw new Error('seed finished goods stock returned missing balance id');
    return balance;
  }

  async function createShipment(warehouse, customerId, orderId) {
    const response = await expectOk('create shipment', () => apiFetch('/shipping', {
      method: 'POST',
      data: {
        customerId: Number(customerId),
        orderId: Number(orderId),
        productName: data.orderProduct,
        quantity: data.orderQuantity,
        unit: 'kg',
        batchNo: data.fgBatchNo,
        carrier: `CARRIER-${runId.slice(-4)}`,
        trackingNo: `TRACK-${runId}`,
        notes: `backend-business-chain-audit ${runId}`,
      },
    }, warehouse.token));
    const shipment = unwrapData(response);
    if (!shipment?.id || !shipment?.shipmentNo) throw new Error('create shipment returned missing id/shipmentNo');
    return shipment;
  }

  async function setShipmentInTransit(warehouse, shipmentId) {
    const response = await expectOk('update shipment status', () => apiFetch(`/shipping/${shipmentId}/status`, {
      method: 'PATCH',
      data: {
        status: 'in_transit',
        trackingNo: `TRACK-${runId}`,
      },
    }, warehouse.token));
    const shipment = unwrapData(response);
    if (!shipment?.id) throw new Error('update shipment status returned missing shipment');
    return shipment;
  }

  async function createShipmentReceiptEvent(warehouse, shipmentId) {
    const response = await expectOk('create shipment receipt event', () => apiFetch(`/shipping/${shipmentId}/receipt-events`, {
      method: 'POST',
      data: {
        quantity: data.orderQuantity,
        acceptedQuantity: data.orderQuantity - 1,
        rejectedQuantity: 1,
        discrepancyType: 'customer_short_signed',
        discrepancyReason: 'partial signed receipt for audit',
        note: `backend-business-chain-audit ${runId}`,
        fileName: `pod-${runId}.png`,
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${PNG_1X1}`,
      },
    }, warehouse.token));
    const responseData = unwrapData(response);
    if (!responseData?.shipment?.id || !Array.isArray(responseData.receipts)) {
      throw new Error('create shipment receipt event returned unexpected shape');
    }
    return responseData;
  }

  async function readShipmentReceipts(warehouse, shipmentId) {
    const response = await expectOk('read shipment receipts', () => apiFetch(`/shipping/${shipmentId}/receipts`, {}, warehouse.token));
    const responseData = unwrapData(response);
    if (!responseData?.shipment?.id || !Array.isArray(responseData.receipts)) {
      throw new Error('read shipment receipts returned unexpected shape');
    }
    return responseData;
  }

  async function readDiscrepancyCases(token, query) {
    const params = new URLSearchParams(query);
    const response = await expectOk('read discrepancy cases', () => apiFetch(`/receipt-discrepancies?${params.toString()}`, {}, token));
    return unwrapList(response);
  }

  async function readStockBalance(token, productName, batchNo, locationCode) {
    const response = await expectOk('read stock balances', () => apiFetch(
      `/warehouses/stock-balances?productName=${encodeURIComponent(productName)}&batchNo=${encodeURIComponent(batchNo)}&pageSize=100`,
      {},
      token,
    ));
    return unwrapList(response).filter((item) => (
      String(item.productName) === String(productName)
      && String(item.batchNo) === String(batchNo)
      && String(item.locationCode || '') === String(locationCode)
    ));
  }

  async function readStockEntries(token, sourceType, sourceRef) {
    const response = await expectOk('read stock entries', () => apiFetch(
      `/warehouses/stock-entries?sourceType=${encodeURIComponent(sourceType)}&sourceRef=${encodeURIComponent(sourceRef)}&limit=100`,
      {},
      token,
    ));
    return unwrapList(response).filter((entry) => (
      String(entry.sourceType) === String(sourceType)
      && String(entry.sourceRef) === String(sourceRef)
    ));
  }

  async function readOrderDetail(token, orderId) {
    const response = await expectOk('read order detail', () => apiFetch(`/orders/${orderId}`, {}, token));
    const order = unwrapData(response);
    if (!order?.id) throw new Error('read order detail returned missing order');
    return order;
  }

  return {
    apiFetch,
    createCustomer,
    createPurchaseOrder,
    createPurchaseReceipt,
    createSalesOrder,
    createShipment,
    createShipmentReceiptEvent,
    createSupplier,
    expectOk,
    fail,
    getWarehouses,
    login,
    readDiscrepancyCases,
    readOrderDetail,
    readPurchaseReceipts,
    readShipmentReceipts,
    readStockBalance,
    readStockEntries,
    recordPayment,
    recordStep,
    report,
    saveReport,
    seedFinishedGoodsStock,
    setShipmentInTransit,
    summarizeError,
    unwrapList,
    verifyPayment,
    approvePurchaseOrder,
    confirmSalesOrder,
  };
}

module.exports = {
  createBackendBusinessChainContext,
};
