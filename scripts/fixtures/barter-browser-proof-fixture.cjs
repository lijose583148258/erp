function fixture() {
  const agreement = { status: 'partial', executedOffsetAmount: 800, remainingOffsetAmount: 1200, agreedOffsetAmount: 2000 };
  const stock = quantity => ({ balances: [{ id: 1, quantity }], batch: { stockQuantity: quantity },
    costs: [{ quantityDelta: quantity, costAmountDelta: quantity * 10 }],
    movements: [{ stockBalanceId: 1, quantityDelta: quantity }], apiBalances: [[{ quantity }], [{ quantity }]] });
  return { label: 'partial', readbacks: [structuredClone(agreement), structuredClone(agreement)], persisted: agreement,
    paid: { paidAmount: 800, paymentStatus: 'partial', paymentRecords: [{ status: 'verified', amount: 800 }] },
    ourStock: stock(60), received: stock(80) };
}
function browserFixture() {
  const lines = quantity => [{ side: 'our', materialId: 10, quantity, unitPrice: 20, sourceDocument: 'existing-lot' },
    { side: 'counterparty', materialId: 11, quantity: quantity * 2, unitPrice: 10, sourceDocument: 'incoming-lot' }];
  const batches = [40, 60, 60].map((quantity, index) => ({ id: index + 1, settlementNo: `batch-${index + 1}`,
    createdBy: 2, approvedBy: 3, postedBy: 4, status: index === 1 ? 'reversed' : 'posted', items: lines(quantity),
    reversalLogs: index === 1 ? [{ reason: 'reverse second', reversedBy: 4 }] : [] }));
  const operations = [{ action: 'create-agreement', actorId: 2, role: 'sales', instance: 0, httpStatus: 201, body: { orderId: 9 }, response: { id: 7 } }];
  for (const batch of batches) {
    operations.push({ action: 'create-batch', actorId: 2, role: 'sales', instance: 0, httpStatus: 201,
      endpoint: '/barter/agreements/7/batches', body: { items: batch.items }, response: { id: batch.id } });
    for (const action of ['approve', 'post', ...(batch.id === 2 ? ['reverse'] : [])]) operations.push({ action,
      actorId: action === 'approve' ? 3 : 4, role: 'finance', instance: action === 'approve' ? 0 : 1, httpStatus: 200,
      endpoint: `/barter/settlements/${batch.id}/${action}`, body: action === 'reverse' ? { reason: 'reverse second' } : {},
      response: { id: batch.id }, screenshot: `batch-${batch.id}-${action}.png`, text: batch.settlementNo });
  }
  const stages = [false, true, false, true].map(complete => {
    const stage = fixture();
    if (complete) {
      for (const agreement of [...stage.readbacks, stage.persisted]) Object.assign(agreement, { status: 'completed', executedOffsetAmount: 2000, remainingOffsetAmount: 0 });
      Object.assign(stage.paid, { paidAmount: 2000, paymentStatus: 'paid', paymentRecords: [{ status: 'verified', amount: 800 }, { status: 'verified', amount: 1200 }] });
      for (const [stock, quantity] of [[stage.ourStock, 0], [stage.received, 200]]) {
        stock.batch.stockQuantity = quantity; stock.balances[0].quantity = quantity;
        stock.costs[0] = { quantityDelta: quantity, costAmountDelta: quantity * 10 };
        stock.movements[0].quantityDelta = quantity;
        stock.apiBalances = [[{ quantity }], [{ quantity }]];
      }
    }
    return stage;
  });
  Object.assign(stages.at(-1).persisted, { createdBy: 2, settlements: batches });
  return { agreementId: 7, orderId: 9, roleOperations: operations, stages, browserErrors: [],
    browser: stages.map((_, i) => ({ actorId: 3, role: 'finance', instance: 1, screenshot: `stage-${i}.png`, text: 'agreement', sourceReadback: 'existing-lot incoming-lot' })),
    replays: batches.map(batch => ({ batchId: batch.id, status: 409 })),
    denials: ['quoted', 'approved', 'posted'].map(state => ({ state, actorId: 2, status: 403, before: { amount: 800 }, after: { amount: 800 } })) };
}

module.exports = { fixture, browserFixture };
