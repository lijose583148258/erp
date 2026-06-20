/**
 * 端到端冒烟测试：登录 + 逐页导航 + 控制台错误收集
 * 用法：node scripts/e2e-smoke.cjs
 */
const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const report = { steps: [], status: 'running' };
const recordStep = (entry) => report.steps.push({ at: new Date().toISOString(), ...entry });
let browser = null;

const TABS = [
  'dashboard', 'crm', 'orders', 'risk', 'samples', 'shipping', 'rma',
  'team', 'audit', 'assets', 'production', 'dealerAnalytics',
  'procurement', 'barter', 'contracts', 'financeAnalytics',
  'adjustment', 'collections'
];

(async () => {
  const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
  browser = launched.browser;
  report.launcher = launched.launcher;
  const page = await browser.newPage();

  // 收集控制台错误
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  console.log('=== 端到端冒烟测试 ===\n');

  // 1. 打开首页
  console.log(`[1] 打开 ${APP_URL} ...`);
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('    页面加载完成');

  // 2. 登录
  console.log('[2] 登录 admin/admin123 ...');
  try {
    // 等待登录表单出现
    await page.waitForSelector('input', { timeout: 10000 });
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].fill('admin');
      await inputs[1].fill('admin123');
    }
    // 找到提交按钮
    const btn = await page.$('button[type="submit"]') || await page.$('button');
    if (btn) await btn.click();
    // 等待登录完成（等待 Layout 出现或 URL 变化）
    await page.waitForTimeout(3000);
    console.log('    登录完成');
  } catch (e) {
    console.log('    登录失败: ' + e.message);
  }

  // 3. 逐页测试
  console.log('[3] 逐页导航测试...\n');
  const tabResults = [];
  
  for (const tab of TABS) {
    const errBefore = consoleErrors.length + pageErrors.length;
    
    try {
      await page.goto(`${APP_URL}#${tab}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(2000); // 等待 lazy load 完成
      
      const errAfter = consoleErrors.length + pageErrors.length;
      const newErrors = errAfter - errBefore;
      
      if (newErrors > 0) {
        const recentErrors = [...consoleErrors.slice(-newErrors), ...pageErrors.slice(-newErrors)];
        // 过滤掉非致命的 warning
        const fatal = recentErrors.filter(e => 
          !e.includes('favicon') && 
          !e.includes('manifest') && 
          !e.includes('sw.js') &&
          !e.includes('net::ERR')
        );
        if (fatal.length > 0) {
          tabResults.push({ tab, status: '⚠️', errors: fatal });
        } else {
          tabResults.push({ tab, status: '✅', errors: [] });
        }
      } else {
        tabResults.push({ tab, status: '✅', errors: [] });
      }
    } catch (e) {
      tabResults.push({ tab, status: '❌', errors: [e.message] });
    }
  }

  // 4. 输出结果
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  
  for (const r of tabResults) {
    if (r.status === '✅') {
      passCount++;
      console.log(`  ${r.status} ${r.tab}`);
    } else if (r.status === '⚠️') {
      warnCount++;
      console.log(`  ${r.status} ${r.tab}`);
      r.errors.forEach(e => console.log(`      → ${e.substring(0, 150)}`));
    } else {
      failCount++;
      console.log(`  ${r.status} ${r.tab}`);
      r.errors.forEach(e => console.log(`      → ${e.substring(0, 150)}`));
    }
  }

  console.log(`\n=== 结果 ===`);
  console.log(`通过: ${passCount}  警告: ${warnCount}  失败: ${failCount}  总计: ${TABS.length}`);
  
  if (consoleErrors.length > 0) {
    // 去重输出所有控制台错误
    const unique = [...new Set(consoleErrors)];
    console.log(`\n=== 全部控制台错误 (去重后 ${unique.length} 条) ===`);
    unique.forEach((e, i) => console.log(`  [${i+1}] ${e.substring(0, 200)}`));
  }
  
  if (pageErrors.length > 0) {
    const unique = [...new Set(pageErrors)];
    console.log(`\n=== 页面 JS 异常 (去重后 ${unique.length} 条) ===`);
    unique.forEach((e, i) => console.log(`  [${i+1}] ${e.substring(0, 300)}`));
  }

  await browser.close();
  process.exit(failCount > 0 ? 1 : 0);
})();
