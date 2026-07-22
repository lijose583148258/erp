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

const KNOWN_MOJIBAKE_SEQUENCES = [
  [0x951F, 0x65A4, 0x62F7],
  [0x9347, 0x20AC],
  [0x9359, 0x6218],
  [0x9422, 0x7535],
  [0x7039, 0x609A],
  [0x95C6, 0x9E43],
  [0x5CB7, 0x5CC4],
  [0x81BD, 0x5564],
  [0x93CD, 0x56E7, 0x566F],
  [0x93B5, 0x5F52, 0x567A],
  [0x9357, 0x66DA, 0x7D85],
  [0x6E1A, 0x5B2A],
].map((codes) => codes.map((code) => String.fromCharCode(code)).join(''));

function findMojibake(text, { forbidden = [] } = {}) {
  const value = String(text || '');
  for (const marker of forbidden) {
    if (marker && value.includes(marker)) return { code: 'forbidden-text', sample: marker };
  }
  if (value.includes('\uFFFD')) return { code: 'replacement-character', sample: '\uFFFD' };
  const privateUse = value.match(/[\uE000-\uF8FF]/u);
  if (privateUse) return { code: 'private-use-character', sample: privateUse[0] };
  const knownSequence = KNOWN_MOJIBAKE_SEQUENCES.find((sequence) => value.includes(sequence));
  if (knownSequence) return { code: 'known-encoding-sequence', sample: knownSequence };
  return null;
}

function assertNoMojibake(text, scopeName, forbidden = []) {
  const finding = findMojibake(text, { forbidden: ['undefined', ...forbidden] });
  if (!finding) return;
  const codePoint = finding.sample.codePointAt(0)?.toString(16).toUpperCase();
  const suffix = finding.code === 'private-use-character' ? `: U+${codePoint}` : `: ${finding.sample}`;
  throw new Error(`${scopeName} contains ${finding.code}${suffix}`);
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
  findMojibake,
};
