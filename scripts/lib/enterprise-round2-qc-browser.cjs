const assert = require('node:assert/strict');

async function qcReleaseBrowser(ctx, apiEvidence, signal) {
  const fs = require('node:fs'), path = require('node:path');
  const { expect } = require('playwright/test');
  const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');
  const { verifyRenderedCjk } = require('./browser-cjk-font-guard.cjs');
  const { assertQcIsolationCase } = require('./enterprise-round2-qc-isolation.cjs');
  const item = apiEvidence.cases.find(c => c.state === 'quarantine'); assertQcIsolationCase(item);
  const evidence = { scope: 'Existing warehouse inspection and manager release permissions; actual browser reinspection/release, not full workforce or supplier receipt QC', browser: [], errors: [] };
  const browser = (await launchBrowserWithGuard({ launchTimeoutMs: 15000, totalTimeoutMs: 30000, maxAttemptsPerStrategy: 1 })).browser;
  const abort = () => { void browser.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  const dir = path.join(path.dirname(ctx.reportPath), `${ctx.runId}-qc-release`); fs.mkdirSync(dir, { recursive: true });
  const { prisma, actors } = ctx;
  async function open(actor) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
    await page.addInitScript(({ token, user }) => {
      for (const key of ['token','auth_token','erp_auth_token']) localStorage.setItem(key, token);
      for (const key of ['user','currentUser','erp_current_user']) localStorage.setItem(key, JSON.stringify(user));
      localStorage.setItem('ailao.language','zh'); localStorage.setItem('language','zh-CN');
    }, { token: actor.token, user: { id: String(actor.id), name: actor.job, role: actor.role, segment: 'mixed' } });
    page.on('pageerror', e => evidence.errors.push(e.message));
    page.on('response', r => { if(r.status() >= 400 && r.url().includes('/api/')) evidence.errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${ctx.urls[1]}/#production`); await page.locator('#loading').waitFor({ state: 'hidden' });
    await page.getByTestId('production-desk-work-orders').click(); await page.getByPlaceholder('搜索工单').fill(item.upstream.workOrderNo);
    await page.getByTestId(`production-work-order-row-${item.upstream.id}`).click();
    return page;
  }
  async function capture(page, name) {
    const panel=page.getByTestId('production-quality-inspection-panel'); await panel.scrollIntoViewIfNeeded();
    const text=await panel.innerText(); const font=await verifyRenderedCjk(page, '[data-testid="production-quality-inspection-panel"]');
    const screenshot=path.join(dir, `${name}.png`); await page.screenshot({ path: screenshot, fullPage: true });
    evidence.browser.push({ name, text, font, screenshot });
  }
  const snapshot = async () => ({
    checks: await prisma.productionQualityCheck.findMany({ where: { workOrderId: item.upstream.id }, orderBy: { revision: 'asc' }, include: { measurements: true } }),
    batch: await prisma.productBatch.findUnique({ where: { id: item.batchId } }), stock: await prisma.stockBalance.findUnique({ where: { id: item.stock.id } }),
    workOrder: await prisma.productionWorkOrder.findUnique({ where: { id: item.downstream.id }, include: { productBatch: true, genealogyEdges: true } }),
    costs: await prisma.inventoryCostLedger.findMany({ where: { OR: [{ batchId: item.batchId }, { workOrderId: item.downstream.id }] }, orderBy: { id: 'asc' } }),
    movements: await prisma.stockMovement.findMany({ where: { materialId: { in: [item.raw.id,item.fg.id] } }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { OR: [{ action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', resourceId: item.downstream.id }, { action: { in: ['CREATE_PRODUCTION_QC','REVIEW_PRODUCTION_QC'] }, details: { contains: `"workOrderId":${item.upstream.id},` } }] }, orderBy: { id: 'asc' } }),
  });
  try {
    evidence.before=await snapshot(); assert.equal(evidence.before.batch.qualityStatus,'quarantine');
    const inspector=await open(actors.stock0), panel=inspector.getByTestId('production-quality-inspection-panel');
    await expect(panel).toContainText(item.qc.checkNo); await expect(panel).toContainText('rejected');
    await expect(inspector.getByTestId('production-qc-release')).toHaveCount(0);
    await inspector.getByTestId('production-quality-sample-no').fill(`${ctx.runId}-browser-retest`);
    await inspector.getByTestId(`production-quality-value-${item.upstreamBom.qualityCharacteristics[0].id}`).fill('1.5');
    const submission=inspector.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/production/work-orders/${item.upstream.id}/checks`);
    await inspector.getByTestId('production-qc-save').click(); const submitted=await submission; assert.equal(submitted.status(),201);
    const qc=(await submitted.json()).data; evidence.submitted=qc;
    await expect(panel).toContainText(qc.checkNo); await expect(panel).toContainText('必须切换另一名');
    await expect(inspector.getByTestId('production-qc-release')).toHaveCount(0); await capture(inspector,'inspector-waiting');
    const manager=await open(actors.buyer1), reviewPanel=manager.getByTestId('production-quality-inspection-panel');
    await expect(reviewPanel).toContainText(qc.checkNo); await expect(manager.getByTestId('production-qc-save')).toHaveCount(0);
    const note='Independent QA browser reviewed repeat measurements and retained failed sample';
    await manager.getByTestId('production-quality-review-note').fill(note);
    const release=manager.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname===`/api/production/work-orders/${item.upstream.id}/checks/${qc.id}/review`);
    await manager.getByTestId('production-qc-release').click(); const released=await release; assert.equal(released.status(),200);
    evidence.released=(await released.json()).data;
    await expect(reviewPanel).toContainText('released'); await expect(reviewPanel).toContainText(note); await expect(reviewPanel).toContainText('rejected'); await capture(manager,'independent-release');
    evidence.afterRelease=await snapshot(); const newest=evidence.afterRelease.checks.at(-1);
    assert.equal(newest.inspectorUserId, actors.stock0.id); assert.equal(newest.reviewedByUserId,actors.buyer1.id); assert.notEqual(newest.inspectorUserId,newest.reviewedByUserId);
    assert.deepEqual(evidence.afterRelease.checks[0],evidence.before.checks[0]); assert.equal(evidence.afterRelease.batch.qualityStatus,'released');
    assert.equal(evidence.afterRelease.stock.quantity,100); assert.equal(evidence.afterRelease.audits.filter(a=>a.action==='REVIEW_PRODUCTION_QC'&&a.resourceId===qc.id).length,1);
    const complete=()=>ctx.request(`/production/work-orders/${item.downstream.id}/status`,{ method:'PATCH', actor:actors.stock0, instance:1, signal, data:{status:'completed',consumptionRecords:[{stockBalanceId:item.stock.id,quantity:10}]} });
    evidence.completion=await complete(); assert.equal(evidence.completion.status,200); evidence.afterCompletion=await snapshot();
    assertQcIsolationCase({state:'released',before:evidence.afterRelease,after:evidence.afterCompletion,requests:[{name:'consume',...evidence.completion}],readbacks:await Promise.all([0,1].map(async instance=>({workOrder:ctx.dataOf(await ctx.request('/production/work-orders',{actor:actors.stock0,instance,signal})).find(w=>w.id===item.downstream.id),stock:ctx.dataOf(await ctx.request(`/warehouses/stock-balances?batchNo=${encodeURIComponent(item.batchNo)}&pageSize=100`,{actor:actors.stock0,instance,signal}))})))});
    evidence.replay=await complete(); assert.equal(evidence.replay.status,200); assert.deepEqual(await snapshot(),evidence.afterCompletion);
    const reread=await open(actors.stock0); await expect(reread.getByTestId('production-quality-inspection-panel')).toContainText(newest.reviewedBy); await capture(reread,'inspector-readback');
    evidence.density = await require('./enterprise-round2-density.cjs').densityBrowser(ctx, browser, apiEvidence.density.browserFixture, dir, signal);
    assert.equal(evidence.errors.length,0,JSON.stringify(evidence.errors)); return evidence;
  } catch(error) { error.evidence ||= evidence; throw error; }
  finally { signal.removeEventListener('abort',abort); await browser.close(); }
}
module.exports={qcReleaseBrowser};
