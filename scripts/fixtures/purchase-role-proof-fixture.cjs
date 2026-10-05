// Synthetic verifier fixture, never business acceptance or runner input.
function purchaseRoleProofFixture() {
  const jobs = { buyer: 'procurement.write', approver: 'procurement.approve', receiver: 'procurement.receive' };
  const actors = Object.entries(jobs).map(([job, permission], i) => ({ job, id: 10 + i, role: `test_${job}`,
    permissions: ['dashboard.read', 'procurement.read', 'procurement.suppliers.read', 'materials.read', permission], dataScopes: ['procurement_visible'] }));
  const order = { id: 1, materialId: 1, quantity: 12, revision: 1, status: 'in_transit', landedCostAmount: 120 };
  const receipt = { id: 1, purchaseOrderId: 1, quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, batchNo: 'owned', receivedBy: 12, stockEntryRef: 'PO-1-RCV-test' };
  const audits = [['CREATE', 10], ['REVISE', 10], ['STATUS_CHANGE', 11], ['STATUS_CHANGE', 10], ['CREATE_RECEIPT', 12]]
    .map(([action, userId], i) => ({ id: i + 1, action, userId, resource: 'purchase_order', resourceId: 1 }));
  const before = { orders: [{ ...order, quantity: 10, revision: 0, status: 'pending', landedCostAmount: 100 }], audits: [audits[0]], receipts: [], balances: [], movements: [], entries: [], batches: [], costs: [] };
  const matrix = [['buyer', 'approve'], ['buyer', 'approve-alias'], ['buyer', 'receive'], ['buyer', 'receive-alias'], ['buyer', 'create-approved'], ['buyer', 'create-transit-alias'],
    ['approver', 'create'], ['approver', 'receive'], ['receiver', 'approve-alias'], ['receiver', 'revise'], ['buyer', 'sync-bypass'], ['approver', 'sync-bypass'], ['receiver', 'sync-bypass']];
  const denied = [0, 1].flatMap(instance => matrix.map(([job, operation]) => ({ job, operation, instance, status: 403, response: { success: false,
    requiredPermissions: operation === 'sync-bypass' ? ['procurement.write', 'procurement.approve', 'procurement.receive'] : [operation.startsWith('receive') ? 'procurement.receive' : ['create', 'revise'].includes(operation) ? 'procurement.write' : 'procurement.approve'] } })));
  const summary = { orderedQuantity: 12, processedQuantity: 5, acceptedQuantity: 5, rejectedQuantity: 0, remainingQuantity: 7, receiptCount: 1 };
  const final = { orders: [order], receipts: [receipt], audits,
    balances: [{ id: 1, materialId: 1, batchNo: 'owned', unit: 'kg', quantity: 5 }],
    movements: [{ entryId: 1, stockBalanceId: 1, quantityBefore: 0, quantityDelta: 5, quantityAfter: 5 }],
    entries: [{ id: 1, entryNo: 'stock-entry', sourceType: 'procurement_receipt', sourceRef: 'PO-1-RCV-test', createdBy: 12, status: 'posted' }],
    batches: [{ id: 1, materialId: 1, batchNo: 'owned', stockQuantity: 5 }],
    costs: [{ batchId: 1, sourceRef: 'stock-entry', createdBy: 12, quantityBefore: 0, quantityDelta: 5, quantityAfter: 5, costBefore: 0, costAmountDelta: 50, costAfter: 50, unitCost: 10 }] };
  const writes = [['buyer', 'revise', 200], ['approver', '/status', 200], ['buyer', '/status', 200], ['receiver', '/receipts', 201]]
    .map(([job, operation, status], i) => ({ job, operation, status, instance: 1, response: { success: true, data: i === 3 ? { purchaseOrder: order } : { ...order, status: ['pending', 'approved', 'in_transit'][i] } } }));
  const browser = actors.map(a => ({ job: a.job, actorId: a.id, role: a.role, orderId: 1, instance: 1, approveVisible: a.job === 'approver', receiveEnabled: a.job === 'receiver',
    purchaseNotice: a.job === 'buyer' ? null : '当前角色不能新增或修改采购单；审批与收货按对应操作权限控制。',
    receiptNotice: a.job === 'receiver' ? null : '当前角色只能查看收货批次，保存收货需要采购收货登记权限。',
    batchReadback: 'owned', acceptedReadback: '合格 5kg', errors: [], permissionScreenshot: 'pending.png', receiptScreenshot: 'receipt.png' }));
  const denialAudits = denied.map((r, i) => ({ id: 100 + i, userId: actors.find(a => a.job === r.job).id, resource: '/api/procurement/orders/1', details: 'Status: 403, denied' }));
  return JSON.parse(JSON.stringify({ version: 'purchase-role-browser/v1', status: 'passed', orderId: 1, materialId: 1, batchNo: 'owned', actors, denied, denialAudits, before, afterDenied: before, final, writes, browser,
    readbacks: [0, 1].map(instance => ({ instance, purchaseOrder: order, receipts: [receipt], receiptSummary: summary })) }));
}
module.exports = { purchaseRoleProofFixture };
