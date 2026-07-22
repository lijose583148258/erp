const fs = require('fs');
const path = require('path');

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function createStepRecorder(report, reportPath) {
  return function recordStep(entry) {
    report.steps.push({ at: new Date().toISOString(), ...entry });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  };
}

function createStallGuard(report, maxMs = 5 * 60 * 1000) {
  const startedAt = Date.now();

  function assertAlive(stage) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > maxMs) {
      const error = new Error(`${stage} exceeded ${maxMs}ms and is treated as stuck`);
      error.auditKind = 'stuck_timeout';
      error.auditCode = 'AUDIT_STUCK_TIMEOUT';
      error.auditVerdict = 'stuck';
      error.elapsedMs = elapsedMs;
      throw error;
    }
    report.elapsedMs = elapsedMs;
  }

  return { assertAlive, startedAt };
}

async function safeScreenshot(page, shotDir, name) {
  const filePath = path.join(shotDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox(page, recordStep, step, timeout, task, shotDir) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const screenshot = shotDir ? await safeScreenshot(page, shotDir, `fail-${step.replace(/[^a-z0-9-]/gi, '_')}`) : null;
    recordStep({
      step,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
      screenshot,
    });
    throw error;
  }
}

async function waitForBodyText(page, expectedTexts, timeout) {
  const started = Date.now();
  const items = Array.isArray(expectedTexts) ? expectedTexts : [expectedTexts];
  while (Date.now() - started < timeout) {
    const bodyText = await page.locator('body').innerText();
    if (items.every((item) => bodyText.includes(item))) {
      return bodyText;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`expected text not visible within ${timeout}ms: ${items.join(' | ')}`);
}

async function waitForRowByText(page, text, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const row = page.locator('tbody tr').filter({ hasText: text }).first();
    if (await row.count()) {
      return row;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`row not visible within ${timeout}ms: ${text}`);
}

function assertNoMojibake(text, scopeName, forbidden = []) {
  const markers = ['undefined', '\ufffd', ...forbidden];
  for (const marker of markers) {
    if (marker && text.includes(marker)) {
      throw new Error(`${scopeName} contains forbidden text: ${marker}`);
    }
  }
  const privateUse = text.match(/[\uE000-\uF8FF]/u);
  if (privateUse) {
    throw new Error(`${scopeName} contains a private-use mojibake character: U+${privateUse[0].codePointAt(0).toString(16).toUpperCase()}`);
  }
  const knownGbkLabel = text.match(/(?:\u93cd\u56e7\u566f|\u93b5\u5f52\u567a|\u9357\u66da\u7d85|\u6e1a\u5b2a)/u);
  if (knownGbkLabel) {
    throw new Error(`${scopeName} contains a known GBK mojibake sequence: ${knownGbkLabel[0]}`);
  }
}

module.exports = {
  ensureDir,
  createStepRecorder,
  createStallGuard,
  safeScreenshot,
  withTimebox,
  waitForBodyText,
  waitForRowByText,
  assertNoMojibake,
};
