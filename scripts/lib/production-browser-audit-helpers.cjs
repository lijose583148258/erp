function buildBomPasteText(items) {
  return items
    .map((item) => [
      item.materialName,
      item.materialCode,
      item.ingredientRole,
      item.dosageMode,
      item.percentage,
      item.quantityPerUnit,
      item.unit,
      item.lossRate,
      item.allowedVarianceRate,
      item.processStage,
      item.substituteGroup,
      item.yieldContribution,
      item.notes,
    ].join('\t'))
    .join('\n');
}

function parsePayload(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data || null;
}

async function waitForAnyBodyText(page, expectedTexts, timeout) {
  const started = Date.now();
  const items = Array.isArray(expectedTexts) ? expectedTexts : [expectedTexts];
  while (Date.now() - started < timeout) {
    const bodyText = await page.locator('body').innerText();
    const matched = items.find((item) => bodyText.includes(item));
    if (matched) return { bodyText, matched };
    await page.waitForTimeout(300);
  }
  throw new Error(`expected any text not visible within ${timeout}ms: ${items.join(' | ')}`);
}

async function loginViaUi(page, {
  appUrl,
  recordStep,
  withTimebox,
  timeout,
  shotDir,
  account,
}) {
  await withTimebox(page, recordStep, 'open-login', timeout, async () => {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  }, shotDir);

  const username = page.locator('input[name="username"]');
  const password = page.locator('input[name="password"]');
  const submit = page.locator('button[type="submit"]');
  if (!(await username.count()) || !(await password.count()) || !(await submit.count())) {
    recordStep({ step: 'login-form-detection', result: 'skipped', reason: 'login form not found, using existing session' });
    return;
  }

  await withTimebox(page, recordStep, 'submit-login', timeout, async () => {
    await username.fill(account?.username || process.env.AUDIT_UI_USERNAME || 'ui_smoke_admin');
    await password.fill(account?.password || process.env.AUDIT_UI_PASSWORD || 'AuditSmoke12345!');
    await Promise.all([page.waitForTimeout(1200), submit.click()]);
  }, shotDir);
}

async function readAuthTokenFromStorage(page) {
  return page.evaluate(() => (
    window.localStorage.getItem('token')
    || window.localStorage.getItem('auth_token')
    || window.localStorage.getItem('erp_auth_token')
    || ''
  )).catch(() => '');
}

async function switchProductionDesk(page, { testId, fallbackName, expectedText }, waitForBodyText, timeout) {
  const desk = page.getByTestId(testId);
  if (await desk.count()) {
    await desk.click();
  } else {
    await page.getByRole('button', { name: fallbackName }).click();
  }
  await waitForBodyText(page, [expectedText], timeout);
}

async function setControlValue(page, query, value) {
  await page.evaluate(({ query: controlQuery, nextValue }) => {
    const normalize = (text) => String(text || '').replace(/\s+/g, '');
    const setNativeValue = (element, rawValue) => {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (!descriptor?.set) throw new Error(`control value setter not found for ${controlQuery.kind}`);
      descriptor.set.call(element, rawValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    let matches = [];
    if (controlQuery.kind === 'placeholder') {
      matches = [...document.querySelectorAll('input, textarea')]
        .filter((element) => normalize(element.getAttribute('placeholder')).includes(normalize(controlQuery.text)));
    } else {
      matches = [...document.querySelectorAll('label')]
        .filter((labelElement) => normalize(labelElement.innerText).includes(normalize(controlQuery.text)))
        .map((labelElement) => labelElement.querySelector('input, textarea, select'))
        .filter(Boolean);
    }

    const element = matches[0];
    if (!element) throw new Error(`control not found: ${controlQuery.kind}=${controlQuery.text}`);
    setNativeValue(element, nextValue);
  }, { query, nextValue: value });
}

async function setControlByLabel(page, label, value) {
  await setControlValue(page, { kind: 'label', text: label }, value);
}

async function setControlByPlaceholder(page, placeholder, value) {
  await setControlValue(page, { kind: 'placeholder', text: placeholder }, value);
}

async function setControlByTestId(page, testId, value) {
  await page.evaluate(({ nextTestId, nextValue }) => {
    const element = document.querySelector(`[data-testid="${nextTestId}"]`);
    if (!element) throw new Error(`control not found: testId=${nextTestId}`);

    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!descriptor?.set) throw new Error(`control value setter not found for testId=${nextTestId}`);
    descriptor.set.call(element, nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, { nextTestId: testId, nextValue: value });
}

async function fillBomHeaderFields(page, testData) {
  await page.getByTestId('production-bom-product-name').fill(testData.bomName);
  await page.getByTestId('production-bom-output-unit').fill(testData.outputUnit);
  await page.getByTestId('production-bom-shelf-life-days').fill(testData.shelfLifeDays);
  await page.getByTestId('production-bom-standard-batch-size').fill(testData.standardBatchSize);
  const advancedToggle = page.getByTestId('production-bom-toggle-advanced');
  if (await advancedToggle.count()) {
    const isVisible = await page.getByTestId('production-bom-density').count().catch(() => 0);
    if (!isVisible) await advancedToggle.click();
  }
  await setControlByTestId(page, 'production-bom-version', testData.bomVersion);
  await setControlByTestId(page, 'production-bom-type', testData.bomType);
  await setControlByTestId(page, 'production-bom-status', testData.bomStatus);
  await setControlByTestId(page, 'production-bom-formulation-mode', testData.formulationMode);
  await setControlByTestId(page, 'production-bom-batch-size-unit', testData.batchSizeUnit);
  await setControlByTestId(page, 'production-bom-density', testData.density);
  await setControlByTestId(page, 'production-bom-solid-content', testData.solidContent);
  await setControlByTestId(page, 'production-bom-effective-from', testData.effectiveFrom);
  await setControlByTestId(page, 'production-bom-effective-to', testData.effectiveTo);
  await setControlByTestId(page, 'production-bom-process-text', testData.processSummary);
  await setControlByTestId(page, 'production-bom-quality-spec-text', testData.qualitySummary);
}

async function openProductionRoute(page, recordStep, {
  appUrl,
  assertNoMojibake,
  forbiddenMojibake,
  routeCopy,
  routeTimeout,
  safeScreenshot,
  shotDir,
  withTimebox,
}) {
  await withTimebox(page, recordStep, 'open-production-route', routeTimeout, async () => {
    await page.goto(`${appUrl}#production`, { waitUntil: 'domcontentloaded', timeout: routeTimeout });
    await page.evaluate(() => {
      window.localStorage.setItem('ailao.activeTab', 'production');
      window.location.hash = '#production';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitForAnyBodyText(page, routeCopy, routeTimeout);
    assertNoMojibake(await page.locator('body').innerText(), 'production route', forbiddenMojibake);
  }, shotDir);
  recordStep({ step: 'production-route-evidence', result: 'passed', evidence: await safeScreenshot(page, shotDir, 'production-route') });
}

module.exports = {
  buildBomPasteText,
  fillBomHeaderFields,
  loginViaUi,
  openProductionRoute,
  parsePayload,
  readAuthTokenFromStorage,
  setControlByLabel,
  setControlByPlaceholder,
  setControlByTestId,
  switchProductionDesk,
  waitForAnyBodyText,
};
