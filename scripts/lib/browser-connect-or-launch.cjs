const { chromium } = require('playwright');
const { launchBrowserWithGuard } = require('./browser-launch-guard.cjs');

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim();
  return endpoint || null;
}

async function connectOverCdp(endpoint, { recordStep, timeoutMs = 10000 } = {}) {
  const startedAt = Date.now();
  recordStep?.({
    step: 'browser-cdp-connect',
    result: 'running',
    endpoint,
    timeoutMs,
  });

  try {
    const browser = await chromium.connectOverCDP(endpoint, {
      timeout: timeoutMs,
      isLocal: true,
    });
    recordStep?.({
      step: 'browser-cdp-connect',
      result: 'passed',
      endpoint,
      durationMs: Date.now() - startedAt,
    });
    return { browser, launcher: 'cdp', endpoint };
  } catch (error) {
    recordStep?.({
      step: 'browser-cdp-connect',
      result: 'failed',
      endpoint,
      durationMs: Date.now() - startedAt,
      error: String(error?.message || error),
    });
    throw error;
  }
}

async function connectOrLaunchBrowser(options = {}) {
  const recordStep = options.recordStep;
  const cdpEndpoint = normalizeEndpoint(options.cdpEndpoint || process.env.BROWSER_CDP_URL);
  const cdpRequired = process.env.BROWSER_CDP_REQUIRED === '1' || options.cdpRequired === true;

  if (!cdpEndpoint && cdpRequired) {
    const requiredError = new Error('BROWSER_CDP_REQUIRED is enabled but BROWSER_CDP_URL is missing.');
    requiredError.auditKind = 'browser_cdp_failed';
    requiredError.auditCode = 'BROWSER_CDP_URL_MISSING';
    requiredError.auditVerdict = 'browser_cdp_url_missing';
    throw requiredError;
  }

  if (cdpEndpoint) {
    try {
      return await connectOverCdp(cdpEndpoint, {
        recordStep,
        timeoutMs: Number(process.env.BROWSER_CDP_TIMEOUT_MS || options.cdpTimeoutMs || 10000),
      });
    } catch (error) {
      if (cdpRequired) {
        const requiredError = new Error(`BROWSER_CDP_REQUIRED failed: ${String(error?.message || error)}`);
        requiredError.auditKind = 'browser_cdp_failed';
        requiredError.auditCode = 'BROWSER_CDP_CONNECT_FAILED';
        requiredError.auditVerdict = 'browser_cdp_failed';
        throw requiredError;
      }
    }
  }

  const launched = await launchBrowserWithGuard({
    recordStep,
    retryLimit: options.retryLimit || 1,
    waitMs: options.waitMs || 1200,
  });
  return {
    ...launched,
    launcher: launched.launcher || 'launch',
  };
}

module.exports = {
  connectOrLaunchBrowser,
  connectOverCdp,
};
