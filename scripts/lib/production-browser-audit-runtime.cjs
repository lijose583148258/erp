const fs = require('fs');

const { loginUiAuditUser } = require('./ui-audit-user.cjs');
const { readAuthTokenFromStorage } = require('./production-browser-audit-helpers.cjs');

function createProductionBrowserAuditRuntime({ appUrl, auditAccount, report, reportPath }) {
  let authToken = '';

  function recordFinal() {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  }

  async function seedAuthToken(page) {
    const session = await loginUiAuditUser(page, appUrl, {
      account: auditAccount,
      storage: {
        'ailao.activeTab': 'production',
        'ailao.language': 'zh',
        language: 'zh',
        currency: 'CNY',
      },
    });
    authToken = session.token;
    if (!authToken) throw new Error('login api returned empty token');
  }

  async function apiFetch(page, endpoint, options = {}) {
    let response = await page.request.fetch(`${appUrl}api${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(options.headers || {}) },
    });
    if (response.status() === 401) {
      await seedAuthToken(page);
      response = await page.request.fetch(`${appUrl}api${endpoint}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(options.headers || {}) },
      });
    }
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { ok: response.ok(), status: response.status(), json };
  }

  async function syncAuthTokenFromPage(page) {
    const token = await readAuthTokenFromStorage(page);
    if (token) authToken = token;
    if (!authToken) throw new Error('audit page has no auth token');
  }

  return { apiFetch, recordFinal, seedAuthToken, syncAuthTokenFromPage };
}

module.exports = { createProductionBrowserAuditRuntime };