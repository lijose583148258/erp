async function createAuditCustomer({
  page,
  apiFetch,
  data,
  runId,
  token,
}) {
  const payload = await apiFetch(page, '/customers', {
    method: 'POST',
    data: {
      nameZh: data.customerName,
      nameEn: `Shipping Browser Customer ${runId}`,
      nameVi: `Khach Giao Hang Browser ${runId}`,
      licenseNumber: `SHIP-BROWSER-LIC-${runId}`,
      creditLimit: 100000000,
      riskLevel: 'low',
      segment: 'mixed',
      poolState: 'private',
      contactName: `Browser Ship Contact ${runId.slice(-4)}`,
      contactPhone: `09${runId.slice(-8)}`,
      contactEmail: `shipping-browser-${runId}@example.com`,
      addresses: [{
        id: `ship-browser-addr-${runId}`,
        type: 'shipping',
        label: '发货地址',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Browser Audit Shipping Address, Ho Chi Minh City',
        isPrimary: true,
      }],
      contacts: [{
        name: `Browser Ship Contact ${runId.slice(-4)}`,
        phone: `09${runId.slice(-8)}`,
        email: `shipping-browser-${runId}@example.com`,
        language: 'zh',
        isPrimary: true,
      }],
      notes: `发货浏览器审计专用客户 ${runId}`,
    },
  }, token);
  if (!payload.ok) throw new Error(`create audit customer failed: ${payload.status}`);
  const customer = payload.json?.data;
  if (!customer?.id) throw new Error('create audit customer returned empty id');
  return customer;
}

async function resolveLocation({
  page,
  apiFetch,
  unwrapList,
  locationCode,
}) {
  const payload = await apiFetch(page, '/warehouses');
  if (!payload.ok) throw new Error(`warehouse list failed: ${payload.status}`);
  const warehouses = unwrapList(payload);
  for (const warehouse of warehouses) {
    const locations = Array.isArray(warehouse.locations) ? warehouse.locations : [];
    const location = locations.find((item) => String(item.code) === locationCode);
    if (location) return location;
  }

  let warehouse = warehouses[0];
  if (!warehouse) {
    const warehousePayload = await apiFetch(page, '/warehouses', {
      method: 'POST',
      data: { code: 'WH-SHIP-AUDIT', name: 'Shipping Audit Warehouse', type: 'physical' },
    });
    if (!warehousePayload.ok) throw new Error(`shipping warehouse fixture create failed: ${warehousePayload.status}`);
    warehouse = warehousePayload.json?.data;
  }
  if (!warehouse?.id) throw new Error('shipping warehouse fixture id missing');

  const locationPayload = await apiFetch(page, `/warehouses/${warehouse.id}/locations`, {
    method: 'POST',
    data: { code: locationCode, name: 'Finished Goods Audit Location', type: 'internal' },
  });
  if (!locationPayload.ok) throw new Error(`location ${locationCode} fixture create failed: ${locationPayload.status}`);
  return locationPayload.json?.data;
}

async function seedShipmentStock({
  page,
  apiFetch,
  unwrapList,
  data,
  runId,
  report,
  timebox,
  timeouts,
}) {
  return timebox(page, 'seed-linked-shipment-stock', timeouts.api, async () => {
    if (!Number.isFinite(data.unitCost) || data.unitCost < 0) {
      throw new Error('shipping stock fixture requires an explicit nonnegative unitCost');
    }
    const location = await resolveLocation({
      page,
      apiFetch,
      unwrapList,
      locationCode: 'LOC-FG',
    });
    const payload = await apiFetch(page, '/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(location.id),
        materialId: Number(data.materialId),
        productName: data.linkedProduct,
        batchNo: data.batchNo,
        quantity: data.stockQuantity,
        unitCost: data.unitCost,
        unit: 'kg',
        sourceRef: `shipping-browser-audit:${runId}`,
        reason: 'shipping_browser_seed_stock',
        note: `Shipping browser audit seed ${runId}`,
      },
    });
    if (!payload.ok) throw new Error(`seed linked shipment stock failed: ${payload.status}`);
    report.seededStock = {
      locationId: String(location.id),
      locationCode: location.code,
      productName: data.linkedProduct,
      batchNo: data.batchNo,
      quantity: data.stockQuantity,
      unitCost: data.unitCost,
      costAmount: data.stockQuantity * data.unitCost,
    };
  });
}

async function createConfirmedShippingOrder({
  page,
  apiFetch,
  data,
  runId,
  report,
  managerAuth,
  getSalesAuth,
  timebox,
  timeouts,
}) {
  return timebox(page, 'ensure-confirmed-shipping-order', timeouts.api, async () => {
    const sales = await getSalesAuth();
    const customer = await createAuditCustomer({
      page,
      apiFetch,
      data,
      runId,
      token: sales.token,
    });

    const createOrderPayload = await apiFetch(page, '/orders', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        items: [
          {
            materialId: Number(data.materialId),
            productName: data.linkedProduct,
            specification: 'AUTO-SHIPPING',
            quantity: data.quantity,
            unit: 'kg',
            unitPrice: 260,
          },
        ],
        paymentTerms: 30,
        notes: `Shipping audit ${runId}`,
      },
    }, sales.token);

    if (!createOrderPayload.ok) {
      throw new Error(`create shipping order failed: ${createOrderPayload.status}`);
    }

    const createdOrder = createOrderPayload.json?.data;
    if (!createdOrder?.id) throw new Error('shipping order create returned empty id');

    if (!managerAuth) throw new Error('manager auth missing');
    const confirmPayload = await apiFetch(page, `/orders/${createdOrder.id}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
    }, managerAuth.token);
    if (!confirmPayload.ok) {
      throw new Error(`confirm shipping order failed: ${confirmPayload.status}`);
    }

    report.order = {
      id: String(createdOrder.id),
      orderNo: createdOrder.orderNo || String(createdOrder.id),
      customerId: String(customer.id),
      customerName: customer.nameZh || customer.nameEn || customer.name,
    };
  });
}

async function createLinkedShipment({
  page,
  apiFetch,
  data,
  report,
  timebox,
  timeouts,
}) {
  return timebox(page, 'create-linked-shipment-via-api', timeouts.api, async () => {
    if (!report.order?.id || !report.order?.customerId) {
      throw new Error('confirmed order missing before linked shipment creation');
    }
    // Read persisted line identity; order-level linkage alone cannot prove delivery.
    // This fixture is in kg and must never guess a line or add unlike quantities.
    const orderPayload = await apiFetch(page, `/orders/${report.order.id}`);
    if (!orderPayload.ok) throw new Error(`shipping order line readback failed: ${orderPayload.status}`);
    const order = orderPayload.json?.data;
    if (Number(order?.id) !== Number(report.order.id)
      || Number(order?.customerId) !== Number(report.order.customerId)) {
      throw new Error('shipping order line readback identity mismatch');
    }
    const unitKey = value => String(value || '').trim().toLowerCase();
    const materialId = Number(data.materialId);
    const matches = (Array.isArray(order.items) ? order.items : []).filter(item => (
      Number(item.materialId) === materialId && unitKey(item.unit) === 'kg'
    ));
    if (!Number.isSafeInteger(materialId) || materialId <= 0 || matches.length !== 1) {
      throw new Error('shipping fixture requires exactly one persisted material/unit order line');
    }
    const line = matches[0];
    const orderItemId = Number(line.id);
    const quantity = Number(data.quantity);
    if (!Number.isSafeInteger(orderItemId) || orderItemId <= 0
      || typeof line.productName !== 'string' || !line.productName.trim()) {
      throw new Error('shipping fixture order line identity is incomplete');
    }
    if (!Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(Number(line.quantity)) || quantity > Number(line.quantity)) {
      throw new Error('shipping fixture quantity must fit the single persisted order line');
    }
    const payload = await apiFetch(page, '/shipping', {
      method: 'POST',
      data: {
        customerId: Number(report.order.customerId),
        orderId: Number(report.order.id),
        orderItemId,
        materialId,
        productName: line.productName,
        quantity,
        unit: 'kg',
        batchNo: data.batchNo,
        carrier: data.carrier,
        trackingNo: data.linkedTrackingNo,
      },
    });
    if (!payload.ok) {
      throw new Error(`linked shipment create failed: ${payload.status}`);
    }
    const shipment = payload.json?.data;
    if (!shipment?.id || Number(shipment.orderId) !== Number(order.id)
      || Number(shipment.orderItemId) !== orderItemId
      || Number(shipment.quantity) !== quantity || unitKey(shipment.unit) !== 'kg') {
      throw new Error('linked shipment create did not preserve the persisted order line/quantity/unit');
    }
    report.order.orderItemId = String(orderItemId);
    report.linkedShipment = {
      id: String(shipment.id),
      orderItemId: String(shipment.orderItemId),
      shipmentNo: shipment.shipmentNo,
      trackingNo: shipment.trackingNo,
      status: shipment.status,
      batchNo: shipment.batchNo || data.batchNo,
    };
  });
}

async function verifyShippingIssue({
  page,
  apiFetch,
  unwrapList,
  data,
  report,
  timebox,
  timeouts,
}) {
  return timebox(page, 'verify-linked-shipment-stock-issue', timeouts.readBack, async () => {
    const shipmentNo = report.linkedShipment?.shipmentNo;
    if (!shipmentNo) throw new Error('linked shipmentNo missing before stock issue verification');
    const expectedRemaining = data.stockQuantity - data.quantity;

    const balancePayload = await apiFetch(
      page,
      `/warehouses/stock-balances?productName=${encodeURIComponent(data.linkedProduct)}&batchNo=${encodeURIComponent(data.batchNo)}&pageSize=100`,
    );
    if (!balancePayload.ok) throw new Error(`stock balance readback failed: ${balancePayload.status}`);
    const balances = unwrapList(balancePayload).filter((item) => (
      String(item.productName) === data.linkedProduct && String(item.batchNo) === data.batchNo
    ));
    const fgBalance = balances.find((item) => String(item.locationCode || '') === 'LOC-FG');
    if (!fgBalance) throw new Error(`finished goods balance not found for ${data.linkedProduct}/${data.batchNo}`);
    const remainingQuantity = Number(fgBalance.quantity || 0);
    if (remainingQuantity !== expectedRemaining) {
      throw new Error(`expected remaining stock ${expectedRemaining}, got ${remainingQuantity}`);
    }

    const entryPayload = await apiFetch(
      page,
      `/warehouses/stock-entries?sourceType=shipping_issue&sourceRef=${encodeURIComponent(shipmentNo)}&limit=200`,
    );
    if (!entryPayload.ok) throw new Error(`stock entry readback failed: ${entryPayload.status}`);
    const entries = unwrapList(entryPayload).filter((entry) => (
      String(entry.sourceType) === 'shipping_issue' && String(entry.sourceRef) === String(shipmentNo)
    ));
    if (entries.length !== 1) {
      throw new Error(`expected exactly one shipping issue entry, got ${entries.length}`);
    }
    const movement = Array.isArray(entries[0].movements)
      ? entries[0].movements.find((item) => (
          String(item.productName) === data.linkedProduct
          && String(item.batchNo) === data.batchNo
          && Number(item.quantityDelta || 0) === -Number(data.quantity)
        ))
      : null;
    if (!movement) throw new Error(`shipping issue entry missing matching movement: ${shipmentNo}`);

    const batchPayload = await apiFetch(page, `/assets/batches?keyword=${encodeURIComponent(data.batchNo)}&pageSize=100`);
    if (!batchPayload.ok) throw new Error(`batch readback failed: ${batchPayload.status}`);
    const batches = unwrapList(batchPayload).filter(item => (
      String(item.batchNo) === data.batchNo && String(item.productName) === data.linkedProduct
    ));
    if (batches.length !== 1 || Number(batches[0].stockQuantity) !== expectedRemaining) {
      throw new Error(`shipping batch quantity mismatch: expected one batch with ${expectedRemaining}`);
    }
    const costPayload = await apiFetch(page, `/production/batches/${batches[0].id}/cost-ledger?pageSize=100`);
    if (!costPayload.ok) throw new Error(`cost ledger readback failed: ${costPayload.status}`);
    const ledger = costPayload.json?.data;
    const expectedCost = Math.round(expectedRemaining * data.unitCost * 100) / 100;
    const expectedIssueCost = -Math.round(data.quantity * data.unitCost * 100) / 100;
    if (Number(ledger?.summary?.totalQuantityDelta) !== expectedRemaining
      || Number(ledger?.summary?.currentQuantity) !== expectedRemaining
      || Number(ledger?.summary?.currentCostAmount) !== expectedCost) {
      throw new Error(`shipping cost conservation mismatch: expected ${expectedRemaining} / ${expectedCost}`);
    }
    const costRows = (ledger.items || []).filter(item => item.sourceRef === entries[0].entryNo);
    if (costRows.length !== 1 || Number(costRows[0].quantityDelta) !== -Number(data.quantity)
      || Number(costRows[0].costAmountDelta) !== expectedIssueCost) {
      throw new Error('shipping cost ledger missing exactly one matching issue');
    }

    report.issueEvidence = {
      sourceRef: shipmentNo,
      entryNo: entries[0].entryNo,
      entryCount: entries.length,
      remainingQuantity,
      locationCode: fgBalance.locationCode,
      batchId: batches[0].id,
      batchQuantity: Number(batches[0].stockQuantity),
      costQuantity: Number(ledger.summary.totalQuantityDelta),
      costAmount: Number(ledger.summary.currentCostAmount),
      issueCostAmount: Number(costRows[0].costAmountDelta),
    };
  });
}

module.exports = {
  createConfirmedShippingOrder,
  createLinkedShipment,
  seedShipmentStock,
  verifyShippingIssue,
};
