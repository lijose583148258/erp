const fs = require('fs');

const STEP_TIMEOUT_MS = 20_000;

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const createChemicalBomAuditContext = ({ appUrl, reportDir, reportPath }) => {
  const report = {
    name: 'Chemical BOM Production Chain Audit',
    version: 'v1',
    startTime: new Date().toISOString(),
    status: 'running',
    steps: [],
    evidence: {},
    gaps: [],
  };

  const writeReport = () => {
    ensureDir(reportDir);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  };

  const recordStep = (name, status, details = {}) => {
    const step = {
      name,
      status,
      time: new Date().toISOString(),
      ...details,
    };
    report.steps.push(step);
    writeReport();
    return step;
  };

  const fail = (message, extra = {}) => {
    const error = new Error(message);
    error.extra = extra;
    throw error;
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const elapsedMs = (start) => Date.now() - start;

  const withTimeout = async (label, fn, timeoutMs = STEP_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timed out: ${label}`)), timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  const requestJson = async (method, endpoint, { token, body, expectedStatus, timeoutMs } = {}) => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await withTimeout(`${method} ${endpoint}`, async (signal) => {
          const response = await fetch(`${appUrl}${endpoint}`, {
            method,
            signal,
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });

          const contentType = response.headers.get('content-type') || '';
          const data = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

          if (expectedStatus !== undefined && response.status !== expectedStatus) {
            const error = new Error(`Expected HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(data)}`);
            error.responseStatus = response.status;
            error.responseData = data;
            throw error;
          }
          if (expectedStatus === undefined && !response.ok) {
            const error = new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
            error.responseStatus = response.status;
            error.responseData = data;
            throw error;
          }
          return { status: response.status, data };
        }, timeoutMs);
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        const retryable =
          message.includes('fetch failed') ||
          message.includes('ECONNRESET') ||
          message.includes('ECONNREFUSED') ||
          message.includes('Timed out');
        if (!retryable || attempt === 3) {
          throw error;
        }
        await sleep(400 * attempt);
      }
    }
    throw lastError;
  };

  const login = async (username, password) => {
    const result = await requestJson('POST', '/api/auth/login', {
      body: { username, password },
      expectedStatus: 200,
    });
    const token = result.data?.data?.token || result.data?.token;
    if (!token) {
      fail('Login did not return token', result.data);
    }
    return token;
  };

  const getWarehouseState = async (token) => {
    const result = await requestJson('GET', '/api/warehouses', { token, expectedStatus: 200 });
    return Array.isArray(result.data?.data) ? result.data.data : [];
  };

  const ensureWarehouseAndLocations = async (token) => {
    const desired = {
      warehouse: { code: 'WH-MAIN', name: '主仓库', type: 'physical' },
      locations: [
        { code: 'LOC-RAW', name: '原料区', type: 'internal' },
        { code: 'LOC-FG', name: '成品区', type: 'internal' },
        { code: 'LOC-WIP', name: '半成品区', type: 'production' },
        { code: 'LOC-SCRAP', name: '废料区', type: 'scrap' },
      ],
    };

    const warehouses = await getWarehouseState(token);
    let warehouse = warehouses.find(item => item.code === desired.warehouse.code) || null;

    if (!warehouse) {
      const createdWarehouse = await requestJson('POST', '/api/warehouses', {
        token,
        body: desired.warehouse,
        expectedStatus: 201,
      });
      warehouse = createdWarehouse.data?.data;
    }

    if (!warehouse?.id) {
      fail('Unable to resolve warehouse id', warehouse);
    }

    const stateAfterWarehouseBootstrap = await getWarehouseState(token);

    const existingLocations = new Map();
    for (const wh of stateAfterWarehouseBootstrap) {
      for (const loc of wh.locations || []) {
        existingLocations.set(loc.code, loc);
      }
    }

    for (const location of desired.locations) {
      if (!existingLocations.has(location.code)) {
        await requestJson('POST', `/api/warehouses/${warehouse.id}/locations`, {
          token,
          body: location,
          expectedStatus: 201,
        });
      }
    }

    const finalWarehouses = await getWarehouseState(token);
    const resolvedLocations = new Map();
    for (const wh of finalWarehouses) {
      for (const loc of wh.locations || []) {
        resolvedLocations.set(loc.code, { ...loc, warehouseId: wh.id, warehouseCode: wh.code });
      }
    }

    const locations = {};
    for (const location of desired.locations) {
      const resolved = resolvedLocations.get(location.code);
      if (!resolved) {
        fail(`Missing required location after bootstrap: ${location.code}`);
      }
      locations[location.code] = resolved;
    }

    return {
      warehouse: finalWarehouses.find(item => item.id === warehouse.id) || warehouse,
      locations,
    };
  };

  const ensureRawStock = async (token, locationId, code, quantity = 50, unitCost = 10) => {
    const payload = {
      locationId,
      productName: code,
      batchNo: `${code}-BATCH`,
      quantity,
      unit: 'kg',
      unitCost,
      sourceRef: `CHEM-BOM-AUDIT-SEED-${code}`,
      reason: '化工 BOM 审计前置原料库存补录，验证生产完工扣减闭环',
      note: 'chemical bom audit seed',
    };
    const result = await requestJson('POST', '/api/warehouses/stock-balances', {
      token,
      body: payload,
      expectedStatus: 201,
    });
    return result.data?.data || result.data;
  };

  const listStockBalances = async (token, query) => {
    const queryString = new URLSearchParams(query).toString();
    const endpoint = `/api/warehouses/stock-balances${queryString ? `?${queryString}` : ''}`;
    const result = await requestJson('GET', endpoint, { token, expectedStatus: 200 });
    return Array.isArray(result.data?.data) ? result.data.data : [];
  };

  const listStockEntries = async (token, query) => {
    const queryString = new URLSearchParams(query).toString();
    const endpoint = `/api/warehouses/stock-entries${queryString ? `?${queryString}` : ''}`;
    const result = await requestJson('GET', endpoint, { token, expectedStatus: 200 });
    return Array.isArray(result.data?.data) ? result.data.data : [];
  };

  const listBatches = async (token, keyword) => {
    const queryString = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
    const result = await requestJson('GET', `/api/production/work-orders${queryString}`, { token, expectedStatus: 200 });
    return Array.isArray(result.data?.data) ? result.data.data : [];
  };

  const getPreviewConsumption = async (token, workOrderId) => {
    const result = await requestJson('GET', `/api/production/work-orders/${workOrderId}/preview-consumption`, {
      token,
      expectedStatus: 200,
    });
    return result.data?.data || [];
  };

  const getBatchCostLedger = async (token, batchId) => {
    const result = await requestJson('GET', `/api/production/batches/${batchId}/cost-ledger`, {
      token,
      expectedStatus: 200,
    });
    return result.data?.data || {};
  };

  const createBom = async (token, payload) => {
    const result = await requestJson('POST', '/api/production/boms', {
      token,
      body: payload,
      expectedStatus: 201,
    });
    return result.data?.data || result.data;
  };

  const createWorkOrder = async (token, payload) => {
    const result = await requestJson('POST', '/api/production/work-orders', {
      token,
      body: payload,
      expectedStatus: 201,
    });
    return result.data?.data || result.data;
  };

  const completeWorkOrder = async (token, workOrderId, payload, expectedStatus = 200) => {
    return requestJson('PATCH', `/api/production/work-orders/${workOrderId}/status`, {
      token,
      body: payload,
      expectedStatus,
    });
  };

  const findWorkOrder = async (token, keyword, workOrderId) => {
    const items = await listBatches(token, keyword);
    return items.find(item => item.id === workOrderId) || null;
  };

  const getProductionSummary = async (token) => {
    const result = await requestJson('GET', '/api/production/summary', { token, expectedStatus: 200 });
    return result.data?.data || {};
  };

  return {
    report,
    ensureDir,
    writeReport,
    recordStep,
    fail,
    elapsedMs,
    requestJson,
    login,
    ensureWarehouseAndLocations,
    ensureRawStock,
    listStockBalances,
    listStockEntries,
    getPreviewConsumption,
    getBatchCostLedger,
    createBom,
    createWorkOrder,
    completeWorkOrder,
    findWorkOrder,
    getProductionSummary,
  };
};

module.exports = {
  createChemicalBomAuditContext,
};
