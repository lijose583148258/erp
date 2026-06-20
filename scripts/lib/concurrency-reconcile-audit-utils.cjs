function createConcurrencyAuditData(runId) {
  return {
    order: {
      customerName: `CONC-ORDER-CUST-${runId}`,
      productName: `CONC-ORDER-PROD-${runId}`,
      note: `duplicate-payment-${runId}`,
      amount: 300,
    },
    barter: {
      customerName: `CONC-BARTER-CUST-${runId}`,
      counterpartyName: `CONC-BARTER-CP-${runId}`,
      ourItemName: `CONC-BARTER-OUR-${runId}`,
      counterpartyItemName: `CONC-BARTER-CPITEM-${runId}`,
      note: `duplicate-barter-post-${runId}`,
    },
    shipping: {
      customerName: `CONC-SHIP-CUST-${runId}`,
      productName: `CONC-SHIP-PROD-${runId}`,
      batchNo: `CONC-SHIP-BATCH-${runId}`,
      receiptNote: `duplicate-receipt-${runId}`,
      trackingNo: `CONC-SHIP-${runId}`,
      quantity: 4,
    },
  };
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function isSuccessStatus(status) {
  return status >= 200 && status < 300;
}

function summarizeStatuses(items) {
  return items.map((item) => item.status);
}

function makeReceiptPngDataUrl() {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';
  return `data:image/png;base64,${pngBase64}`;
}

function createConcurrencyApiClient({ apiBase, runId }) {
  async function apiFetch(endpoint, options = {}, token = '') {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 12000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
        body: options.data ? JSON.stringify(options.data) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }

      return { ok: response.ok, status: response.status, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  async function login(username, password) {
    const response = await apiFetch('/auth/login', {
      method: 'POST',
      data: { username, password },
      timeoutMs: 10000,
    });
    if (!response.ok) {
      throw new Error(`login failed for ${username}: ${response.status} ${response.json?.message || ''}`);
    }
    return response.json.data;
  }

  async function createCustomer(token, payload) {
    const response = await apiFetch('/customers', { method: 'POST', data: payload }, token);
    if (!response.ok || !response.json?.data?.id) {
      throw new Error(`create customer failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  }

  async function createOrder(token, payload) {
    const response = await apiFetch('/orders', { method: 'POST', data: payload }, token);
    if (!response.ok || !response.json?.data?.id) {
      throw new Error(`create order failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  }

  async function getOrder(token, id) {
    const response = await apiFetch(`/orders/${id}`, {}, token);
    if (!response.ok || !response.json?.data) {
      throw new Error(`get order failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  }

  async function listShipments(token, orderId) {
    const response = await apiFetch(`/shipping?pageSize=50&orderId=${encodeURIComponent(orderId)}`, {}, token);
    if (!response.ok) {
      throw new Error(`list shipments failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return unwrapList(response);
  }

  async function createShipment(token, payload) {
    const response = await apiFetch('/shipping', { method: 'POST', data: payload }, token);
    if (!response.ok || !response.json?.data?.id) {
      throw new Error(`create shipment failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  }

  async function resolveLocation(token, code) {
    const response = await apiFetch('/warehouses', {}, token);
    if (!response.ok) throw new Error(`warehouse list failed: ${response.status}`);
    const warehouses = unwrapList(response);
    for (const warehouse of warehouses) {
      const locations = Array.isArray(warehouse.locations) ? warehouse.locations : [];
      const match = locations.find((location) => String(location.code) === code);
      if (match) return match;
    }
    throw new Error(`location ${code} not found`);
  }

  async function seedStock(token, code, productName, batchNo, quantity) {
    const location = await resolveLocation(token, code);
    const seedRef = `concurrency-audit-seed:${runId}:${code}:${batchNo}`;
    const response = await apiFetch('/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(location.id),
        productName,
        batchNo,
        quantity,
        unit: 'kg',
        sourceRef: seedRef,
        reason: 'concurrency_audit_seed_stock',
        note: `concurrency-audit-${runId}-${code}`,
      },
    }, token);
    if (!response.ok) {
      throw new Error(`seed stock failed for ${code}: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return { location, balance: response.json.data };
  }

  async function readStockBalance(token, productName, batchNo, locationCode) {
    const response = await apiFetch(
      `/warehouses/stock-balances?productName=${encodeURIComponent(productName)}&batchNo=${encodeURIComponent(batchNo)}&pageSize=100`,
      {},
      token,
    );
    if (!response.ok) throw new Error(`read stock balances failed: ${response.status}`);
    const row = unwrapList(response).find((item) => String(item.locationCode || '') === locationCode);
    return Number(row?.quantity || 0);
  }

  async function countStockEntries(token, sourceType, sourceRef) {
    const response = await apiFetch(
      `/warehouses/stock-entries?sourceType=${encodeURIComponent(sourceType)}&sourceRef=${encodeURIComponent(sourceRef)}&limit=100`,
      {},
      token,
    );
    if (!response.ok) throw new Error(`read stock entries failed: ${response.status}`);
    return unwrapList(response).filter((entry) => String(entry.sourceType) === sourceType && String(entry.sourceRef) === String(sourceRef));
  }

  async function createBarterAgreement(token, payload) {
    const response = await apiFetch('/barter/agreements', { method: 'POST', data: payload }, token);
    if (!response.ok || !response.json?.data?.id) {
      throw new Error(`create barter agreement failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  }

  async function createBarterBatch(token, agreementId, payload) {
    const response = await apiFetch(`/barter/agreements/${agreementId}/batches`, { method: 'POST', data: payload }, token);
    return { ok: response.ok, status: response.status, json: response.json };
  }

  async function approveBarterSettlement(token, id, note) {
    const response = await apiFetch(`/barter/settlements/${id}/approve`, {
      method: 'PATCH',
      data: { note },
    }, token);
    if (!response.ok) {
      throw new Error(`approve barter settlement failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  }

  async function postBarterSettlement(token, id, payload) {
    const response = await apiFetch(`/barter/settlements/${id}/post`, {
      method: 'POST',
      data: payload,
    }, token);
    return { ok: response.ok, status: response.status, json: response.json };
  }

  async function getBarterSettlement(token, id) {
    const response = await apiFetch(`/barter/settlements/${id}`, {}, token);
    if (!response.ok || !response.json?.data) {
      throw new Error(`get barter settlement failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  }

  async function uploadReceipt(token, shipmentId, payload) {
    const response = await apiFetch(`/shipping/${shipmentId}/receipt`, { method: 'POST', data: payload }, token);
    return { ok: response.ok, status: response.status, json: response.json };
  }

  return {
    apiFetch,
    login,
    createCustomer,
    createOrder,
    getOrder,
    listShipments,
    createShipment,
    seedStock,
    readStockBalance,
    countStockEntries,
    createBarterAgreement,
    createBarterBatch,
    approveBarterSettlement,
    postBarterSettlement,
    getBarterSettlement,
    uploadReceipt,
  };
}

module.exports = {
  createConcurrencyApiClient,
  createConcurrencyAuditData,
  isSuccessStatus,
  makeReceiptPngDataUrl,
  summarizeStatuses,
};
