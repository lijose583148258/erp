const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');
const { createConcurrencyApiClient } = require('./lib/concurrency-reconcile-audit-utils.cjs');
const { createChemicalBomAuditContext } = require('./lib/chemical-bom-audit-utils.cjs');
const { ensureReleasedMaterial } = require('./lib/material-audit-fixture.cjs');

// Synthetic users and documents only. Run against the isolated cloud sandbox.
const primaryUrl = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/$/, '');
const secondaryUrl = (process.env.SECONDARY_APP_URL || process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/$/, '');
const runKey = String(process.env.GITHUB_RUN_ID || Date.now()) + '-' + String(process.env.GITHUB_RUN_ATTEMPT || 1);
const password = crypto.randomBytes(24).toString('base64url') + 'Aa1!';
const reportPath = path.resolve(process.env.STAFF_AUDIT_REPORT_PATH || 'cloud-evidence/enterprise-20-staff-audit-v1.json');
const primary = createConcurrencyApiClient({ apiBase: primaryUrl + '/api', runId: runKey });
const secondary = createConcurrencyApiClient({ apiBase: secondaryUrl + '/api', runId: runKey });
const production = createChemicalBomAuditContext({
  appUrl: primaryUrl,
  reportDir: path.dirname(reportPath),
  reportPath: path.join(path.dirname(reportPath), 'enterprise-20-staff-production-helper.json'),
});

const positions = [
  ['owner', 'admin', '/dashboard'],
  ['sales_lead', 'manager', '/orders/stats'],
  ['sales_1', 'sales', '/customers?page=1&pageSize=20'],
  ['sales_2', 'sales', '/orders?page=1&pageSize=20'],
  ['sales_3', 'sales', '/customers?page=1&pageSize=20'],
  ['sales_4', 'sales', '/orders?page=1&pageSize=20'],
  ['buyer_1', 'manager', '/procurement/suppliers'],
  ['buyer_2', 'manager', '/procurement/orders'],
  ['production_1', 'manager', '/production/boms'],
  ['production_2', 'manager', '/production/work-orders'],
  ['production_3', 'manager', '/production/summary'],
  ['quality', 'manager', '/production/work-orders'],
  ['warehouse_1', 'warehouse', '/warehouses'],
  ['warehouse_2', 'warehouse', '/warehouses/stock-balances?pageSize=20'],
  ['warehouse_3', 'warehouse', '/production/work-orders'],
  ['warehouse_4', 'warehouse', '/warehouses/stock-entries?limit=20'],
  ['logistics', 'warehouse', '/shipping?pageSize=20'],
  ['finance_1', 'finance', '/orders/stats'],
  ['finance_2', 'finance', '/collections/summary'],
  ['collections', 'finance', '/collections/overdue?page=1&pageSize=20'],
].map(([job, role, readPath], index) => ({
  job, role, readPath, username: 'e20_' + runKey + '_' + String(index + 1).padStart(2, '0'),
}));

const report = {
  baseline: process.env.GITHUB_SHA || 'local',
  runKey,
  primaryUrl,
  secondaryUrl,
  startedAt: new Date().toISOString(),
  status: 'running',
  staff: positions.map(({ job, role, username }) => ({ job, role, username })),
  steps: [],
  findings: [],
  summary: {},
};
const sessions = new Map();

function save() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temp = reportPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, reportPath);
  JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function person(job) {
  const account = sessions.get(job);
  if (!account) throw new Error('no active session for ' + job);
  return account;
}

function requireSuccess(response, label) {
  if (!response?.ok || !response?.json?.data) {
    throw new Error(label + ': HTTP ' + response?.status + ' ' + String(response?.json?.errorCode || response?.json?.message || '').slice(0, 160));
  }
  return response.json.data;
}

async function step(name, jobs, action) {
  const started = Date.now();
  try {
    const value = await action();
    report.steps.push({ name, jobs, status: 'passed', durationMs: Date.now() - started, result: value?.evidence || null });
    save();
    return value;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    report.steps.push({ name, jobs, status: 'failed', durationMs: Date.now() - started, error: message });
    report.findings.push({ name, jobs, message });
    save();
    return null;
  }
}

async function createSalesCase(job, index, productMaterialId) {
  const actor = person(job);
  const name = 'E20-CHEM-CUSTOMER-' + runKey + '-' + index;
  const customer = requireSuccess(await primary.apiFetch('/customers', {
    method: 'POST',
    data: {
      name, nameZh: name, nameEn: name, nameVi: name,
      licenseNumber: 'E20-LIC-' + runKey + '-' + index,
      creditLimit: 100000, riskLevel: 'low', segment: 'direct',
      poolState: 'private', salespersonId: Number(actor.user.id),
      contactName: 'Test contact ' + index, contactPhone: '09000000' + String(index).padStart(2, '0'),
      contactEmail: 'e20-' + runKey + '-' + index + '@example.test',
      addresses: [{ type: 'shipping', label: 'factory', countryCode: 'CN', fullAddress: 'Synthetic industrial park ' + index, isPrimary: true }],
    },
  }, actor.token), 'create customer');
  const order = await primary.createOrder(actor.token, {
    customerId: Number(customer.id),
    items: [{ materialId: productMaterialId, productName: 'E20-TEST-WATERBORNE-RESIN-' + runKey,
      specification: 'synthetic test only', quantity: 100, unit: 'kg', unitPrice: 5.25 }],
    paymentTerms: 30, notes: '20-staff sandbox ' + runKey,
  });
  const own = await primary.getOrder(actor.token, order.id);
  if (Number(own.id) !== Number(order.id)) throw new Error('order owner readback mismatch');
  return { customer, order, evidence: { customerId: customer.id, orderId: order.id, orderNo: order.orderNo } };
}

async function main() {
  save();
  await step('provision_20_distinct_accounts', positions.map((p) => p.job), async () => {
    for (let i = 0; i < positions.length; i += 5) {
      await Promise.all(positions.slice(i, i + 5).map((p) =>
        ensureUiAuditUser({ username: p.username, password, role: p.role, segment: 'direct' })));
    }
    return { evidence: { provisioned: positions.length } };
  });
  await step('20_independent_logins', positions.map((p) => p.job), async () => {
    const result = await Promise.allSettled(positions.map(async (p) => {
      const login = await primary.login(p.username, password);
      if (!login?.token || login?.user?.role !== p.role) throw new Error('login identity or role mismatch for ' + p.job);
      sessions.set(p.job, login);
    }));
    const errors = result.flatMap((item, index) => item.status === 'rejected' ? [positions[index].job + ': ' + item.reason?.message] : []);
    if (errors.length) throw new Error(errors.join('; '));
    return { evidence: { distinctSessions: sessions.size } };
  });
  if (sessions.size !== 20) throw new Error('20 independent sessions were not established');

  await step('20_concurrent_role_tasks_across_two_instances', positions.map((p) => p.job), async () => {
    const reads = await Promise.all(positions.map(async (p, index) => {
      const client = index % 2 ? secondary : primary;
      const response = await client.apiFetch(p.readPath, { timeoutMs: 25000 }, person(p.job).token);
      return { job: p.job, status: response.status, instance: index % 2 ? 'secondary' : 'primary', path: p.readPath };
    }));
    if (reads.some((row) => row.status !== 200)) throw new Error('role read failed: ' + JSON.stringify(reads.filter((row) => row.status !== 200)));
    return { evidence: { completed: reads.length, statuses: reads.map((row) => row.status) } };
  });

  const releasedProduct = await step('release_finished_good_before_sales_confirmation', ['sales_lead'], async () => {
    const material = await ensureReleasedMaterial({
      request: (endpoint, options) => primary.apiFetch(endpoint, options, person('sales_lead').token),
      code: 'E20-FG-' + runKey, name: 'E20-TEST-WATERBORNE-RESIN-' + runKey,
      category: 'finished_good', shelfLifeDays: 180,
    });
    return { id: material.id, evidence: { materialId: material.id, code: material.code, status: material.status } };
  });
  const cases = await step('four_sales_people_create_customers_and_orders', ['sales_1', 'sales_2', 'sales_3', 'sales_4'], async () => {
    if (!releasedProduct?.id) throw new Error('finished-good material must be released before sales orders');
    const tasks = await Promise.allSettled([1, 2, 3, 4].map((number) => createSalesCase('sales_' + number, number, releasedProduct.id)));
    const failures = tasks.flatMap((task, index) => task.status === 'rejected' ? ['sales_' + (index + 1) + ': ' + task.reason?.message] : []);
    if (failures.length) throw new Error(failures.join('; '));
    return { items: tasks.map((task) => task.value), evidence: { customerIds: tasks.map((task) => task.value.customer.id), orderIds: tasks.map((task) => task.value.order.id) } };
  });
  if (cases?.items?.length) {
    await step('sales_lead_confirms_four_orders', ['sales_lead'], async () => {
      const statuses = [];
      for (const item of cases.items) {
        const response = await primary.apiFetch('/orders/' + item.order.id + '/status', { method: 'PATCH', data: { status: 'confirmed' } }, person('sales_lead').token);
        statuses.push({ orderId: item.order.id, status: response.status,
          errorCode: response.json?.errorCode, message: response.json?.message });
      }
      if (statuses.some((row) => row.status !== 200)) throw new Error('confirmation failed: ' + JSON.stringify(statuses));
      return { evidence: statuses };
    });
    await step('sales_records_finance_verifies_collection', ['sales_1', 'finance_1', 'finance_2', 'collections'], async () => {
      const item = cases.items[0];
      const amount = Number(item.order.finalAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('invalid order final amount');
      requireSuccess(await primary.apiFetch('/orders/' + item.order.id + '/payment', {
        method: 'POST', data: { amount, method: 'cash', payerName: item.customer.nameZh, note: 'synthetic collection ' + runKey },
      }, person('sales_1').token), 'record payment');
      const pending = await primary.getOrder(person('finance_1').token, item.order.id);
      const record = (pending.paymentRecords || []).find((entry) => entry.status === 'pending');
      if (!record?.id) throw new Error('pending payment missing from finance readback');
      requireSuccess(await primary.apiFetch('/orders/' + item.order.id + '/payment/' + record.id + '/verify', { method: 'POST' }, person('finance_2').token), 'verify payment');
      const verified = await secondary.getOrder(person('collections').token, item.order.id);
      if (Math.abs(Number(verified.paidAmount) - amount) > 0.01) throw new Error('cross-instance payment balance drift');
      return { evidence: { orderId: item.order.id, paymentId: record.id, expectedAmount: amount, paidAmount: Number(verified.paidAmount) } };
    });
  }

  await step('permission_and_private_customer_boundaries', ['sales_1', 'sales_2', 'warehouse_1'], async () => {
    const unauthorized = await primary.apiFetch('/orders/999999/payment/999999/verify', { method: 'POST' }, person('sales_1').token);
    const stockWrite = await primary.apiFetch('/warehouses/stock-balances', { method: 'POST', data: {} }, person('sales_2').token);
    const warehouseOrder = await primary.apiFetch('/orders', { method: 'POST', data: {} }, person('warehouse_1').token);
    const statuses = [unauthorized.status, stockWrite.status, warehouseOrder.status];
    if (statuses.some((status) => status !== 403)) throw new Error('unexpected write authorization: ' + JSON.stringify(statuses));
    let privateCustomerStatus = null;
    if (cases?.items?.length >= 2) {
      const privateCustomer = await secondary.apiFetch('/customers/' + cases.items[0].customer.id, {}, person('sales_2').token);
      privateCustomerStatus = privateCustomer.status;
      if (![403, 404].includes(privateCustomerStatus)) throw new Error('sales peer can see another salesperson private customer: HTTP ' + privateCustomerStatus);
    }
    return { evidence: { deniedWriteStatuses: statuses, privateCustomerStatus } };
  });

  await step('buyers_approve_warehouse_receives_raw_material', ['buyer_1', 'buyer_2', 'warehouse_1', 'warehouse_4'], async () => {
    const name = 'E20-TEST-SUPPLIER-' + runKey;
    const supplier = requireSuccess(await primary.apiFetch('/procurement/suppliers', {
      method: 'POST',
      data: { name, nameZh: name, category: 'Raw Materials', riskLevel: 'low',
        contact: 'Synthetic supplier',
        addresses: [{ type: 'legal', label: 'factory', countryCode: 'CN', fullAddress: 'Synthetic supplier address' }],
        contacts: [{ name: 'Synthetic contact', phone: '0900000011', isPrimary: true }] },
    }, person('buyer_1').token), 'create supplier');
    const rawName = 'E20-TEST-RAW-' + runKey;
    const material = await ensureReleasedMaterial({
      request: (endpoint, options) => primary.apiFetch(endpoint, options, person('buyer_1').token),
      code: 'E20-PO-' + runKey, name: rawName,
    });
    const purchase = requireSuccess(await primary.apiFetch('/procurement/orders', {
      method: 'POST',
      data: { supplierId: Number(supplier.id), materialId: Number(material.id), item: rawName,
        quantity: 100, unit: 'kg', price: 4.6, eta: '2026-10-01',
        ...(cases?.items?.length ? { salesOrderId: Number(cases.items[0].order.id), isB2B: true } : {}) },
    }, person('buyer_1').token), 'create purchase order');
    requireSuccess(await primary.apiFetch('/procurement/orders/' + purchase.id + '/status', {
      method: 'PATCH', data: { status: 'approved' },
    }, person('buyer_2').token), 'approve purchase order');
    const receipt = requireSuccess(await primary.apiFetch('/procurement/orders/' + purchase.id + '/receipts', {
      method: 'POST', data: { quantity: 100, acceptedQuantity: 95, rejectedQuantity: 5,
        discrepancyType: 'quality_rejected', discrepancyReason: 'synthetic incoming inspection',
        batchNo: 'E20-PO-BATCH-' + runKey },
    }, person('warehouse_1').token), 'receive raw material');
    const ledger = await secondary.apiFetch('/warehouses/stock-entries?sourceType=procurement_receipt&limit=100', {}, person('warehouse_4').token);
    if (!ledger.ok || !receipt?.purchaseOrder?.id) throw new Error('purchase receipt or warehouse ledger readback missing');
    return { evidence: { supplierId: supplier.id, materialId: material.id, purchaseId: purchase.id, receiptCount: receipt.receipts?.length || 0, warehouseLedgerStatus: ledger.status } };
  });

  const productionOutcome = await step('synthetic_chemical_bom_qc_release_and_completion', ['warehouse_2', 'warehouse_3', 'production_1', 'production_2', 'production_3', 'quality'], async () => {
    const warehouse = await production.ensureWarehouseAndLocations(person('warehouse_2').token);
    const codes = Array.from({ length: 10 }, (_, i) => 'E20-RM-' + runKey + '-' + String(i + 1).padStart(2, '0'));
    const rawMaterials = [];
    for (let i = 0; i < codes.length; i += 1) {
      rawMaterials.push(await ensureReleasedMaterial({
        request: (endpoint, options) => primary.apiFetch(endpoint, options, person('production_1').token),
        code: codes[i], name: codes[i], category: 'raw_material',
      }));
    }
    const productName = 'E20-TEST-WATERBORNE-RESIN-' + runKey;
    const productMaterial = await ensureReleasedMaterial({
      request: (endpoint, options) => primary.apiFetch(endpoint, options, person('production_1').token),
      code: 'E20-FG-' + runKey, name: productName, category: 'finished_good', shelfLifeDays: 180,
    });
    const balances = [];
    for (let i = 0; i < codes.length; i += 1) {
      balances.push(await production.ensureRawStock(person(i < 5 ? 'warehouse_2' : 'warehouse_3').token, warehouse.locations['LOC-RAW'].id, codes[i], 50, 10 + i, rawMaterials[i].id));
    }
    const bom = await production.createBom(person('production_1').token, {
      materialId: productMaterial.id, productName, version: 'test-v1', bomType: 'chemical_formula', status: 'active',
      formulationMode: 'percentage', outputUnit: 'kg', standardBatchSize: 100, batchSizeUnit: 'kg',
      density: 1.08, solidContent: 57, shelfLifeDays: 180,
      effectiveFrom: '2026-09-01', effectiveTo: '2027-12-31',
      processJson: JSON.stringify({ stages: ['premix', 'disperse', 'filter', 'package'] }),
      qualitySpecJson: JSON.stringify({ controls: ['solids', 'viscosity', 'appearance'] }),
      qualityCharacteristics: [{ code: 'SOLIDS', name: 'Solid content', valueType: 'numeric',
        unit: '%', lowerLimit: 55, upperLimit: 59, testMethod: 'synthetic lab audit', required: true }],
      notes: 'synthetic test recipe; never a commercial formulation',
      items: codes.map((code, i) => ({
        materialId: rawMaterials[i].id, materialName: code, materialCode: code,
        ingredientRole: i === 0 ? 'main_resin' : 'additive',
        dosageMode: 'percentage', percentage: 10, quantityPerUnit: 0.1, unit: 'kg',
        lossRate: 0, processStage: 'premix',
      })),
    });
    const work = await production.createWorkOrder(person('production_2').token, {
      bomId: bom.id, productName, targetQuantity: 100, producedQuantity: 100, lossQuantity: 0,
      plannedStartAt: '2026-09-23T08:00:00.000Z', plannedEndAt: '2026-09-23T18:00:00.000Z',
      note: '20-staff synthetic production',
      steps: [{ stepNo: 1, title: 'premix' }, { stepNo: 2, title: 'disperse' }, { stepNo: 3, title: 'filter' }, { stepNo: 4, title: 'package' }],
    });
    await production.requestJson('PATCH', '/api/production/work-orders/' + work.id + '/status', {
      token: person('production_3').token, body: { status: 'qc_pending' }, expectedStatus: 200,
    });
    const characteristicId = bom.qualityCharacteristics?.[0]?.id;
    if (!characteristicId) throw new Error('structured QC characteristic missing from BOM');
    const qc = await production.requestJson('POST', '/api/production/work-orders/' + work.id + '/checks', {
      token: person('warehouse_3').token, expectedStatus: 201,
      body: { sampleNo: 'E20-QC-' + runKey, defectRate: 0,
        measurements: [{ characteristicId, measuredNumeric: '57', instrumentNo: 'SYNTHETIC-LAB-01' }] },
    });
    const qcId = qc.data?.data?.id;
    if (!qcId) throw new Error('quality inspection did not return an id');
    const review = await production.requestJson('POST', '/api/production/work-orders/' + work.id + '/checks/' + qcId + '/review', {
      token: person('quality').token, expectedStatus: 200,
      body: { decision: 'release', reviewNote: 'Independent synthetic QC review' },
    });
    if (review.data?.data?.status !== 'released') throw new Error('independent QC release missing');
    const preview = await production.getPreviewConsumption(person('production_3').token, work.id);
    if (preview.length !== 10 || preview.some((row) => Number(row.shortageQty || 0) !== 0)) throw new Error('production material preview missing or short');
    const records = preview.map((row) => ({
      stockBalanceId: row.pickList?.[0]?.stockBalanceId,
      quantity: Number(row.pickList?.[0]?.deductQty || row.requiredQty),
    }));
    if (records.some((row) => !row.stockBalanceId || !Number.isFinite(row.quantity))) throw new Error('production pick list incomplete');
    await production.completeWorkOrder(person('warehouse_3').token, work.id, { status: 'completed', consumptionRecords: records });
    const readback = await production.findWorkOrder(person('quality').token, productName, work.id);
    if (readback?.status !== 'completed' || !readback.productBatch?.id) throw new Error('production completion or batch readback mismatch');
    return { batchNo: readback.productBatch.batchNo,
      evidence: { bomId: bom.id, workOrderId: work.id, qcId, batchId: readback.productBatch.id, rawMaterialCount: balances.length } };
  });

  if (productionOutcome?.batchNo && cases?.items?.length) {
    await step('logistics_ship_warehouse_records_partial_customer_receipt', ['logistics', 'warehouse_4', 'owner'], async () => {
      const item = cases.items[0];
      const shipment = requireSuccess(await primary.apiFetch('/shipping', {
        method: 'POST', data: { customerId: Number(item.customer.id), orderId: Number(item.order.id),
          productName: 'E20-TEST-WATERBORNE-RESIN-' + runKey, quantity: 100, unit: 'kg',
          batchNo: productionOutcome.batchNo, carrier: 'E20-CARRIER', trackingNo: 'E20-' + runKey },
      }, person('logistics').token), 'create shipment');
      requireSuccess(await primary.apiFetch('/shipping/' + shipment.id + '/status', {
        method: 'PATCH', data: { status: 'in_transit', trackingNo: 'E20-' + runKey },
      }, person('logistics').token), 'dispatch shipment');
      const signed = requireSuccess(await secondary.apiFetch('/shipping/' + shipment.id + '/receipt-events', {
        method: 'POST', data: { quantity: 100, acceptedQuantity: 99, rejectedQuantity: 1,
          discrepancyType: 'customer_short_signed', discrepancyReason: 'synthetic short signed receipt',
          fileName: 'synthetic-pod.png', mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=' },
      }, person('warehouse_4').token), 'record customer receipt');
      const ledger = await primary.apiFetch('/warehouses/stock-entries?sourceType=shipping_issue&limit=100', {}, person('owner').token);
      if (!ledger.ok || !signed.shipment?.id) throw new Error('shipment ledger or customer receipt readback missing');
      return { evidence: { shipmentId: shipment.id, receiptCount: signed.receipts?.length || 0, ledgerStatus: ledger.status } };
    });
  }

  await step('20_independent_browser_sessions_visit_their_workspaces', positions.map((p) => p.job), async () => {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_AUDIT_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_AUDIT_EXECUTABLE_PATH } : {}),
      args: ['--no-sandbox'],
    });
    const screenshotDir = path.join(path.dirname(reportPath), 'staff20-screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const routeForJob = (job) => {
      if (job.startsWith('sales_')) return 'crm';
      if (job.startsWith('buyer_')) return 'procurement';
      if (job.startsWith('production_') || job === 'quality') return 'production';
      if (job.startsWith('warehouse_')) return 'warehouse';
      if (job === 'logistics') return 'shipping';
      if (job.startsWith('finance_') || job === 'collections') return 'collections';
      return 'dashboard';
    };
    const results = [];
    try {
      for (let i = 0; i < positions.length; i += 4) {
        const batch = await Promise.allSettled(positions.slice(i, i + 4).map(async (p, offset) => {
          const session = person(p.job);
          const context = await browser.newContext({
            viewport: { width: (i + offset) % 3 === 0 ? 390 : 1366, height: 800 },
          });
          try {
            const page = await context.newPage();
            const uncaught = [];
            page.on('pageerror', (error) => uncaught.push(String(error.message || error).slice(0, 160)));
            await page.addInitScript(({ token, user }) => {
              for (const key of ['token', 'auth_token', 'erp_auth_token']) localStorage.setItem(key, token);
              for (const key of ['user', 'currentUser', 'erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
              localStorage.setItem('ailao.language', 'zh');
            }, { token: session.token, user: session.user });
            const route = routeForJob(p.job);
            const base = (i + offset) % 2 ? secondaryUrl : primaryUrl;
            await page.goto(base + '/#' + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(() =>
              document.body?.innerText.length > 100 && !document.querySelector('input[type="password"]'),
            null, { timeout: 20000 });
            const search = page.locator('input[type="search"]:visible').first();
            if (await search.count() && await search.isEnabled()) {
              await search.fill('E20-SYNTHETIC-NO-RESULTS');
              await search.fill('');
            }
            if (uncaught.length) throw new Error('uncaught browser error: ' + uncaught[0]);
            const screenshot = path.join(screenshotDir, p.job + '.png');
            await page.screenshot({ path: screenshot, fullPage: false });
            return { job: p.job, route, url: base, screenshot: path.relative(path.dirname(reportPath), screenshot) };
          } finally {
            await context.close();
          }
        }));
        for (let offset = 0; offset < batch.length; offset += 1) {
          const item = batch[offset];
          if (item.status === 'fulfilled') results.push(item.value);
          else results.push({ job: positions[i + offset].job, error: String(item.reason?.message || item.reason).slice(0, 300) });
        }
      }
    } finally {
      await browser.close();
    }
    if (results.length !== 20 || results.some((row) => row.error)) {
      throw new Error('browser session failures: ' + JSON.stringify(results.filter((row) => row.error)));
    }
    return { evidence: { completed: results.length, routes: results.map(({ job, route }) => ({ job, route })),
      screenshotFolder: path.relative(path.dirname(reportPath), screenshotDir) } };
  });

  report.finishedAt = new Date().toISOString();
  report.summary = {
    configuredStaff: positions.length,
    authenticatedStaff: sessions.size,
    passedSteps: report.steps.filter((item) => item.status === 'passed').length,
    failedSteps: report.steps.filter((item) => item.status === 'failed').length,
  };
  report.status = report.summary.failedSteps ? 'failed' : 'passed';
  save();
  console.log('20-staff audit: ' + report.status + ' (' + report.summary.passedSteps + ' passed, ' + report.summary.failedSteps + ' failed); report=' + reportPath);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  report.status = 'failed';
  report.findings.push({ name: 'setup', message: String(error?.message || error).slice(0, 500) });
  report.finishedAt = new Date().toISOString();
  save();
  console.error('20-staff audit failed: ' + String(error?.message || error));
  process.exitCode = 1;
});
