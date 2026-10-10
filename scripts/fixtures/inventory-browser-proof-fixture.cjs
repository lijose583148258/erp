// Synthetic contract data only; never used by the real browser runner.
function inventoryBrowserFixture(shipmentStatus) {
  const base = { productName: 'unit-product', batchNo: 'unit-batch', unit: 'kg' };
  const quantity = shipmentStatus === 'in_transit' ? 40 : 100;
  const source = {
    responses: [{ actorId: 1, status: 201 }, { actorId: 2, status: 409 }],
    state: {
      balances: [{ ...base, id: 1, quantity }],
      batch: { batchNo: base.batchNo, stockQuantity: quantity },
      costs: [{ quantityDelta: quantity, costAmountDelta: quantity * 10 }],
      entries: [{ id: 1, entryNo: 'entry-1', sourceRef: 'ref-1', status: 'posted' }],
      movements: [{ ...base, id: 1, entryId: 1, quantityDelta: quantity }],
      apiBalances: [0, 1].map(() => [{ id: 1, warehouseName: 'warehouse', locationName: 'location' }]),
    },
  };
  if (shipmentStatus) source.persisted = { id: 8, shipmentNo: 'shipment-8', status: shipmentStatus };
  const proof = { version: 'inventory-race-browser/v1', runtimeErrors: [], readbacks: [0, 1].map(instance => ({
    actorId: instance + 1, instance, customerCatalogRequests: 0,
    httpStatuses: shipmentStatus ? [200, 200, 200] : [200, 200],
    balances: [{ id: 1, cells: [base.productName, base.batchNo, String(quantity), base.unit, 'warehouse', 'location'], transferDisabled: false }],
    ledger: [{ id: 1, text: `entry-1 ref-1 posted 1 行 / ${quantity} unit-product unit-batch ${quantity} kg` }],
    screenshots: (shipmentStatus ? ['balance', 'ledger', 'shipment'] : ['balance', 'ledger']).map(name => `${instance}-${name}.png`),
    ...(shipmentStatus ? { shipment: { id: 8, status: shipmentStatus === 'in_transit' ? '在途运输' : '待发货', rowText: 'shipment-8', statusUnobscured: true } } : {}),
  })) };
  return { source, proof };
}
module.exports = { inventoryBrowserFixture };
