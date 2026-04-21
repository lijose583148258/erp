const fs = require('fs');
const path = require('path');

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function createAuditRuntime({
  appUrl,
  outputDir,
  report,
  reportPath,
  requestTimeoutMs = 10_000,
}) {
  function recordStep(entry) {
    report.steps.push({
      at: new Date().toISOString(),
      ...entry,
    });
  }

  function parseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: String(text).slice(0, 800) };
    }
  }

  function dataOf(response) {
    return response?.json?.data ?? null;
  }

  function listOf(response) {
    const data = dataOf(response);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  function expect(condition, message, details) {
    if (!condition) {
      const error = new Error(message);
      error.details = details;
      throw error;
    }
  }

  function expectStatus(response, expected, label) {
    if (!expected.includes(response.status)) {
      const error = new Error(`${label}: expected ${expected.join('/')} but got ${response.status}`);
      error.status = response.status;
      error.details = response.json;
      throw error;
    }
  }

  async function withTimeout(label, timeoutMs, task) {
    const startedAt = Date.now();
    let timer = null;
    try {
      const result = await Promise.race([
        task(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms and is treated as stuck.`)), timeoutMs);
        }),
      ]);
      recordStep({ step: label, result: 'passed', timeoutMs, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      recordStep({
        step: label,
        result: 'failed',
        timeoutMs,
        durationMs: Date.now() - startedAt,
        error: String(error?.message || error),
        details: error?.details || null,
      });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function apiFetch(endpoint, options = {}, token = '') {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Timeout after ${requestTimeoutMs}ms for ${endpoint}`)),
      requestTimeoutMs,
    );

    try {
      const response = await fetch(`${appUrl}api${endpoint}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
        body: options.data === undefined ? undefined : JSON.stringify(options.data),
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        json: parseJson(text),
        text,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function saveScreenshot(page, name) {
    const filePath = path.join(outputDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  async function assertBodyClean(page, label, forbiddenTokens) {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    for (const token of forbiddenTokens) {
      if (bodyText.includes(token)) {
        throw new Error(`${label}: forbidden UI token detected: ${token}`);
      }
    }
    return bodyText;
  }

  async function saveReport() {
    ensureDir(path.dirname(reportPath));
    report.finishedAt = new Date().toISOString();
    report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return {
    apiFetch,
    assertBodyClean,
    dataOf,
    ensureDir,
    expect,
    expectStatus,
    listOf,
    recordStep,
    saveReport,
    saveScreenshot,
    withTimeout,
  };
}

function toDatetimeLocal(value) {
  const pad = (item) => String(item).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

module.exports = {
  createAuditRuntime,
  ensureDir,
  toDatetimeLocal,
};
