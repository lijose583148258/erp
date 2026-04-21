/**
 * 采购 API 全链路审计（纯 fetch，不依赖浏览器）
 * 链路：login → 创建供应商 → 创建采购单 → 回读 → 审批 → 发货 → 收货入库 → 库存回读 → B2B 同步收货
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'procurement-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const prisma = new PrismaClient();

const DATA = {
  supplierName: `API-SUP-${RUN_ID}`,
  supplierCategory: 'Raw Materials',
  supplierContact: `Buyer-API-${RUN_ID.slice(-4)}`,
  supplierPhone: `09${RUN_ID.slice(-8)}`,
  supplierEmail: `api-audit-${RUN_ID}@example.com`,
  customerName: `API-CUS-${RUN_ID}`,
  purchaseItem: `API-PO-ITEM-${RUN_ID}`,
  purchaseQuantity: 15,
  purchasePrice: 14,
  purchaseCurrency: 'USD',
  purchaseExchangeRate: 0.14,
  purchaseTaxRate: 10,
  purchaseFreightCost: 100,
  purchaseDutyCost: 50,
  purchaseInsuranceCost: 25,
  purchaseOtherCost: 5,
  syncPurchaseItem: `API-PO-SYNC-ITEM-${RUN_ID}`,
  syncPurchaseQuantity: 7,
  racePurchaseItem: `API-PO-RACE-ITEM-${RUN_ID}`,
  racePurchaseQuantity: 5,
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function expectedLandedCost(quantity) {
  const itemAmount = DATA.purchasePrice * quantity;
  const baseItemAmount = DATA.purchaseCurrency === 'CNY'
    ? itemAmount
    : itemAmount / DATA.purchaseExchangeRate;
  const taxAmount = baseItemAmount * (DATA.purchaseTaxRate / 100);
  const landedCostAmount = roundMoney(
    baseItemAmount
    + taxAmount
    + DATA.purchaseFreightCost
    + DATA.purchaseDutyCost
    + DATA.purchaseInsuranceCost
    + DATA.purchaseOtherCost,
  );
  return {
    landedCostAmount,
    landedUnitCost: quantity > 0 ? roundMoney(landedCostAmount / quantity) : 0,
  };
}

function procurementCostPayload() {
  return {
    price: DATA.purchasePrice,
    currency: DATA.purchaseCurrency,
    exchangeRate: DATA.purchaseExchangeRate,
    taxRate: DATA.purchaseTaxRate,
    freightCost: DATA.purchaseFreightCost,
    dutyCost: DATA.purchaseDutyCost,
    insuranceCost: DATA.purchaseInsuranceCost,
    otherCost: DATA.purchaseOtherCost,
  };
}

async function createSalesOrder(token, customerId, productName, notes) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName,
        specification: 'API-LINK',
        quantity: 3,
        unit: '件',
        unitPrice: 980,
      }],
      paymentTerms: 30,
      notes,
    },
  }, token);

  if (!response.ok) {
    throw new Error(`关联销售订单创建失败: ${response.status} — ${JSON.stringify(response.json)}`);
  }

  const salesOrder = response.json?.data;
  if (!salesOrder?.id) {
    throw new Error('关联销售订单创建返回空 ID');
  }

  return salesOrder;
}

async function createAuditCustomer(token) {
  const response = await apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Customer-EN-${RUN_ID}`,
      nameVi: `Khach-Hang-${RUN_ID}`,
      licenseNumber: `LIC-${RUN_ID}`,
      creditLimit: 100000000,
      riskLevel: 'low',
      segment: 'mixed',
      poolState: 'private',
      contactName: `Contact-${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      contactEmail: `customer-${RUN_ID}@example.com`,
      addresses: [{
        id: `addr-${RUN_ID}`,
        type: 'legal',
        label: '注册地址',
        countryCode: 'VN',
        city: 'Hanoi',
        fullAddress: 'Audit Legal Address, Hanoi',
        isPrimary: true,
      }],
      contacts: [{
        name: `Contact-${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        email: `customer-${RUN_ID}@example.com`,
        language: 'zh',
        isPrimary: true,
      }],
      notes: `采购 API 审计专用客户 ${RUN_ID}`,
    },
  }, token);

  if (!response.ok) {
    throw new Error(`创建审计客户失败: ${response.status} — ${JSON.stringify(response.json)}`);
  }

  const customer = response.json?.data;
  if (!customer?.id) {
    throw new Error('审计客户创建返回空 ID');
  }

  return customer;
}

async function verifyProcurementReceipt(token, purchaseOrderId, productName, expectedQuantity) {
  const sourceRef = `PO-${purchaseOrderId}`;

  const balanceResponse = await apiFetch(
    `/warehouses/stock-balances?productName=${encodeURIComponent(productName)}&batchNo=${encodeURIComponent(sourceRef)}&pageSize=100`,
    {},
    token,
  );
  if (!balanceResponse.ok) {
    throw new Error(`库存余额回读失败: ${balanceResponse.status}`);
  }
  const balances = unwrapList(balanceResponse).filter((item) => (
    String(item.productName) === String(productName) && String(item.batchNo) === sourceRef
  ));
  const totalQuantity = balances.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (totalQuantity < Number(expectedQuantity)) {
    throw new Error(`采购入库库存不足，期望至少 ${expectedQuantity}，实际 ${totalQuantity}`);
  }
  const rawLocation = balances.find((item) => String(item.locationCode || '') === 'LOC-RAW');
  if (!rawLocation) {
    throw new Error(`采购入库未进入原料区 LOC-RAW: ${JSON.stringify(balances)}`);
  }

  const entryResponse = await apiFetch(
    `/warehouses/stock-entries?sourceType=procurement_receipt&sourceRef=${encodeURIComponent(sourceRef)}&limit=200`,
    {},
    token,
  );
  if (!entryResponse.ok) {
    throw new Error(`库存凭证回读失败: ${entryResponse.status}`);
  }
  const receiptEntries = unwrapList(entryResponse).filter((entry) => (
    String(entry.sourceType) === 'procurement_receipt' && String(entry.sourceRef) === sourceRef
  ));
  if (receiptEntries.length !== 1) {
    throw new Error(`采购入库凭证数量异常，期望 1，实际 ${receiptEntries.length} (${sourceRef})`);
  }

  const receiptEntry = receiptEntries[0];
  const movement = Array.isArray(receiptEntry.movements)
    ? receiptEntry.movements.find((item) => (
        String(item.productName) === String(productName)
        && String(item.batchNo) === sourceRef
        && Number(item.quantityDelta || 0) === Number(expectedQuantity)
      ))
    : null;
  if (!movement) {
    throw new Error(`采购入库凭证缺少匹配明细: ${sourceRef}`);
  }

  return {
    sourceRef,
    entryNo: receiptEntry.entryNo,
    entryCount: receiptEntries.length,
    totalQuantity,
    locationCode: rawLocation.locationCode,
    locationName: rawLocation.locationName,
  };
}

async function verifyProcurementReceiptCost(batchNo, expectedQuantity, expectedUnitCost, expectedCost) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT l.id,
            l.ledger_no AS ledgerNo,
            l.source_type AS sourceType,
            l.source_ref AS sourceRef,
            l.quantity_delta AS quantityDelta,
            l.cost_amount_delta AS costAmountDelta,
            l.unit_cost AS unitCost,
            b.batch_no AS batchNo,
            b.product_name AS productName
       FROM inventory_cost_ledgers l
       JOIN product_batches b ON b.id = l.batch_id
      WHERE b.batch_no = ?
      ORDER BY l.id ASC`,
    batchNo,
  );

  const matchingRows = rows.filter((row) => (
    String(row.sourceType) === 'inventory_adjustment'
    && Math.abs(Number(row.quantityDelta || 0) - Number(expectedQuantity)) < 0.000001
    && Math.abs(Number(row.costAmountDelta || 0) - expectedCost) < 0.01
    && Math.abs(Number(row.unitCost || 0) - expectedUnitCost) < 0.01
  ));

  if (matchingRows.length !== 1) {
    throw new Error(`采购入库成本台账异常，批次 ${batchNo} 期望数量 ${expectedQuantity}、成本 ${expectedCost}，实际 ${JSON.stringify(rows)}`);
  }

  return {
    batchNo,
    ledgerNo: matchingRows[0].ledgerNo,
    sourceType: matchingRows[0].sourceType,
    quantityDelta: Number(matchingRows[0].quantityDelta || 0),
    costAmountDelta: Number(matchingRows[0].costAmountDelta || 0),
    unitCost: Number(matchingRows[0].unitCost || 0),
  };
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

async function run() {
  try {
    // 步骤 1：管理员登录
    const manager = await login('manager', 'manager123');
    recordStep({ step: 'login-manager', result: 'passed', userId: manager.user.id });

    // 步骤 2：创建供应商
    const createSupplier = await apiFetch('/procurement/suppliers', {
      method: 'POST',
      data: {
        name: DATA.supplierName,
        nameZh: DATA.supplierName,
        nameEn: `Supplier-EN-${RUN_ID}`,
        category: DATA.supplierCategory,
        contactPerson: DATA.supplierContact,
        phone: DATA.supplierPhone,
        email: DATA.supplierEmail,
        addresses: [{
          label: '注册地址',
          countryCode: 'VN',
          city: 'Hanoi',
          fullAddress: 'Cau Giay District, Hanoi',
        }],
      },
    }, manager.token);
    if (!createSupplier.ok) {
      throw new Error(`创建供应商失败: ${createSupplier.status} — ${JSON.stringify(createSupplier.json)}`);
    }
    const supplier = createSupplier.json?.data;
    if (!supplier?.id) {
      throw new Error('供应商创建返回空 ID');
    }
    report.supplier = { id: String(supplier.id), name: supplier.name || DATA.supplierName };
    recordStep({ step: 'create-supplier', result: 'passed', supplierId: supplier.id });

    // 步骤 3：验证供应商回读
    const supplierList = await apiFetch(`/procurement/suppliers?search=${encodeURIComponent(DATA.supplierName)}`, {}, manager.token);
    if (!supplierList.ok) {
      throw new Error(`供应商列表获取失败: ${supplierList.status}`);
    }
    const suppliers = unwrapList(supplierList);
    const foundSupplier = suppliers.find((item) => String(item.id) === String(supplier.id));
    if (!foundSupplier) {
      throw new Error('供应商回读未找到');
    }
    recordStep({ step: 'verify-supplier-readback', result: 'passed', supplierId: supplier.id });

    // 步骤 4：确保有可用的销售订单
    const sales = await login('sales', 'sales123');
    const auditCustomer = await createAuditCustomer(sales.token);
    report.customer = { id: String(auditCustomer.id), name: auditCustomer.name || DATA.customerName };
    recordStep({ step: 'create-audit-customer', result: 'passed', customerId: auditCustomer.id });

    const salesOrder = await createSalesOrder(
      sales.token,
      auditCustomer.id,
      `PO-LINKED-SO-${RUN_ID}`,
      `采购审计关联订单 ${RUN_ID}`,
    );
    report.salesOrder = { id: String(salesOrder.id), orderNo: salesOrder.orderNo };
    recordStep({ step: 'ensure-sales-order', result: 'passed', orderId: salesOrder.id });

    // 步骤 5：创建采购单
    const createPO = await apiFetch('/procurement/orders', {
      method: 'POST',
      data: {
        supplierId: Number(supplier.id),
        salesOrderId: Number(salesOrder.id),
        item: DATA.purchaseItem,
        quantity: DATA.purchaseQuantity,
        unit: 'kg',
        ...procurementCostPayload(),
        eta: '2026-04-30',
      },
    }, manager.token);
    if (!createPO.ok) {
      throw new Error(`创建采购单失败: ${createPO.status} — ${JSON.stringify(createPO.json)}`);
    }
    const purchaseOrder = createPO.json?.data;
    if (!purchaseOrder?.id) {
      throw new Error('采购单创建返回空 ID');
    }
    report.purchaseOrder = {
      id: String(purchaseOrder.id),
      status: purchaseOrder.status,
    };
    recordStep({ step: 'create-purchase-order', result: 'passed', purchaseOrderId: purchaseOrder.id });

    // 步骤 6：回读验证
    const poList = await apiFetch('/procurement/orders?pageSize=50', {}, manager.token);
    if (!poList.ok) {
      throw new Error(`采购单列表获取失败: ${poList.status}`);
    }
    const orders = unwrapList(poList);
    const foundPO = orders.find((item) => String(item.id) === String(purchaseOrder.id));
    if (!foundPO) {
      throw new Error('采购单回读未找到');
    }
    const expectedMainCost = expectedLandedCost(DATA.purchaseQuantity);
    if (
      String(foundPO.currency) !== DATA.purchaseCurrency
      || Math.abs(Number(foundPO.landedUnitCost || 0) - expectedMainCost.landedUnitCost) > 0.01
      || Math.abs(Number(foundPO.landedCostAmount || 0) - expectedMainCost.landedCostAmount) > 0.01
    ) {
      throw new Error(`采购到岸成本回读异常: ${JSON.stringify({ foundPO, expectedMainCost })}`);
    }
    recordStep({ step: 'verify-po-readback', result: 'passed', purchaseOrderId: purchaseOrder.id });

    // 步骤 7：审批采购单
    const approvePO = await apiFetch(`/procurement/orders/${purchaseOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'approved' },
    }, manager.token);
    if (!approvePO.ok) {
      throw new Error(`审批采购单失败: ${approvePO.status}`);
    }
    recordStep({ step: 'approve-purchase-order', result: 'passed', purchaseOrderId: purchaseOrder.id });

    // 步骤 8：发货
    const dispatchPO = await apiFetch(`/procurement/orders/${purchaseOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    }, manager.token);
    if (!dispatchPO.ok) {
      throw new Error(`发货失败: ${dispatchPO.status}`);
    }
    recordStep({ step: 'dispatch-purchase-order', result: 'passed', purchaseOrderId: purchaseOrder.id });

    // 步骤 9：收货并生成库存凭证
    const receivePO = await apiFetch(`/procurement/orders/${purchaseOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'received' },
    }, manager.token);
    if (!receivePO.ok) {
      throw new Error(`收货失败: ${receivePO.status} — ${JSON.stringify(receivePO.json)}`);
    }
    recordStep({ step: 'receive-purchase-order', result: 'passed', purchaseOrderId: purchaseOrder.id });

    // 步骤 10：库存余额与库存凭证回读
    const receiptEvidence = await verifyProcurementReceipt(
      manager.token,
      purchaseOrder.id,
      DATA.purchaseItem,
      DATA.purchaseQuantity,
    );
    const receiptCostEvidence = await verifyProcurementReceiptCost(
      receiptEvidence.sourceRef,
      DATA.purchaseQuantity,
      expectedMainCost.landedUnitCost,
      expectedMainCost.landedCostAmount,
    );
    report.receiptEvidence = receiptEvidence;
    report.receiptCostEvidence = receiptCostEvidence;
    recordStep({ step: 'verify-procurement-receipt-stock', result: 'passed', ...receiptEvidence });
    recordStep({ step: 'verify-procurement-receipt-cost', result: 'passed', ...receiptCostEvidence });

    // 步骤 11：重复收货不得重复入库
    const duplicateReceive = await apiFetch(`/procurement/orders/${purchaseOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'received' },
    }, manager.token);
    if (!duplicateReceive.ok && duplicateReceive.status !== 409) {
      throw new Error(`重复收货返回异常: ${duplicateReceive.status} — ${JSON.stringify(duplicateReceive.json)}`);
    }
    const duplicateEvidence = await verifyProcurementReceipt(
      manager.token,
      purchaseOrder.id,
      DATA.purchaseItem,
      DATA.purchaseQuantity,
    );
    if (duplicateEvidence.entryCount !== receiptEvidence.entryCount) {
      throw new Error(`重复收货后凭证数量异常: ${duplicateEvidence.entryCount}`);
    }
    recordStep({
      step: 'verify-receipt-idempotency',
      result: 'passed',
      duplicateStatus: duplicateReceive.status,
      sourceRef: duplicateEvidence.sourceRef,
    });

    // 步骤 12：B2B 销售状态 delivered 同步为采购 received，并自动入库
    const syncSalesOrder = await createSalesOrder(
      sales.token,
      auditCustomer.id,
      `PO-SYNC-SO-${RUN_ID}`,
      `采购 B2B 同步审计 ${RUN_ID}`,
    );
    const syncPOResponse = await apiFetch('/procurement/orders', {
      method: 'POST',
      data: {
        supplierId: Number(supplier.id),
        salesOrderId: Number(syncSalesOrder.id),
        item: DATA.syncPurchaseItem,
        quantity: DATA.syncPurchaseQuantity,
        unit: 'kg',
        ...procurementCostPayload(),
        eta: '2026-05-05',
        isB2B: true,
      },
    }, manager.token);
    if (!syncPOResponse.ok) {
      throw new Error(`创建 B2B 同步采购单失败: ${syncPOResponse.status} — ${JSON.stringify(syncPOResponse.json)}`);
    }
    const syncPurchaseOrder = syncPOResponse.json?.data;
    if (!syncPurchaseOrder?.id) {
      throw new Error('B2B 同步采购单创建返回空 ID');
    }

    const b2bStatusBefore = await apiFetch(`/procurement/b2b-status/${syncSalesOrder.id}`, {}, manager.token);
    if (!b2bStatusBefore.ok || !b2bStatusBefore.json?.data?.linked) {
      throw new Error(`B2B 状态回读失败: ${b2bStatusBefore.status} — ${JSON.stringify(b2bStatusBefore.json)}`);
    }

    const syncB2B = await apiFetch(`/procurement/sync-b2b/${syncSalesOrder.id}`, {
      method: 'POST',
      data: { salesStatus: 'delivered' },
    }, manager.token);
    if (!syncB2B.ok) {
      throw new Error(`B2B 同步失败: ${syncB2B.status} — ${JSON.stringify(syncB2B.json)}`);
    }
    const syncedPO = syncB2B.json?.data?.purchaseOrder;
    if (String(syncedPO?.status) !== 'received') {
      throw new Error(`B2B 同步后期望 received，实际 ${syncedPO?.status}`);
    }
    const syncReceiptEvidence = await verifyProcurementReceipt(
      manager.token,
      syncPurchaseOrder.id,
      DATA.syncPurchaseItem,
      DATA.syncPurchaseQuantity,
    );
    const syncReceiptCostEvidence = await verifyProcurementReceiptCost(
      syncReceiptEvidence.sourceRef,
      DATA.syncPurchaseQuantity,
      expectedLandedCost(DATA.syncPurchaseQuantity).landedUnitCost,
      expectedLandedCost(DATA.syncPurchaseQuantity).landedCostAmount,
    );
    report.b2bSync = {
      salesOrderId: String(syncSalesOrder.id),
      purchaseOrderId: String(syncPurchaseOrder.id),
      receiptEvidence: syncReceiptEvidence,
      receiptCostEvidence: syncReceiptCostEvidence,
    };
    recordStep({ step: 'verify-b2b-sync-receipt-stock', result: 'passed', ...syncReceiptEvidence });
    recordStep({ step: 'verify-b2b-sync-receipt-cost', result: 'passed', ...syncReceiptCostEvidence });

    // 步骤 13：并发收货不得重复入库
    const raceSalesOrder = await createSalesOrder(
      sales.token,
      auditCustomer.id,
      `PO-RACE-SO-${RUN_ID}`,
      `采购并发收货审计 ${RUN_ID}`,
    );
    const racePOResponse = await apiFetch('/procurement/orders', {
      method: 'POST',
      data: {
        supplierId: Number(supplier.id),
        salesOrderId: Number(raceSalesOrder.id),
        item: DATA.racePurchaseItem,
        quantity: DATA.racePurchaseQuantity,
        unit: 'kg',
        ...procurementCostPayload(),
        eta: '2026-05-10',
        isB2B: true,
      },
    }, manager.token);
    if (!racePOResponse.ok) {
      throw new Error(`创建并发收货采购单失败: ${racePOResponse.status} — ${JSON.stringify(racePOResponse.json)}`);
    }
    const racePurchaseOrder = racePOResponse.json?.data;
    if (!racePurchaseOrder?.id) {
      throw new Error('并发收货采购单创建返回空 ID');
    }

    const raceApprove = await apiFetch(`/procurement/orders/${racePurchaseOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'approved' },
    }, manager.token);
    if (!raceApprove.ok) {
      throw new Error(`并发收货采购单审批失败: ${raceApprove.status}`);
    }
    const raceDispatch = await apiFetch(`/procurement/orders/${racePurchaseOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    }, manager.token);
    if (!raceDispatch.ok) {
      throw new Error(`并发收货采购单发货失败: ${raceDispatch.status}`);
    }

    const raceResponses = await Promise.all([
      apiFetch(`/procurement/orders/${racePurchaseOrder.id}/status`, {
        method: 'PATCH',
        data: { status: 'received' },
      }, manager.token),
      apiFetch(`/procurement/orders/${racePurchaseOrder.id}/status`, {
        method: 'PATCH',
        data: { status: 'received' },
      }, manager.token),
    ]);
    const raceStatuses = raceResponses.map((item) => item.status);
    const invalidRaceStatus = raceResponses.find((item) => !item.ok && item.status !== 409);
    if (invalidRaceStatus) {
      throw new Error(`并发收货返回异常: ${raceStatuses.join(',')} — ${JSON.stringify(invalidRaceStatus.json)}`);
    }
    if (!raceResponses.some((item) => item.ok)) {
      throw new Error(`并发收货没有任何一次成功: ${raceStatuses.join(',')}`);
    }
    const raceReceiptEvidence = await verifyProcurementReceipt(
      manager.token,
      racePurchaseOrder.id,
      DATA.racePurchaseItem,
      DATA.racePurchaseQuantity,
    );
    const raceReceiptCostEvidence = await verifyProcurementReceiptCost(
      raceReceiptEvidence.sourceRef,
      DATA.racePurchaseQuantity,
      expectedLandedCost(DATA.racePurchaseQuantity).landedUnitCost,
      expectedLandedCost(DATA.racePurchaseQuantity).landedCostAmount,
    );
    report.raceReceive = {
      salesOrderId: String(raceSalesOrder.id),
      purchaseOrderId: String(racePurchaseOrder.id),
      statuses: raceStatuses,
      receiptEvidence: raceReceiptEvidence,
      receiptCostEvidence: raceReceiptCostEvidence,
    };
    recordStep({
      step: 'verify-concurrent-receive-idempotency',
      result: 'passed',
      statuses: raceStatuses,
      ...raceReceiptEvidence,
    });
    recordStep({ step: 'verify-concurrent-receive-cost', result: 'passed', ...raceReceiptCostEvidence });

    // 步骤 14：最终状态验证
    const finalList = await apiFetch('/procurement/orders?pageSize=50', {}, manager.token);
    if (!finalList.ok) {
      throw new Error(`最终列表获取失败: ${finalList.status}`);
    }
    const finalOrders = unwrapList(finalList);
    const finalPO = finalOrders.find((item) => String(item.id) === String(purchaseOrder.id));
    if (!finalPO) {
      throw new Error('最终回读未找到采购单');
    }
    if (String(finalPO.status) !== 'received') {
      throw new Error(`期望 received，实际 ${finalPO.status}`);
    }
    report.purchaseOrder.status = finalPO.status;
    recordStep({
      step: 'verify-final-status',
      result: 'passed',
      purchaseOrderId: purchaseOrder.id,
      status: finalPO.status,
    });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    await prisma.$disconnect();
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || '采购 API 审计失败');
    process.exit(1);
  }

  console.log(`Procurement API audit passed. Report: ${REPORT_PATH}`);
}

run();
