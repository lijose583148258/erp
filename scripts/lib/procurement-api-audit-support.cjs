function createProcurementAuditData(runId) {
  const RUN_ID = runId;
  return {
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
}

function createProcurementApiAuditSupport({ appUrl, data, runId, prisma }) {
  const APP_URL = appUrl;
  const DATA = data;
  const RUN_ID = runId;

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
  
  async function assertNoPurchaseOrderByItem(token, item) {
    if (!item) return;
    const response = await apiFetch(`/procurement/orders?search=${encodeURIComponent(item)}&pageSize=50`, {}, token);
    if (!response.ok) {
      throw new Error(`非法采购单回读检查失败: ${response.status} — ${JSON.stringify(response.json)}`);
    }
    const found = unwrapList(response).find((row) => String(row.item) === String(item));
    if (found) {
      throw new Error(`非法采购单被写入数据库: ${JSON.stringify(found)}`);
    }
  }
  
  async function assertPurchaseOrderCreateRejected(token, label, payload, expectedStatus) {
    const response = await apiFetch('/procurement/orders', {
      method: 'POST',
      data: payload,
    }, token);
    if (response.status !== expectedStatus) {
      throw new Error(`${label} 期望 HTTP ${expectedStatus}，实际 ${response.status} — ${JSON.stringify(response.json)}`);
    }
    await assertNoPurchaseOrderByItem(token, payload.item);
    return response.status;
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

  return {
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
  };
}

module.exports = {
  createProcurementAuditData,
  createProcurementApiAuditSupport,
};
