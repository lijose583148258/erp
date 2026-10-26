const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cents = value => Math.round(Number(value) * 100);
const total = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key]), 0);

function assertPartialBarterStage(stage, expected) {
  const { label, readbacks, persisted, paid, ourStock, received } = stage;
  const { executed, remaining, outgoingStock, incomingStock, verifiedPayments, status } = expected;
  assert.equal(readbacks.length, 2, 'Both application instances must be read');
  for (const row of [...readbacks, persisted]) {
    assert.equal(row.status, status, `${label}: agreement status`);
    assert.equal(cents(row.executedOffsetAmount), cents(executed));
    assert.equal(cents(row.remainingOffsetAmount), cents(remaining));
    assert.equal(cents(row.agreedOffsetAmount), cents(2000));
  }
  assert.equal(cents(paid.paidAmount), cents(executed));
  assert.equal(paid.paymentStatus, remaining ? 'partial' : 'paid');
  const payments = paid.paymentRecords.filter(row => row.status === 'verified');
  assert.equal(payments.length, verifiedPayments);
  assert.equal(cents(total(payments, 'amount')), cents(executed));
  for (const [state, quantity] of [[ourStock, outgoingStock], [received, incomingStock]]) {
    assert(state.balances.length > 0 && state.costs.length > 0 && state.movements.length > 0, 'Missing inventory evidence');
    assert.equal(total(state.balances, 'quantity'), quantity);
    assert.equal(Number(state.batch?.stockQuantity), quantity);
    assert.equal(total(state.costs, 'quantityDelta'), quantity);
    assert.equal(cents(total(state.costs, 'costAmountDelta')), cents(quantity * 10));
    assert(state.balances.every(row => row.quantity >= 0));
    assert.equal(state.apiBalances.length, 2);
    assert(state.apiBalances.every(rows => rows.length > 0 && total(rows, 'quantity') === quantity));
    assert(state.balances.every(row => total(state.movements.filter(m => m.stockBalanceId === row.id), 'quantityDelta') === row.quantity));
  }
}

async function barterPartialFulfillmentProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId, stockFixture, readStock, customer, verify, ensureReleasedMaterial } = ctx;
  const { resolveBarterActors, attestBarterActors, actorSummary, openBarterPage, requestHasBearer } = require('./enterprise-round2-barter-actor-proof.cjs');
  const people = resolveBarterActors(ctx);
  // Keep the original built-in browser control separate from the opt-in same20
  // duties. Dynamic roles are never renamed to built-in sales/finance roles.
  const browserMode = process.env.ROUND2_BROWSER === 'true';
  const { sales, approver, poster, reverser } = !ctx.workforce && browserMode
    ? { ...people, approver: actors.finance1, poster: actors.finance2 } : people;
  const actorProfiles = await attestBarterActors(ctx, signal);
  const call = async (endpoint, method = 'GET', data, actor = sales, instance = 0) =>
    dataOf(await request(endpoint, { method, data, actor, instance, signal }));
  const our = await stockFixture('barter-partial', signal);
  const incoming = await ensureReleasedMaterial({ request: (endpoint, options) => request(endpoint, { ...options, signal }),
    code: `${runId}-partial-raw`, name: `${runId}-partial-raw`, category: 'raw_material', unit: 'kg' });
  const warehouses = await call('/warehouses', 'GET', undefined, actors.admin);
  if (!warehouses.flatMap(row => row.locations || []).some(row => row.code === 'LOC-RAW')) {
    await call(`/warehouses/${our.destination.warehouseId}/locations`, 'POST',
      { code: 'LOC-RAW', name: 'Round2 raw material', type: 'internal' }, actors.admin);
  }
  const buyer = await customer(signal, sales);
  const order = await call('/orders', 'POST', { customerId: buyer.id, paymentTerms: 30,
    items: [{ materialId: our.material.id, productName: our.material.nameZh, quantity: 100, unit: 'kg', unitPrice: 20 }] });
  const incomingBatch = `${runId}-partial-incoming`;
  const items = quantity => [
    { side: 'our', materialId: our.material.id, itemName: our.material.nameZh, quantity, unit: 'kg', unitPrice: 20, sourceDocument: our.batchNo },
    { side: 'counterparty', materialId: incoming.id, itemName: incoming.nameZh, quantity: quantity * 2, unit: 'kg', unitPrice: 10, sourceDocument: incomingBatch },
  ];
  let agreement;
  const batches = [];
  const evidence = { scope: '40/60 batches, reversal and replacement; browser mode uses sales agreement/batch UI and separate finance approval/post/reversal UI; fixtures and replay attacks use API',
    orderId: order.id, stages: [], replays: [], denials: [], roleOperations: [], browserRequests: [], browserErrors: [],
    ...(ctx.workforce ? { actorMode: 'same-workforce-duties/v1', actorProfiles,
      barterActors: Object.fromEntries(Object.entries(people).map(([duty, actor]) => [duty, actorSummary(actor)])) } : {}) };
  let browser;
  let page;
  let currentActor;
  let browserToken;
  const abortBrowser = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener('abort', abortBrowser, { once: true });
  async function openRole(actor, instance) {
    const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
    if (!browser) browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
    await page?.close();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) {
        evidence.browserRequests.push(pathname);
        if (!(actor.profile || actor.loginUser)?.permissions?.includes('customers.read') && pathname === '/api/customers') {
          evidence.browserErrors.push({ actorId: actor.id, message: 'Barter duty requested unauthorized customers' });
        }
      }
    });
    page.on('response', response => {
      if (response.status() >= 400) evidence.browserErrors.push({ actorId: actor.id, url: new URL(response.url()).pathname, status: response.status() });
    });
    page.on('pageerror', error => evidence.browserErrors.push({ actorId: actor.id, message: error.message }));
    const duty = actor === sales ? 'sales' : actor === approver ? 'approver' : actor === poster ? 'poster' : 'reverser';
    const session = await openBarterPage({ page, ctx, actor, duty, instance });
    browserToken = session.token; currentActor = session.identity;
    if (agreement) {
      const detail = page.waitForResponse(response => new URL(response.url()).pathname === `/api/barter/agreements/${agreement.id}` && response.request().method() === 'GET');
      void detail.catch(() => {});
      await page.getByRole('button').filter({ hasText: agreement.agreementNo }).click();
      const response = await detail;
      assert.equal(response.status(), 200);
      const authorizationVerified = await requestHasBearer(response.request(), browserToken);
      assert.equal(authorizationVerified, true, 'Barter detail read used a different bearer');
      currentActor.authorizationVerified = authorizationVerified;
    }
  }
  async function fillItems(titles, quantity) {
    for (const [title, material, amount, price] of [[titles[0], incoming, quantity * 2, 10], [titles[1], our.material, quantity, 20]]) {
      await page.getByText(title, { exact: true }).locator('..').getByRole('combobox').fill(material.nameZh);
      await page.getByRole('option').filter({ hasText: material.nameZh }).click();
      await page.getByLabel(`${title} 数量`, { exact: true }).fill(String(amount));
      await page.getByLabel(`${title} 单价`, { exact: true }).fill(String(price));
    }
  }
  async function browserWrite(endpoint, method, click, status, action) {
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}` && r.request().method() === method);
    await click(); const response = await pending;
    const payload = await response.json();
    const authorizationVerified = await requestHasBearer(response.request(), browserToken);
    assert.equal(authorizationVerified, true, 'Barter operation bearer does not match current actor');
    const record = { ...currentActor, authorizationVerified, action, endpoint, method, httpStatus: response.status(), body: response.request().postDataJSON(), response: payload.data };
    evidence.roleOperations.push(record);
    assert.equal(response.status(), status, `${action}: ${JSON.stringify(payload)}`);
    return payload.data;
  }
  const batchCard = batch => page.getByText(`第 ${batch.batchIndex} 批 / ${batch.settlementNo}`, { exact: true }).locator('../..');
  async function financeAction(batch, action, actor, instance) {
    const { expect } = require('playwright/test');
    await openRole(actor, instance);
    await expect(page.getByRole('button', { name: '创建协议', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: /审批过账/ }).click();
    const label = { approve: '审核', post: '过账', reverse: '冲销' }[action];
    const card = batchCard(batch);
    if (action === 'reverse') {
      await card.getByRole('button', { name: label, exact: true }).click();
      await page.getByTestId('reason-dialog-input').fill('Round2 reverse second batch only');
    }
    await browserWrite(`/barter/settlements/${batch.id}/${action}`, action === 'approve' ? 'PATCH' : 'POST',
      () => action === 'reverse' ? page.getByRole('button', { name: '确认冲销', exact: true }).click() : card.getByRole('button', { name: label, exact: true }).click(), 200, action);
    await expect(card).toContainText({ approve: '已审核', post: '已过账', reverse: '已冲销' }[action]);
    const folder = path.join(path.dirname(ctx.reportPath), `${runId}-barter-partial`);
    fs.mkdirSync(folder, { recursive: true });
    const screenshot = path.join(folder, `batch-${batch.batchIndex}-${action}.png`);
    await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: screenshot });
    Object.assign(evidence.roleOperations.at(-1), { screenshot, text: await card.innerText() });
  }
  async function browserReadback(label, executed, remaining, status) {
    if (process.env.ROUND2_BROWSER !== 'true') return;
    // The source-evidence job executes assertion contracts before npm install.
    // Load browser dependencies only in the actual browser path; missing dependencies
    // must still fail that path rather than silently skipping its evidence.
    const { expect } = require('playwright/test');
    const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
    const reader = ctx.workforce ? poster : actors.finance1;
    await openRole(reader, 1);
    // A legacy readback reuses the original approving finance control; the
    // workforce readback explicitly belongs to AR, never AP.
    if (ctx.workforce) currentActor.duty = 'poster';
    await page.locator('#loading').waitFor({ state: 'hidden' });
    const card = page.getByRole('button').filter({ hasText: agreement.agreementNo });
    await expect(card).toContainText(status === 'partial' ? '部分完成' : '已完成');
    await expect(page.getByRole('button', { name: '创建协议', exact: true })).toBeDisabled();
    await expect(page.getByLabel('货抵协议客户', { exact: true })).toBeDisabled();
    assert.deepEqual(evidence.browserErrors, [], 'Finance barter UI must not hide failed reads');
    const text = (await card.innerText()).replace(/[,\s]/g, '');
    assert(text.includes(`已抵¥${executed.toFixed(2)}`) || new RegExp(`已抵[^0-9]*${executed}(?:\\.00)?待抵`).test(text), text);
    assert(new RegExp(`待抵[^0-9]*${remaining}(?:\\.00)?批次`).test(text), text);
    await card.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
    const hit = await card.evaluate(element => { const r = element.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!top && element.contains(top); });
    assert(hit, 'Barter agreement readback is covered');
    const folder = path.join(path.dirname(ctx.reportPath), `${runId}-barter-partial`);
    fs.mkdirSync(folder, { recursive: true });
    const screenshot = path.join(folder, `${evidence.stages.length}-${status}.png`);
    const fonts = await verifyRenderedCjk(page, `button:has-text("${agreement.agreementNo}")`);
    await page.screenshot({ path: screenshot });
    await card.click(); await page.getByRole('tab',{name:/审批过账/}).click();
    const sourceReadback=page.getByRole('list',{name:'实际出入库批号'}).first();
    await expect(sourceReadback).toContainText(our.batchNo); await expect(sourceReadback).toContainText(incomingBatch);
    (evidence.browser ||= []).push({ ...currentActor, label, text, screenshot, fonts, sourceReadback:await sourceReadback.innerText(), scope: 'Independent finance agreement and actual-lot UI readback after each business stage' });
  }
  async function readState() {
    const [readbacks, persisted, paid, ourStock, received] = await Promise.all([
      Promise.all([0, 1].map(instance => call(`/barter/agreements/${agreement.id}`, 'GET', undefined, ctx.workforce ? poster : actors.finance1, instance))),
      prisma.barterAgreement.findUnique({ where: { id: agreement.id }, include: { settlements: { include: { items: true, offsetPostings: true, reversalLogs: true } } } }),
      prisma.order.findUnique({ where: { id: order.id }, include: { paymentRecords: true } }),
      readStock(our, signal), readStock({ material: incoming, batchNo: incomingBatch }, signal),
    ]);
    return { readbacks, persisted, paid, ourStock, received };
  }
  async function deny(endpoint, method, data, actor, state) {
    const before = await readState();
    const result = await request(endpoint, { method, data, actor, instance: 1, signal });
    const after = await readState();
    evidence.denials.push({ endpoint, method, body: data, actorId: actor.id, role: actor.role, state, status: result.status, before, after });
    assert.equal(result.status, 403, `Unauthorized ${method} ${endpoint}`);
    assert.deepEqual(after, before, 'Forbidden operation changed agreement, settlement, payments, inventory or costs');
  }
  async function snapshot(label, executed, remaining, outgoingStock, incomingStock, verifiedPayments, status) {
    const stage = { label, ...await readState() };
    evidence.stages.push(stage);
    try {
      assertPartialBarterStage(stage, { executed, remaining, outgoingStock, incomingStock, verifiedPayments, status });
    } catch (error) { error.evidence = evidence; throw error; }
    await browserReadback(label, executed, remaining, status);
    return stage;
  }
  async function postBatch(quantity, label) {
    let batch;
    if (process.env.ROUND2_BROWSER === 'true') {
      // Existing stock is seeded before the UI write. Never manufacture stock for an auto-generated barter batch.
      const { expect } = require('playwright/test');
      await openRole(sales, 0);
      await page.getByRole('tab',{name:/执行批次/}).click();
      await fillItems(['本次对方交付', '本次我方抵扣'], quantity);
      await expect(page.getByRole('button',{name:'创建批次',exact:true})).toBeDisabled();
      await page.getByLabel('本次对方交付 实际批号',{exact:true}).fill(incomingBatch);
      await page.getByLabel('本次我方抵扣 实际批号',{exact:true}).fill('   ');
      await expect(page.getByRole('button',{name:'创建批次',exact:true})).toBeDisabled();
      await page.getByLabel('本次我方抵扣 实际批号',{exact:true}).fill(our.batchNo);
      batch = await browserWrite(`/barter/agreements/${agreement.id}/batches`, 'POST',
        () => page.getByRole('button',{name:'创建批次',exact:true}).click(), 201, 'create-batch');
      const record = evidence.roleOperations.at(-1);
      const body = record.body;
      assert.deepEqual(body.items.map(v=>({side:v.side,materialId:v.materialId,sourceDocument:v.sourceDocument})),
        [{side:'counterparty',materialId:incoming.id,sourceDocument:incomingBatch},{side:'our',materialId:our.material.id,sourceDocument:our.batchNo}]);
      for(const item of body.items) assert.equal(batch.items.find(v=>v.side===item.side).sourceDocument,item.sourceDocument);
      if (batches.length === 0) evidence.firstBatchBrowser = { ...currentActor, httpStatus: record.httpStatus, batchId: batch.id, body };
      await page.getByRole('tab', { name: /审批过账/ }).click();
      await expect(batchCard(batch)).toContainText('只读');
      for (const name of ['审核', '过账', '冲销']) await expect(batchCard(batch).getByRole('button', { name, exact: true })).toHaveCount(0);
    } else batch = await call(`/barter/agreements/${agreement.id}/batches`, 'POST', { items: items(quantity), note: `${runId}-${label}` });
    batches.push(batch);
    if (process.env.ROUND2_BROWSER === 'true') {
      if (batches.length === 1) await deny(`/barter/settlements/${batch.id}/approve`, 'PATCH', { note: 'forbidden sales approval' }, sales, 'quoted');
      await financeAction(batch, 'approve', approver, 0);
      if (batches.length === 1) await deny(`/barter/settlements/${batch.id}/post`, 'POST', { postingAmount: quantity * 20 }, sales, 'approved');
      await financeAction(batch, 'post', poster, 1);
      if (batches.length === 1) await deny(`/barter/settlements/${batch.id}/reverse`, 'POST', { reason: 'forbidden sales reversal' }, sales, 'posted');
    } else {
      await call(`/barter/settlements/${batch.id}/approve`, 'PATCH', { note: label }, approver);
      await call(`/barter/settlements/${batch.id}/post`, 'POST', { postingAmount: quantity * 20, note: label }, poster);
    }
    const replay = await request(`/barter/settlements/${batch.id}/post`, { actor: reverser, instance: 1, method: 'POST', signal,
      data: { postingAmount: quantity * 20, note: label } });
    evidence.replays.push({ batchId: batch.id, status: replay.status });
    assert.equal(replay.status, 409);
    return batch;
  }
  try {
  if (process.env.ROUND2_BROWSER === 'true') {
    await openRole(sales, 0);
    await page.getByLabel('货抵协议客户', { exact: true }).selectOption(String(buyer.id));
    await page.getByLabel('货抵协议对方名称', { exact: true }).fill(buyer.name);
    await page.getByLabel('货抵协议关联订单', { exact: true }).selectOption(String(order.id));
    await page.getByLabel('货抵协议结算方式', { exact: true }).selectOption('barter');
    await fillItems(['协议对方总标的', '协议我方总标的'], 100);
    agreement = await browserWrite('/barter/agreements', 'POST',
      () => page.getByRole('button', { name: '创建协议', exact: true }).click(), 201, 'create-agreement');
  } else agreement = await call('/barter/agreements', 'POST', { customerId: buyer.id, orderId: order.id,
    counterpartyType: 'customer', counterpartyName: buyer.name, settlementMode: 'barter', currency: 'CNY',
    items: items(100), note: `${runId}-partial-agreement` });
  evidence.agreementId = agreement.id;
  await postBatch(40, 'partial-first');
  await snapshot('40 percent posted', 800, 1200, 60, 80, 1, 'partial');
  const second = await postBatch(60, 'partial-second');
  await snapshot('all batches posted', 2000, 0, 0, 200, 2, 'completed');
  if (process.env.ROUND2_BROWSER === 'true') await financeAction(second, 'reverse', reverser, 1);
  else await call(`/barter/settlements/${second.id}/reverse`, 'POST', { reason: 'Round2 reverse second batch only' }, reverser, 1);
  const reversed = await snapshot('second batch reversed, first preserved', 800, 1200, 60, 80, 1, 'partial');
  assert.equal(reversed.persisted.settlements.find(row => row.id === second.id).reversalLogs.length, 1);
  await postBatch(60, 'partial-replacement');
  const final = await snapshot('replacement closes remainder', 2000, 0, 0, 200, 2, 'completed');
  if (process.env.ROUND2_BROWSER === 'true') assertBarterBrowserChain(evidence);
  return verify({
    agreement_partial_then_complete: true, second_batch_reversal_reopens_remainder: true,
    earlier_batch_preserved: final.persisted.settlements.find(row => row.id === batches[0].id).status === 'posted',
    exactly_two_live_postings_and_one_retained_reversal: final.persisted.settlements.filter(row => row.status === 'posted').length === 2
      && final.persisted.settlements.filter(row => row.status === 'reversed').length === 1,
    quantities_and_carrying_costs_reconcile_at_all_four_stages: true,
    replay_does_not_duplicate_posting: final.persisted.settlements.every(row => row.offsetPostings.length === 1),
    exactly_three_goods_exchanges_and_one_reversal: final.ourStock.entries.filter(row => row.sourceType === 'barter_issue').length === 3
      && final.received.entries.filter(row => row.sourceType === 'barter_receipt').length === 3
      && final.ourStock.entries.filter(row => row.sourceType === 'barter_issue_reversal').length === 1
      && final.received.entries.filter(row => row.sourceType === 'barter_receipt_reversal').length === 1,
  }, evidence);
  } catch (error) {
    if (page) {
      const folder = path.join(path.dirname(ctx.reportPath), `${runId}-barter-partial`);
      fs.mkdirSync(folder, { recursive: true });
      evidence.failureScreenshot = path.join(folder, 'failure.png');
      await page.screenshot({ path: evidence.failureScreenshot }).catch(() => {});
    }
    error.evidence ||= evidence; throw error;
  }
  finally { signal.removeEventListener('abort', abortBrowser); await browser?.close(); }
}

function assertBarterBrowserChain(evidence) {
  const workforce = evidence.actorMode !== undefined || evidence.barterActors !== undefined;
  let dutyProof;
  if (workforce) {
    dutyProof = require('./enterprise-round2-barter-actor-proof.cjs');
    dutyProof.assertBarterDutyEvidence(evidence);
  }
  assert.deepEqual(evidence.browserErrors, [], 'Unexpected browser error');
  assert.equal(evidence.stages.length, 4);
  assert.equal(evidence.browser.length, 4);
  for (const [index, values] of [[800, 1200, 60, 80, 1, 'partial'], [2000, 0, 0, 200, 2, 'completed'],
    [800, 1200, 60, 80, 1, 'partial'], [2000, 0, 0, 200, 2, 'completed']].entries()) {
    const [executed, remaining, outgoingStock, incomingStock, verifiedPayments, status] = values;
    assertPartialBarterStage(evidence.stages[index], { executed, remaining, outgoingStock, incomingStock, verifiedPayments, status });
  }
  assert.deepEqual(evidence.roleOperations.map(row => row.action), [
    'create-agreement', 'create-batch', 'approve', 'post', 'create-batch', 'approve', 'post', 'reverse', 'create-batch', 'approve', 'post',
  ]);
  const [creation, first, approval, posting] = evidence.roleOperations;
  const reverseActor = workforce ? evidence.barterActors.reverser.id : posting.actorId;
  assert.equal(new Set([creation.actorId, approval.actorId, posting.actorId]).size, 3, 'Three independent actors required');
  if (workforce) {
    dutyProof.assertBarterDutyRecord(creation, evidence.barterActors, 'sales');
    dutyProof.assertBarterDutyRecord(approval, evidence.barterActors, 'approver');
    dutyProof.assertBarterDutyRecord(posting, evidence.barterActors, 'poster');
  } else {
    assert.equal(creation.role, 'sales'); assert.equal(approval.role, 'finance'); assert.equal(posting.role, 'finance');
  }
  assert.equal(creation.httpStatus, 201);
  assert.equal(creation.response.id, evidence.agreementId);
  assert.equal(creation.body.orderId, evidence.orderId);
  const final = evidence.stages.at(-1).persisted;
  assert.equal(final.createdBy, creation.actorId);
  const created = evidence.roleOperations.filter(row => row.action === 'create-batch');
  assert.equal(new Set(created.map(row => row.response.id)).size, 3);
  assert.deepEqual(created.map(row => row.body.items.find(item => item.side === 'our').quantity), [40, 60, 60]);
  assert.deepEqual(evidence.replays.map(row => ({ batchId: row.batchId, status: row.status })), created.map(row => ({ batchId: row.response.id, status: 409 })));
  for (const readback of evidence.browser) {
    if (workforce) dutyProof.assertBarterDutyRecord(readback, evidence.barterActors, 'poster');
    else { assert.equal(readback.actorId, approval.actorId); assert.equal(readback.role, 'finance'); }
    assert.equal(readback.instance, 1);
    assert(readback.screenshot && readback.text);
    for (const item of first.body.items) assert(readback.sourceReadback.includes(item.sourceDocument));
  }
  for (const row of evidence.roleOperations.slice(1)) {
    const isCreate = row.action === 'create-batch';
    const id = isCreate ? row.response.id : Number(row.endpoint.split('/')[3]);
    const batch = final.settlements.find(item => item.id === id);
    assert(batch, 'UI operation must bind a persisted batch');
    const actorId = isCreate ? creation.actorId : row.action === 'approve' ? approval.actorId : row.action === 'reverse' ? reverseActor : posting.actorId;
    assert.equal(row.actorId, actorId);
    if (workforce) dutyProof.assertBarterDutyRecord(row, evidence.barterActors,
      isCreate ? 'sales' : row.action === 'approve' ? 'approver' : row.action === 'reverse' ? 'reverser' : 'poster');
    else assert.equal(row.role, isCreate ? 'sales' : 'finance');
    assert.equal(row.instance, ['post', 'reverse'].includes(row.action) ? 1 : 0);
    assert.equal(row.httpStatus, isCreate ? 201 : 200);
    assert.equal(batch.createdBy, creation.actorId);
    assert.equal(batch.approvedBy, approval.actorId);
    assert.equal(batch.postedBy, posting.actorId);
    if (isCreate) {
      assert.equal(row.endpoint, `/barter/agreements/${evidence.agreementId}/batches`);
      assert.equal(row.body.items.length, 2);
      for (const item of row.body.items) {
        const persisted = batch.items.find(value => value.side === item.side);
        for (const key of ['materialId', 'quantity', 'unitPrice', 'sourceDocument']) assert.equal(persisted[key], item[key]);
      }
    } else {
      assert.equal(row.endpoint, `/barter/settlements/${id}/${row.action}`);
      assert.equal(row.response.id, id);
      assert(row.screenshot && row.text.includes(batch.settlementNo), 'Missing actual batch UI readback');
    }
  }
  const reversal = evidence.roleOperations.find(row => row.action === 'reverse');
  const reversed = final.settlements.find(row => row.status === 'reversed');
  assert.equal(reversed.reversalLogs.length, 1);
  assert.equal(reversed.reversalLogs[0].reason, reversal.body.reason);
  assert.equal(reversed.reversalLogs[0].reversedBy, reverseActor);
  assert.equal(final.settlements.find(row => row.id === first.response.id).status, 'posted');
  assert.deepEqual(evidence.denials.map(row => row.state), ['quoted', 'approved', 'posted']);
  for (const denial of evidence.denials) {
    assert.equal(denial.status, 403);
    assert.equal(denial.actorId, creation.actorId);
    assert.deepEqual(denial.after, denial.before, 'Denied operation changed business state');
  }
  return { agreementId: evidence.agreementId, orderId: evidence.orderId, actors: [creation.actorId, approval.actorId, posting.actorId, ...(workforce ? [reverseActor] : [])],
    operations: evidence.roleOperations, denials: evidence.denials, stages: evidence.stages, browser: evidence.browser };
}

module.exports = { barterPartialFulfillmentProbe, assertPartialBarterStage, assertBarterBrowserChain };
