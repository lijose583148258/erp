function buildBomPasteText(items) {
  return items.map((item) => [
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
  ].join('\t')).join('\n');
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
    await username.fill('admin');
    await password.fill('admin123');
    await Promise.all([page.waitForTimeout(1200), submit.click()]);
  }, shotDir);
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

async function setControlValue(page, query, value, index = 0) {
  await page.evaluate(({ query: controlQuery, nextValue, targetIndex }) => {
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

    const element = matches[targetIndex];
    if (!element) throw new Error(`control not found: ${controlQuery.kind}=${controlQuery.text} index=${targetIndex}`);
    setNativeValue(element, nextValue);
  }, { query, nextValue: value, targetIndex: index });
}

async function setControlByLabel(page, label, value, index = 0) {
  await setControlValue(page, { kind: 'label', text: label }, value, index);
}

async function setControlByPlaceholder(page, placeholder, value, index = 0) {
  await setControlValue(page, { kind: 'placeholder', text: placeholder }, value, index);
}

async function fillBomHeaderFields(page, testData) {
  const bomSection = page.locator('section').filter({ has: page.getByTestId('production-bom-line-grid') }).first();
  const advancedToggle = page.getByTestId('production-bom-toggle-advanced');
  if (await advancedToggle.count()) {
    const toggleText = await advancedToggle.innerText();
    if (/展开/.test(toggleText)) await advancedToggle.click();
  }
  const inputs = bomSection.locator('input');
  const selects = bomSection.locator('select');
  const textareas = bomSection.locator('textarea');

  await inputs.nth(0).fill(testData.bomName);
  await inputs.nth(1).fill(testData.bomVersion);
  await selects.nth(0).selectOption(testData.bomType);
  await selects.nth(1).selectOption(testData.bomStatus);
  await selects.nth(2).selectOption(testData.formulationMode);
  await inputs.nth(2).fill(testData.outputUnit);
  await inputs.nth(3).fill(testData.standardBatchSize);
  await inputs.nth(4).fill(testData.batchSizeUnit);
  await inputs.nth(5).fill(testData.density);
  await inputs.nth(6).fill(testData.solidContent);
  await textareas.nth(0).fill(testData.processSummary);
  await inputs.nth(7).fill(testData.effectiveFrom);
  await inputs.nth(8).fill(testData.effectiveTo);
  await textareas.nth(1).fill(testData.qualitySummary);
}

module.exports = {
  buildBomPasteText,
  fillBomHeaderFields,
  loginViaUi,
  parsePayload,
  setControlByLabel,
  setControlByPlaceholder,
  switchProductionDesk,
  waitForAnyBodyText,
};
