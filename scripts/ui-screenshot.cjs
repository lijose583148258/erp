/**
 * 前端 UI 截图脚本：登录 → 逐页截图到 artifacts 目录
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'output', 'ui-screenshots');
const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');

const TABS = [
  { hash: 'dashboard', label: '仪表盘' },
  { hash: 'crm', label: 'CRM客户' },
  { hash: 'orders', label: '订单' },
  { hash: 'assets', label: '资产' },
  { hash: 'production', label: '生产' },
  { hash: 'procurement', label: '采购' },
  { hash: 'barter', label: '易货' },
  { hash: 'contracts', label: '合同' },
  { hash: 'financeAnalytics', label: '财务分析' },
  { hash: 'collections', label: '收款' },
  { hash: 'adjustment', label: '调整' },
  { hash: 'shipping', label: '物流' },
  { hash: 'samples', label: '样品' },
  { hash: 'risk', label: '风控' },
  { hash: 'rma', label: '售后' },
  { hash: 'team', label: '团队' },
  { hash: 'audit', label: '审计' },
  { hash: 'dealerAnalytics', label: '经销商分析' },
];

(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 收集错误
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  // 1. 登录
  console.log('正在登录...');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('input', { timeout: 10000 });
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].fill('admin');
    await inputs[1].fill('admin123');
  }
  const btn = await page.$('button[type="submit"]') || await page.$('button');
  if (btn) await btn.click();
  await page.waitForTimeout(4000);

  // 截图登录后首页
  const loginScreenshot = path.join(SCREENSHOT_DIR, '00_login_success.png');
  await page.screenshot({ path: loginScreenshot, fullPage: false });
  console.log('✅ 登录成功截图: ' + loginScreenshot);

  // 2. 逐页截图
  for (let i = 0; i < TABS.length; i++) {
    const tab = TABS[i];
    const num = String(i + 1).padStart(2, '0');
    try {
      await page.goto(`${APP_URL}#${tab.hash}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(2500);
      const filePath = path.join(SCREENSHOT_DIR, `${num}_${tab.hash}.png`);
      await page.screenshot({ path: filePath, fullPage: false });
      console.log(`✅ ${tab.label} (${tab.hash})`);
    } catch (e) {
      console.log(`❌ ${tab.label} (${tab.hash}): ${e.message}`);
    }
  }

  // 3. 报告
  if (errors.length > 0) {
    console.log(`\n⚠️ 页面 JS 异常 (${errors.length} 条):`);
    [...new Set(errors)].forEach(e => console.log(`  → ${e.substring(0, 200)}`));
  } else {
    console.log('\n✅ 零 JS 异常');
  }

  await browser.close();
  console.log(`\n截图保存在: ${SCREENSHOT_DIR}`);
})();
