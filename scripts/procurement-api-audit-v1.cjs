/**
 * 采购 API 全链路审计（纯 fetch，不依赖浏览器）
 * 链路：login → 创建供应商 → 创建采购单 → 回读 → 审批 → 发货 → 收货入库 → 库存回读 → B2B 同步收货
 */
const fs = require('fs');
const path = require('path');
const {
  createProcurementApiAuditSupport,
  createProcurementAuditData,
} = require('./lib/procurement-api-audit-support.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const runtimeDbPath = process.env.AILAODA_RUNTIME_DB_PATH || 'D:/AilaoDaRuntime/stable.db';
const runtimeDatabaseUrl = `file:${runtimeDbPath.replace(/\\/g, '/')}`;
process.env.DATABASE_URL = runtimeDatabaseUrl;

const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'procurement-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: runtimeDatabaseUrl,
    },
  },
});

const DATA = createProcurementAuditData(RUN_ID);

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

const {
  apiFetch,
  unwrapList,
  expectedLandedCost,
  procurementCostPayload,
  assertPurchaseOrderCreateRejected,
  createSalesOrder,
  createAuditCustomer,
  verifyProcurementReceipt,
  verifyProcurementReceiptCost,
  login,
} = createProcurementApiAuditSupport({
  appUrl: APP_URL,
  data: DATA,
  runId: RUN_ID,
  prisma,
});

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

    const validOrderBase = {
      supplierId: Number(supplier.id),
      salesOrderId: Number(salesOrder.id),
      quantity: 1,
      unit: 'kg',
      ...procurementCostPayload(),
      eta: '2026-04-30',
    };
    const invalidCreateStatuses = {
      missingSupplier: await assertPurchaseOrderCreateRejected(manager.token, '无供应商采购单', {
        ...validOrderBase,
        supplierId: 999999999,
        item: `API-PO-BAD-SUP-${RUN_ID}`,
      }, 404),
      emptyItem: await assertPurchaseOrderCreateRejected(manager.token, '空物料采购单', {
        ...validOrderBase,
        item: '',
      }, 400),
      negativeQuantity: await assertPurchaseOrderCreateRejected(manager.token, '负数量采购单', {
        ...validOrderBase,
        item: `API-PO-BAD-QTY-${RUN_ID}`,
        quantity: -1,
      }, 400),
      negativePrice: await assertPurchaseOrderCreateRejected(manager.token, '负价格采购单', {
        ...validOrderBase,
        item: `API-PO-BAD-PRICE-${RUN_ID}`,
        price: -1,
      }, 400),
      invalidExchangeRate: await assertPurchaseOrderCreateRejected(manager.token, '无效汇率采购单', {
        ...validOrderBase,
        item: `API-PO-BAD-FX-${RUN_ID}`,
        currency: 'USD',
        exchangeRate: 0,
      }, 400),
      negativeCost: await assertPurchaseOrderCreateRejected(manager.token, '负附加成本采购单', {
        ...validOrderBase,
        item: `API-PO-BAD-COST-${RUN_ID}`,
        freightCost: -1,
      }, 400),
      invalidEta: await assertPurchaseOrderCreateRejected(manager.token, '无效 ETA 采购单', {
        ...validOrderBase,
        item: `API-PO-BAD-ETA-${RUN_ID}`,
        eta: 'not-a-date',
      }, 400),
      directReceived: await assertPurchaseOrderCreateRejected(manager.token, '直建已收货采购单', {
        ...validOrderBase,
        item: `API-PO-BAD-RECEIVED-${RUN_ID}`,
        status: 'received',
      }, 409),
    };
    recordStep({
      step: 'block-invalid-purchase-order-create',
      result: 'passed',
      statuses: invalidCreateStatuses,
    });

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
