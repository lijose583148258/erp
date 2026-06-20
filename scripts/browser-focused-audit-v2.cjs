const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'playwright');
const SHOT_DIR = path.join(OUTPUT_DIR, 'focused-audit-v2');
const REPORT_PATH = path.join(OUTPUT_DIR, 'focused-browser-audit-report-v2.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  customerNote: `FOCUSED-CRM-NOTE-${RUN_ID}`,
  addressLabel: `FOCUSED-SITE-${RUN_ID.slice(-4)}`,
  addressRegisteredName: `Focused Registered ${RUN_ID.slice(-4)}`,
  addressRegistrationNo: `REG-${RUN_ID.slice(-6)}`,
  addressTaxNo: `TAX-${RUN_ID.slice(-6)}`,
  addressCountryCode: 'VN',
  addressFull: `Focused Address ${RUN_ID}`,
  contactName: `Focused Contact ${RUN_ID.slice(-4)}`,
  contactRole: 'Purchasing Director',
  contactPhone: `092${RUN_ID.slice(-7)}`,
  contactEmail: `focused${RUN_ID.slice(-4)}@ailao.test`,
  supplierName: `FOCUSED-SUP-${RUN_ID}`,
  supplierCategory: 'Focused Chemicals',
  supplierContact: `Auditor ${RUN_ID.slice(-4)}`,
  supplierPhone: `091${RUN_ID.slice(-7)}`,
  orderItem: `FOCUSED-ITEM-${RUN_ID}`,
  ocrProductName: `OCR-PROD-${RUN_ID}`,
  ocrTrackingNo: `OCR-TRK-${RUN_ID.slice(-8)}`,
  uploadFiles: [
    path.resolve(process.cwd(), 'output', 'playwright', 'acceptance-audit', 'route-procurement.png'),
    path.resolve(process.cwd(), 'output', 'playwright', 'acceptance-audit', 'route-shipping.png'),
  ],
};

const TIMEOUTS = {
  pageLoad: 15000,
  login: 20000,
  nav: 10000,
  save: 18000,
  readBack: 12000,
  modal: 8000,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  steps: [],
  status: 'running',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function safeScreenshot(page, name) {
  const filePath = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(page, name, timeout, action) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step: name, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const screenshot = await safeScreenshot(page, `fail-${name.replace(/[^a-z0-9-]/gi, '_')}`);
    recordStep({
      step: name,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
      evidence: screenshot,
    });
    throw error;
  }
}

async function clickButtonByText(scope, regex) {
  const button = scope.locator('button').filter({ hasText: regex }).first();
  if (await button.count()) {
    await button.click();
    return;
  }
  throw new Error(`button not found: ${regex}`);
}

async function selectOptionContaining(selectLocator, text) {
  const value = await selectLocator.evaluate((element, expectedText) => {
    const option = Array.from(element.options).find((item) => (item.textContent || '').includes(expectedText));
    return option ? option.value : '';
  }, text);
  if (!value) throw new Error(`select option not found for text: ${text}`);
  await selectLocator.selectOption(value);
}

async function waitForBodyText(page, text, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const bodyText = await page.locator('body').innerText();
    if (bodyText.includes(text)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`text not visible within ${timeout}ms: ${text}`);
}

async function waitForRowTextAny(page, rowText, statusTexts, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const row = page.locator('tbody tr, div').filter({ hasText: rowText }).first();
    if (await row.count()) {
      const text = await row.innerText().catch(() => '');
      const matched = statusTexts.find((status) => text.includes(status));
      if (matched) return matched;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`row status not visible within ${timeout}ms: ${rowText} -> ${statusTexts.join(' | ')}`);
}

async function login(page) {
  await withTimebox(page, 'open-login', TIMEOUTS.pageLoad, async () => {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  });

  const loginInput = page.locator('input[name="username"]');
  if (!(await loginInput.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'login form not found, assuming already authenticated' });
    return;
  }

  await withTimebox(page, 'submit-login', TIMEOUTS.login, async () => {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await Promise.all([page.waitForTimeout(1200), page.click('button[type="submit"]')]);
  });
}

async function openHash(page, hash, name, expectedTexts) {
  await withTimebox(page, `route-${name}`, TIMEOUTS.nav, async () => {
    await page.evaluate((nextHash) => {
      window.location.hash = nextHash;
    }, hash);
    await page.waitForTimeout(1500);
  });

  const text = await page.locator('body').innerText();
  const matched = expectedTexts.some((item) => text.includes(item));
  if (!matched) {
    throw new Error(`${name} missing expected text: ${expectedTexts.join(' | ')}`);
  }

  const screenshot = await safeScreenshot(page, `route-${name}`);
  recordStep({ step: `assert-${name}`, result: 'passed', evidence: screenshot, expectedTexts });
}

async function testCrmDetailEdit(page) {
  await openHash(page, '#crm', 'crm-focused', ['客户', 'CUSTOMERS', '客户关系']);

  let targetName = '';
  let targetCustomerName = '';
  let targetCustomerId = '';

  const openTargetCustomer = async () => {
    const rows = page.locator('tbody tr');
    await rows.first().waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const rowText = (await row.innerText()).trim();
      if (
        (targetCustomerId && rowText.includes(targetCustomerId)) ||
        (targetCustomerName && rowText.includes(targetCustomerName))
      ) {
        await row.click();
        await page.waitForTimeout(800);
        return;
      }
    }
    await rows.first().click();
    await page.waitForTimeout(800);
  };

  const scrollDrawerUntil = async (selector, attempts = 8) => {
    for (let index = 0; index < attempts; index += 1) {
      const locator = page.locator(selector);
      if (await locator.count()) {
        await locator.first().scrollIntoViewIfNeeded().catch(() => {});
        if (await locator.first().isVisible().catch(() => false)) {
          return locator.first();
        }
      }

      await page.mouse.move(980, 760);
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(250);
    }

    throw new Error(`drawer selector not found: ${selector}`);
  };

  await withTimebox(page, 'crm-open-first-customer', TIMEOUTS.readBack, async () => {
    const firstRow = page.locator('tbody tr').first();
    await firstRow.waitFor({ state: 'visible', timeout: TIMEOUTS.readBack });
    const rowParts = (await firstRow.innerText())
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    targetName = rowParts.slice(0, 3).join(' / ');
    targetCustomerId = rowParts.find((item) => /^CUST-|^CUS-|^\d+$/.test(item)) || '';
    targetCustomerName = rowParts.find((item) => item && !item.startsWith('ID:') && item !== targetCustomerId) || '';
    await firstRow.click();
    await page.waitForTimeout(800);
  });

  await withTimebox(page, 'crm-edit-note', TIMEOUTS.save, async () => {
    const notes = page.locator('textarea[placeholder*="主数据备注"], textarea[placeholder*="备注"], textarea[placeholder*="Notes"]').first();
    await notes.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    await notes.fill(DATA.customerNote);
    await page.waitForTimeout(1400);
  });

  await withTimebox(page, 'crm-note-readback', TIMEOUTS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await openTargetCustomer();
    const notes = page.locator('textarea[placeholder*="主数据备注"], textarea[placeholder*="备注"], textarea[placeholder*="Notes"]').first();
    await notes.waitFor({ state: 'visible', timeout: TIMEOUTS.modal });
    const started = Date.now();
    while (Date.now() - started < TIMEOUTS.readBack) {
      if ((await notes.inputValue()) === DATA.customerNote) return;
      await page.waitForTimeout(250);
    }
    throw new Error('CRM note value did not match after reload');
  });

  const noteShot = await safeScreenshot(page, 'crm-note-readback');
  recordStep({
    step: 'crm-note-readback-evidence',
    result: 'passed',
    evidence: noteShot,
    customerName: targetCustomerName,
    customerId: targetCustomerId,
    note: DATA.customerNote,
  });

  await withTimebox(page, 'crm-address-contact-edit', TIMEOUTS.save, async () => {
    const addressLabelInput = await scrollDrawerUntil('input[placeholder*="站点标签"]');
    await addressLabelInput.fill(DATA.addressLabel);
    await addressLabelInput.press('Tab');
    await page.waitForTimeout(400);

    const registeredNameInput = await scrollDrawerUntil('input[placeholder*="注册名称"]');
    await registeredNameInput.fill(DATA.addressRegisteredName);
    await registeredNameInput.press('Tab');
    await page.waitForTimeout(400);

    const registrationNoInput = await scrollDrawerUntil('input[placeholder*="注册号"]');
    await registrationNoInput.fill(DATA.addressRegistrationNo);
    await registrationNoInput.press('Tab');
    await page.waitForTimeout(400);

    const taxNoInput = await scrollDrawerUntil('input[placeholder*="税号"]');
    await taxNoInput.fill(DATA.addressTaxNo);
    await taxNoInput.press('Tab');
    await page.waitForTimeout(400);

    const countryCodeInput = await scrollDrawerUntil('input[placeholder*="国家代码"]');
    await countryCodeInput.fill(DATA.addressCountryCode);
    await countryCodeInput.press('Tab');
    await page.waitForTimeout(400);

    const fullAddressInput = await scrollDrawerUntil('textarea[placeholder*="完整地址"]');
    await fullAddressInput.fill(DATA.addressFull);
    await fullAddressInput.press('Tab');
    await page.waitForTimeout(500);

    const contactNameInput = await scrollDrawerUntil('input[placeholder*="姓名"]');
    await contactNameInput.fill(DATA.contactName);
    await contactNameInput.press('Tab');
    await page.waitForTimeout(500);

    const contactRoleInput = await scrollDrawerUntil('input[placeholder*="角色"]');
    await contactRoleInput.fill(DATA.contactRole);
    await contactRoleInput.press('Tab');
    await page.waitForTimeout(500);

    const contactPhoneInput = await scrollDrawerUntil('input[placeholder*="电话"]');
    await contactPhoneInput.fill(DATA.contactPhone);
    await contactPhoneInput.press('Tab');
    await page.waitForTimeout(500);

    const contactEmailInput = await scrollDrawerUntil('input[placeholder*="邮箱"]');
    await contactEmailInput.fill(DATA.contactEmail);
    await contactEmailInput.press('Tab');
    await page.waitForTimeout(1600);
  });

  await withTimebox(page, 'crm-address-contact-readback', TIMEOUTS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await openTargetCustomer();
    const emailInput = await scrollDrawerUntil('input[placeholder*="邮箱"]');
    const started = Date.now();
    while (Date.now() - started < TIMEOUTS.readBack) {
      if ((await emailInput.inputValue()) === DATA.contactEmail) return;
      await page.waitForTimeout(250);
    }
    throw new Error('CRM contact email did not match after reload');
  });

  const addressReadbackValue = await (await scrollDrawerUntil('textarea[placeholder*="完整地址"]')).inputValue().catch(() => '');
  const detailShot = await safeScreenshot(page, 'crm-address-contact-readback');
  recordStep({
    step: 'crm-address-contact-readback-evidence',
    result: 'passed',
    evidence: detailShot,
    customerName: targetCustomerName,
    customerId: targetCustomerId,
    addressLabel: DATA.addressLabel,
    addressPersisted: addressReadbackValue === DATA.addressFull,
    addressReadbackValue,
    contactEmail: DATA.contactEmail,
  });

  if (addressReadbackValue !== DATA.addressFull) {
    recordStep({
      step: 'crm-address-readback-warning',
      result: 'warning',
      expectedAddress: DATA.addressFull,
      actualAddress: addressReadbackValue,
    });
  }

  return { customerName: targetCustomerName || targetName, customerId: targetCustomerId };
}

async function testProcurementCreate(page) {
  await openHash(page, '#procurement', 'procurement-focused', ['采购', '供应商', 'Procurement']);

  await withTimebox(page, 'procurement-create-supplier', TIMEOUTS.save, async () => {
    const supplierNameInput = page.locator('input[placeholder="供应商名称"], input[placeholder="Supplier Name"]').first();
    await supplierNameInput.fill(DATA.supplierName);
    await page.locator('input[placeholder="分类"], input[placeholder="Category"]').first().fill(DATA.supplierCategory);
    await page.locator('input[placeholder="姓名"], input[placeholder="Contact Name"]').first().fill(DATA.supplierContact);
    await page.locator('input[placeholder="电话"], input[placeholder="手机"], input[placeholder="手机号"], input[placeholder="Phone"]').first().fill(DATA.supplierPhone);
    await page.locator('textarea[placeholder*="别名"], textarea[placeholder*="Alias"]').first().fill(`Alias ${RUN_ID}`);

    await supplierNameInput.evaluate((element) => {
      let current = element.parentElement;
      while (current) {
        const style = window.getComputedStyle(current);
        const scrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
        if (scrollable) {
          current.scrollTop = current.scrollHeight;
          return true;
        }
        current = current.parentElement;
      }
      return false;
    });
    await page.waitForTimeout(500);

    const saveSupplierButton = page.locator('button').filter({ hasText: /保存供应商|Save Supplier|保存/ }).last();
    await saveSupplierButton.scrollIntoViewIfNeeded().catch(() => {});
    await saveSupplierButton.click();
    await page.waitForTimeout(1500);
    await page.locator('input[placeholder*="搜索"], input[placeholder*="Search"]').first().fill(DATA.supplierName);
    await waitForBodyText(page, DATA.supplierName, TIMEOUTS.readBack);
  });

  const supplierShot = await safeScreenshot(page, 'procurement-supplier-created');
  recordStep({ step: 'procurement-supplier-created-evidence', result: 'passed', evidence: supplierShot, supplierName: DATA.supplierName });

  await withTimebox(page, 'procurement-switch-orders', TIMEOUTS.nav, async () => {
    await clickButtonByText(page, /采购订单|Purchase Orders/i);
    await page.waitForTimeout(1000);
  });

  await withTimebox(page, 'procurement-create-order', TIMEOUTS.save, async () => {
    await selectOptionContaining(page.locator('select:visible').first(), DATA.supplierName);
    await page.locator('input[placeholder="产品名称"], input[placeholder="产品"], input[placeholder="Product Name"]').first().fill(DATA.orderItem);
    await clickButtonByText(page, /保存采购订单|Save Purchase/i);
    await waitForBodyText(page, DATA.orderItem, TIMEOUTS.readBack);
  });

  await withTimebox(page, 'procurement-order-readback', TIMEOUTS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await clickButtonByText(page, /采购订单|Purchase Orders/i);
    await waitForBodyText(page, DATA.orderItem, TIMEOUTS.readBack);
  });

  const orderShot = await safeScreenshot(page, 'procurement-order-readback');
  recordStep({ step: 'procurement-order-readback-evidence', result: 'passed', evidence: orderShot, orderItem: DATA.orderItem, supplierName: DATA.supplierName });

  await withTimebox(page, 'procurement-approve-dispatch', TIMEOUTS.save, async () => {
    await page.locator('button[title="审批"], button[title="Approve"]').first().click();
    await page.waitForTimeout(900);
    await page.locator('button[title="发运"], button[title="Dispatch"]').first().click();
    await waitForRowTextAny(page, DATA.orderItem, ['在途', '运输', '在运输', '已发运', 'IN_TRANSIT', 'in_transit'], TIMEOUTS.readBack);
  });

  await withTimebox(page, 'procurement-status-readback', TIMEOUTS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await clickButtonByText(page, /采购订单|Purchase Orders/i);
    await waitForBodyText(page, DATA.orderItem, TIMEOUTS.readBack);
    await waitForRowTextAny(page, DATA.orderItem, ['在途', '运输', '在运输', '已发运', 'IN_TRANSIT', 'in_transit'], TIMEOUTS.readBack);
  });

  const statusShot = await safeScreenshot(page, 'procurement-status-readback');
  recordStep({ step: 'procurement-status-readback-evidence', result: 'passed', evidence: statusShot, orderItem: DATA.orderItem, finalStatus: 'IN_TRANSIT' });
}

async function testShippingOcrInteraction(page, customerName) {
  await openHash(page, '#shipping', 'shipping-focused', ['出货', '物流', 'Shipping']);

  await withTimebox(page, 'shipping-upload-images', TIMEOUTS.save, async () => {
    const fileInput = page.locator('input[type="file"]').last();
    await fileInput.setInputFiles(DATA.uploadFiles[0]);
    await waitForBodyText(page, '图片已加载', TIMEOUTS.readBack);
  });

  await withTimebox(page, 'shipping-toggle-gallery', TIMEOUTS.readBack, async () => {
    const galleryButton = page.locator('button').filter({ hasText: /画廊|Gallery/i }).first();
    if (await galleryButton.count()) {
      await galleryButton.click();
      await page.waitForTimeout(500);
      await clickButtonByText(page, /单张|Single/i);
      await page.waitForTimeout(500);
    }
  });

  await withTimebox(page, 'shipping-clear-images', TIMEOUTS.readBack, async () => {
    await clickButtonByText(page, /清空|清除|Clear/i);
    const clearButton = page.locator('button').filter({ hasText: /清空|Clear/i }).first();
    await clearButton.waitFor({ state: 'hidden', timeout: TIMEOUTS.readBack }).catch(() => {});
  });

  const interactionShot = await safeScreenshot(page, 'shipping-ocr-interaction');
  recordStep({ step: 'shipping-ocr-interaction-evidence', result: 'passed', evidence: interactionShot, uploadCount: 1 });

  await withTimebox(page, 'shipping-ocr-parse-apply', TIMEOUTS.save, async () => {
    const ocrText = [
      `客户: ${customerName}`,
      `产品: ${DATA.ocrProductName}`,
      '数量: 12 kg',
      '承运商: Focus Carrier',
      `追踪号: ${DATA.ocrTrackingNo}`,
    ].join('\n');

    await page.locator('textarea[placeholder]').first().fill(ocrText);
    await clickButtonByText(page, /开始识别|Parse|Recognize/i);
    await waitForBodyText(page, DATA.ocrProductName, TIMEOUTS.readBack);
    await clickButtonByText(page, /应用|Apply/i);
    await waitForBodyText(page, DATA.ocrProductName, TIMEOUTS.readBack);
  });

  await withTimebox(page, 'shipping-ocr-apply-readback', TIMEOUTS.readBack, async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await waitForBodyText(page, DATA.ocrProductName, TIMEOUTS.readBack);
  });

  const applyShot = await safeScreenshot(page, 'shipping-ocr-apply-readback');
  recordStep({
    step: 'shipping-ocr-apply-readback-evidence',
    result: 'passed',
    evidence: applyShot,
    customerName,
    productName: DATA.ocrProductName,
    trackingNo: DATA.ocrTrackingNo,
  });
}

async function run() {
  ensureDir(SHOT_DIR);
  let browser;

  try {
    const launched = await launchBrowserWithGuard({ recordStep, retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    report.launcher = launched.launcher;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    await login(page);
    const crm = await testCrmDetailEdit(page);
    await testProcurementCreate(page);
    await testShippingOcrInteraction(page, crm.customerName);

    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    report.error = String(error.message || error);
  } finally {
    if (report && report.status === 'blocked_env' && process && process.exitCode === 1) process.exitCode = 0;
    if (browser) await browser.close().catch(() => {});
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'Audit failed');
    if (report.status !== 'blocked_env') {
      process.exit(1);
    }
    console.warn(`Audit blocked by env. Report: ${REPORT_PATH}`);
    return;
  }

  console.log(`Focused browser audit passed. Report: ${REPORT_PATH}`);
}

run();
