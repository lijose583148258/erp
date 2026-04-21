const fs = require('fs');
const path = require('path');

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function createShippingReport({ appUrl, runId, data }) {
  return {
    appUrl,
    startedAt: new Date().toISOString(),
    runId,
    data,
    steps: [],
    status: 'running',
  };
}

function createReportRecorder(report) {
  return function recordStep(entry) {
    report.steps.push({ at: new Date().toISOString(), ...entry });
  };
}

async function safeScreenshot(page, shotDir, name) {
  const filePath = path.join(shotDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function withTimebox({
  page,
  step,
  timeout,
  task,
  recordStep,
  shotDir,
}) {
  const started = Date.now();
  try {
    const result = await Promise.race([
      task(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${step} exceeded ${timeout}ms`)), timeout)),
    ]);
    recordStep({ step, timeout, result: 'passed', durationMs: Date.now() - started });
    return result;
  } catch (error) {
    const entry = {
      step,
      timeout,
      result: 'failed',
      durationMs: Date.now() - started,
      error: String(error.message || error),
    };
    if (page) {
      try {
        entry.screenshot = await safeScreenshot(page, shotDir, `fail-${step.replace(/[^a-z0-9-]/gi, '_')}`);
      } catch {}
    }
    recordStep(entry);
    throw error;
  }
}

function assertNoMojibake(text, scopeName, markers) {
  for (const keyword of markers) {
    if (text.includes(keyword)) {
      throw new Error(`${scopeName} contains mojibake: ${keyword}`);
    }
  }
}

function compactText(value, limit = 800) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

module.exports = {
  assertNoMojibake,
  compactText,
  createReportRecorder,
  createShippingReport,
  ensureDir,
  safeScreenshot,
  withTimebox,
};
