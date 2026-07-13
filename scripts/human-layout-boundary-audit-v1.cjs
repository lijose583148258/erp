const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createBrowserHumanFlowAuditContext } = require('./lib/browser-human-flow-audit-utils.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'human-layout-boundary-audit-v1');
const REPORT_PATH = path.join(OUTPUT_DIR, 'human-layout-boundary-audit-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const TIMEOUTS = {
  pageLoad: 15000,
  login: 20000,
  route: 15000,
  action: 15000,
  save: 20000,
  readBack: 15000,
  screenshot: 5000,
  close: 5000,
};

const ROLE_PASSWORDS = {
  admin: 'admin123',
  sales: 'sales123',
  warehouse: 'warehouse123',
  finance: 'finance123',
};

const REQUIRED_TEXTS = {
  orders: ['订单行回款快捷入口', '批量核销、承诺付款、争议处理、信用/发货拦截仍回到回款中心'],
  collections: ['回款核销主入口', '避免同一笔回款在多个页面重复登记'],
  production: ['批次追踪 / 异常调整', '批次区只做追踪和已形成库存事实后的异常调整'],
  adjustment: ['异常调账治理台账', '先判断是财务、生产、库存还是应收'],
  procurementSuppliers: ['供应商主数据入口', '真实收货从订单行进入'],
  procurementOrders: ['采购订单主入口', '是采购承诺，不是库存流水'],
  procurementReceipts: ['收货是采购订单上的动作', '每次分批收货都能挂在准确订单下面'],
  warehouseInbound: ['应急补录 / 盘盈入库', '本入口不能代替采购收货、生产入库、货抵入库'],
  barter: ['先定协议，再分批执行，最后审批过账', '减少总额、本次金额和财务确认互相覆盖'],
  finance: ['财务经营页是分析与应收调整入口', '真实收款核销仍在回款中心'],
  shippingPrinciple: ['发货物流不是一个大杂烩', 'OCR 只辅助录入'],
  shippingReceipts: ['签收是发货行上的动作', '每次分批签收都挂在原发货单下面'],
  discrepancies: ['差异处理队列', '容差规则是未来自动判定的配置'],
  rma: ['售后主入口', '不直接改库存、不直接核销回款'],
  samples: ['样品主入口', '不在这里直接生成销售订单、扣库存或做回款'],
  contracts: ['合同主数据入口', '保存前必须人工核对标题、金额、客户和签署日期'],
  assets: ['周转资产台账', '产品批次数量由库存凭证同步'],
};

const contextHelpers = createBrowserHumanFlowAuditContext({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  shotDir: SHOT_DIR,
  reportPath: REPORT_PATH,
  runId: RUN_ID,
  data: { requiredTexts: REQUIRED_TEXTS },
  rolePasswords: ROLE_PASSWORDS,
  timeouts: TIMEOUTS,
});

const cp = (...codes) => String.fromCodePoint(...codes);

function assertNoVisibleCorruption(text, name) {
  const badTokens = [
    'undefined undefined',
    '\uFFFD',
    cp(0x7f01, 0x5fda, 0x60c0),
    cp(0x9416, 0x535e),
    cp(0x7039, 0x3221),
    cp(0x95bf, 0x20ac),
    cp(0x9365, 0x70b4),
    cp(0x6434, 0x65c0),
    cp(0x7490, 0x3220),
    cp(0x935a, 0x581d),
    cp(0x690b, 0x5ea2),
    cp(0x5a13, 0x72bb),
    cp(0x93cd, 0x5cf0),
    cp(0x9359, 0x6223),
    cp(0x9422, 0x71b6),
    cp(0x6d60, 0x64b3),
    cp(0x95b2, 0x56ea),
    cp(0x7039, 0x00a4),
  ];
  const hasCorruption = badTokens.some((token) => text.includes(token));
  if (hasCorruption) {
    throw new Error(`${name} has visible corruption signal`);
  }
}

async function assertVisibleTexts(page, name, texts) {
  const startedAt = Date.now();
  let body = '';
  while (Date.now() - startedAt < TIMEOUTS.readBack) {
    body = await contextHelpers.getBodyText(page);
    assertNoVisibleCorruption(body, name);
    if (texts.every(text => body.includes(text))) return body;
    await page.waitForTimeout(300);
  }

  const missing = texts.filter(text => !body.includes(text));
  throw new Error(`${name} missing required text: ${missing.join(' | ')}`);
}

async function runCheck(page, checks, name, action) {
  await action();
  const shot = await contextHelpers.safeScreenshot(page, name);
  checks.push({ name, status: 'passed', shot });
}

async function run() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  let browser;
  const checks = [];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 980 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      localStorage.setItem('ailao.language', 'zh');
      localStorage.setItem('language', 'zh');
      localStorage.setItem('ailao.theme', 'light');
      localStorage.setItem('currency', 'CNY');
    });

    await contextHelpers.resetRuntimeCaches(page);
    await contextHelpers.withTimeout('login-audit-user-api', TIMEOUTS.login, async () => {
      await loginUiAuditUser(page, APP_URL, {
        storage: {
          'ailao.language': 'zh',
          language: 'zh',
          'ailao.theme': 'light',
          currency: 'CNY',
          'ailao.activeTab': 'dashboard',
        },
      });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageLoad });
      await page.getByTestId('theme-toggle').waitFor({ state: 'visible', timeout: TIMEOUTS.login });
    });

    await runCheck(page, checks, 'orders-payments-boundary', async () => {
      await contextHelpers.openHash(page, '#orders', 'orders', ['销售订单', '订单台账']);
      await page.locator('[data-testid="sales-desk-payments"]').click();
      await assertVisibleTexts(page, 'orders-payments-boundary', REQUIRED_TEXTS.orders);
    });

    await runCheck(page, checks, 'collections-canonical-boundary', async () => {
      await contextHelpers.openHash(page, '#collections', 'collections', ['回款工作台', '回款职责导航']);
      await assertVisibleTexts(page, 'collections-canonical-boundary', REQUIRED_TEXTS.collections);
    });

    await runCheck(page, checks, 'production-batch-boundary', async () => {
      await contextHelpers.openHash(page, '#production', 'production', ['生产职责导航', '生产配方']);
      await page.locator('[data-testid="production-desk-batches"]').click();
      await assertVisibleTexts(page, 'production-batch-boundary', REQUIRED_TEXTS.production);
    });

    await runCheck(page, checks, 'adjustment-governance-boundary', async () => {
      await contextHelpers.openHash(page, '#adjustment', 'adjustment', ['异常调账治理台账', '调整域']);
      await assertVisibleTexts(page, 'adjustment-governance-boundary', REQUIRED_TEXTS.adjustment);
    });

    await runCheck(page, checks, 'procurement-supplier-boundary', async () => {
      await contextHelpers.openHash(page, '#procurement', 'procurement', ['采购职责分流', '供应商主数据']);
      await page.locator('[data-testid="procurement-desk-suppliers"]').click();
      await assertVisibleTexts(page, 'procurement-supplier-boundary', REQUIRED_TEXTS.procurementSuppliers);
    });

    await runCheck(page, checks, 'procurement-order-boundary', async () => {
      await page.locator('[data-testid="procurement-desk-orders"]').click();
      await assertVisibleTexts(page, 'procurement-order-boundary', REQUIRED_TEXTS.procurementOrders);
    });

    await runCheck(page, checks, 'procurement-receipt-boundary', async () => {
      await page.locator('[data-testid="procurement-desk-receipts"]').click();
      await assertVisibleTexts(page, 'procurement-receipt-boundary', REQUIRED_TEXTS.procurementReceipts);
    });

    await runCheck(page, checks, 'warehouse-inbound-boundary', async () => {
      await contextHelpers.openHash(page, '#warehouse', 'warehouse', ['仓储职责导航', '仓储库存']);
      await page.locator('[data-testid="warehouse-tab-inbound"]').click();
      await assertVisibleTexts(page, 'warehouse-inbound-boundary', REQUIRED_TEXTS.warehouseInbound);
    });

    await runCheck(page, checks, 'barter-boundary', async () => {
      await contextHelpers.openHash(page, '#barter', 'barter', ['货抵职责导航', '换货贸易']);
      await assertVisibleTexts(page, 'barter-boundary', REQUIRED_TEXTS.barter);
    });

    await runCheck(page, checks, 'finance-boundary', async () => {
      await contextHelpers.openHash(page, '#financeAnalytics', 'finance', ['财务经营', '应收调整']);
      await assertVisibleTexts(page, 'finance-boundary', REQUIRED_TEXTS.finance);
    });

    await runCheck(page, checks, 'shipping-principle-boundary', async () => {
      await contextHelpers.openHash(page, '#shipping', 'shipping', ['发货职责分流', '发货物流']);
      await page.locator('[data-testid="shipping-desk-principle"]').click();
      await assertVisibleTexts(page, 'shipping-principle-boundary', REQUIRED_TEXTS.shippingPrinciple);
    });

    await runCheck(page, checks, 'shipping-receipt-boundary', async () => {
      await page.locator('[data-testid="shipping-desk-receipts"]').click();
      await assertVisibleTexts(page, 'shipping-receipt-boundary', REQUIRED_TEXTS.shippingReceipts);
    });

    await runCheck(page, checks, 'receipt-discrepancy-role-boundary', async () => {
      await contextHelpers.openHash(page, '#discrepancies', 'discrepancies', ['收发货差异工作台', '差异职责导航']);
      await assertVisibleTexts(page, 'receipt-discrepancy-role-boundary', REQUIRED_TEXTS.discrepancies);
    });

    await runCheck(page, checks, 'rma-role-boundary', async () => {
      await contextHelpers.openHash(page, '#rma', 'rma', ['售后系统', '售后主入口']);
      await assertVisibleTexts(page, 'rma-role-boundary', REQUIRED_TEXTS.rma);
    });

    await runCheck(page, checks, 'samples-role-boundary', async () => {
      await contextHelpers.openHash(page, '#samples', 'samples', ['样品申请', '样品主入口']);
      await assertVisibleTexts(page, 'samples-role-boundary', REQUIRED_TEXTS.samples);
    });

    await runCheck(page, checks, 'contracts-role-boundary', async () => {
      await contextHelpers.openHash(page, '#contracts', 'contracts', ['合同管理中心', '全部合同']);
      await assertVisibleTexts(page, 'contracts-role-boundary', REQUIRED_TEXTS.contracts);
    });

    await runCheck(page, checks, 'assets-role-boundary', async () => {
      await contextHelpers.openHash(page, '#assets', 'assets', ['资产', '资产台账']);
      await page.locator('[data-testid="assets-tab-batch"]').click();
      await assertVisibleTexts(page, 'assets-role-boundary', REQUIRED_TEXTS.assets);
    });

    const report = {
      status: 'passed',
      appUrl: APP_URL,
      runId: RUN_ID,
      checks,
      finishedAt: new Date().toISOString(),
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const report = {
      status: 'failed',
      appUrl: APP_URL,
      runId: RUN_ID,
      checks,
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

void run();
