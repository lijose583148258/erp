const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchBrowserWithGuard } = require('./lib/browser-launch-guard.cjs');
const { loginUiAuditUser } = require('./lib/ui-audit-user.cjs');

const VIEWPORTS = [
  { id: 'desktop-lg', width: 1440, height: 900, isMobile: false },
  { id: 'desktop-md', width: 1366, height: 768, isMobile: false },
  { id: 'laptop-sm', width: 1280, height: 720, isMobile: false },
  { id: 'tablet-portrait', width: 768, height: 1024, isMobile: false },
  { id: 'tablet-landscape', width: 1024, height: 768, isMobile: false },
  { id: 'mobile-lg', width: 430, height: 932, isMobile: true },
  { id: 'mobile-md', width: 390, height: 844, isMobile: true },
  { id: 'mobile-sm', width: 360, height: 740, isMobile: true },
];

const FALLBACK_ROUTES = [
  '#dashboard',
  '#crm',
  '#orders',
  '#collections',
  '#adjustment',
  '#financeAnalytics',
  '#contracts',
  '#barter',
  '#risk',
  '#dealerAnalytics',
  '#samples',
  '#shipping',
  '#discrepancies',
  '#rma',
  '#team',
  '#assets',
  '#production',
  '#warehouse',
  '#procurement',
  '#audit',
];

const DESTRUCTIVE_TEXT = /delete|remove|archive|void|cancel order|submit|save|confirm|approve|reject|支付|删除|移除|作废|提交|保存|确认|审批|拒绝/i;
const MOJIBAKE_SEQUENCES = [
  [0x951F, 0x65A4, 0x62F7],
  [0x9347, 0x20AC],
  [0x9359, 0x6218],
  [0x9422, 0x7535],
  [0x7039, 0x609A],
  [0x95C6, 0x9E43],
  [0x5CB7, 0x5CC4],
  [0x81BD, 0x5564],
].map((codes) => codes.map((code) => String.fromCharCode(code)).join(''));
const MOJIBAKE_PATTERN = new RegExp(`[\\uFFFD]|(?:[\\u00C0-\\u00FF]{2,})|(?:${MOJIBAKE_SEQUENCES.join('|')})`);

function boolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  if (raw === '1' || /^true$/i.test(raw)) return true;
  if (raw === '0' || /^false$/i.test(raw)) return false;
  throw new Error(`${name} must be a boolean value: 0/1/true/false`);
}

function intEnv(name, defaultValue, min = 1) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return value;
}

function enumEnv(name, defaultValue, allowed) {
  const value = process.env[name] || defaultValue;
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function parseConfig() {
  return {
    appUrl: process.env.APP_URL || 'http://127.0.0.1:5001/',
    username: process.env.AUDIT_ADMIN_USERNAME || 'ui_ux_audit_admin',
    password: process.env.AUDIT_ADMIN_PASSWORD || 'AuditSmoke12345!',
    forcedRoutes: (process.env.UI_UX_AUDIT_ROUTES || '')
      .split(',')
      .map((item) => normalizeRoute(item))
      .filter(Boolean),
    maxRoutes: intEnv('UI_UX_AUDIT_MAX_ROUTES', 30, 1),
    timeoutMs: intEnv('UI_UX_AUDIT_TIMEOUT_MS', 420000, 1000),
    pageTimeoutMs: intEnv('UI_UX_AUDIT_PAGE_TIMEOUT_MS', 15000, 1000),
    failOnWarnings: boolEnv('UI_UX_AUDIT_FAIL_ON_WARNINGS', false),
    failOnConsoleErrors: boolEnv('UI_UX_AUDIT_FAIL_ON_CONSOLE_ERRORS', true),
    ignoreConsolePattern: regexEnv('UI_UX_AUDIT_IGNORE_CONSOLE_PATTERN'),
    ignoreHttpPattern: regexEnv('UI_UX_AUDIT_IGNORE_HTTP_PATTERN'),
    screenshotMode: enumEnv('UI_UX_AUDIT_SCREENSHOT_MODE', 'viewport', ['fullPage', 'viewport']),
    traceOnFailure: boolEnv('UI_UX_AUDIT_TRACE_ON_FAILURE', false),
    reducedMotion: boolEnv('UI_UX_AUDIT_REDUCED_MOTION', true),
    colorScheme: enumEnv('UI_UX_AUDIT_COLOR_SCHEME', 'light', ['light', 'dark', 'both']),
  };
}

function regexEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return new RegExp(raw, 'i');
  } catch (error) {
    throw new Error(`${name} is not a valid regex: ${String(error.message || error)}`);
  }
}

function normalizeRoute(value) {
  const route = String(value || '').trim();
  if (!route) return '';
  if (route.startsWith('#/')) return `#${route.slice(2)}`;
  if (route.startsWith('#')) return route;
  if (route.startsWith('/#')) return route.slice(1);
  if (route.startsWith('/')) return `#${route}`;
  return `#${route}`;
}

function safeName(value) {
  return String(value || 'root')
    .replace(/^#\/?/, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'root';
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function createRun(config) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const runId = `${stamp}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const root = path.join(process.cwd(), 'output', 'ui-ux-audit', runId);
  const report = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    durationMs: 0,
    appUrl: config.appUrl,
    routes: [],
    discoveredRoutes: [],
    fallbackRoutes: FALLBACK_ROUTES,
    skippedRoutes: [],
    viewports: VIEWPORTS.map(({ id, width, height }) => ({ id, width, height })),
    summary: {
      routesAudited: 0,
      viewportRuns: 0,
      stateRuns: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      screenshots: 0,
    },
    results: [],
    findings: [],
    artifacts: {
      screenshots: [],
      traces: [],
      rawDom: [],
    },
  };
  return { runId, root, report, startedAt: Date.now() };
}

function addFinding(report, finding) {
  report.findings.push({
    severity: finding.severity || 'warning',
    category: finding.category || 'runtime',
    code: finding.code || 'AUDIT_FINDING',
    message: finding.message || 'Audit finding',
    route: finding.route || '',
    viewport: finding.viewport || '',
    state: finding.state || 'initial',
    selector: finding.selector || null,
    bbox: finding.bbox || null,
    screenshot: finding.screenshot || null,
    details: finding.details || {},
  });
}

async function saveScreenshot(page, run, route, viewport, state, failure = false) {
  const folder = failure ? 'failures' : 'screenshots';
  const relative = path.join(folder, safeName(route), viewport.id, `${safeName(state)}${failure ? '-failure' : ''}.png`);
  const filePath = path.join(run.root, relative);
  ensureDir(path.dirname(filePath));
  await page.screenshot({
    path: filePath,
    fullPage: run.config.screenshotMode === 'fullPage',
  });
  run.report.artifacts.screenshots.push(relative.replace(/\\/g, '/'));
  run.report.summary.screenshots += 1;
  return relative.replace(/\\/g, '/');
}

async function writeRawDom(page, run, route, viewport, state) {
  const relative = path.join('raw', safeName(route), viewport.id, `${safeName(state)}-dom.json`);
  const filePath = path.join(run.root, relative);
  const data = await page.evaluate(() => ({
    title: document.title,
    location: window.location.href,
    bodyTextLength: document.body ? document.body.innerText.length : 0,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 30).map((node) => ({
      tag: node.tagName.toLowerCase(),
      text: (node.textContent || '').trim().slice(0, 120),
    })),
    buttons: Array.from(document.querySelectorAll('button')).slice(0, 80).map((node) => ({
      text: (node.textContent || node.getAttribute('aria-label') || node.title || '').trim().slice(0, 120),
      disabled: node.disabled,
    })),
  }));
  atomicWrite(filePath, JSON.stringify(data, null, 2));
  run.report.artifacts.rawDom.push(relative.replace(/\\/g, '/'));
}

async function discoverRoutes(page, config, report) {
  if (config.forcedRoutes.length) {
    report.discoveredRoutes = [];
    return [...new Set(config.forcedRoutes)].slice(0, config.maxRoutes);
  }

  const discovered = await page.evaluate(() => {
    const candidates = new Set();
    for (const node of document.querySelectorAll('a[href], [role="link"][href]')) {
      const href = node.getAttribute('href') || '';
      if (href.includes('#')) candidates.add(href.slice(href.indexOf('#')));
    }
    for (const node of document.querySelectorAll('[data-route], [data-module], [data-tab]')) {
      const value = node.getAttribute('data-route') || node.getAttribute('data-module') || node.getAttribute('data-tab') || '';
      if (value) candidates.add(value.startsWith('#') ? value : `#${value}`);
    }
    return Array.from(candidates);
  });

  const normalizedDiscovered = discovered.map(normalizeRoute).filter(Boolean);
  const routes = [...new Set([...normalizedDiscovered, ...FALLBACK_ROUTES])].slice(0, config.maxRoutes);
  report.discoveredRoutes = normalizedDiscovered;
  return routes;
}

function installPageCollectors(page, run) {
  const routeErrors = [];
  const httpFailures = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (run.config.ignoreConsolePattern?.test(text)) return;
    routeErrors.push({ type: message.type(), message: text, location: message.location() });
  });

  page.on('pageerror', (error) => {
    const text = String(error.message || error);
    if (run.config.ignoreConsolePattern?.test(text)) return;
    routeErrors.push({ type: 'pageerror', message: text, stack: error.stack || '' });
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (run.config.ignoreHttpPattern?.test(url)) return;
    httpFailures.push({ url, failure: request.failure()?.errorText || 'request failed' });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status < 400 || run.config.ignoreHttpPattern?.test(url)) return;
    if (/favicon|analytics|telemetry/i.test(url)) return;
    httpFailures.push({ url, status });
  });

  return {
    routeErrors,
    httpFailures,
    clear() {
      routeErrors.length = 0;
      httpFailures.length = 0;
    },
  };
}

async function waitForAppSettled(page, timeoutMs) {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) }).catch(() => {});
  await page.waitForTimeout(250);
}

async function auditState(page, run, route, viewport, state, collectors) {
  const screenshot = await saveScreenshot(page, run, route, viewport, state);
  await writeRawDom(page, run, route, viewport, state);
  run.report.summary.stateRuns += 1;
  run.report.results.push({
    route,
    viewport: viewport.id,
    state,
    screenshot: screenshot ? path.join(run.root, screenshot) : null,
  });

  const findings = await page.evaluate(({ route, viewportId, state, isMobile }) => {
    const result = [];
    const visible = (element) => {
      if (element.closest('[aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const labelFor = (element) => {
      const id = element.id ? `#${element.id}` : '';
      const testId = element.getAttribute('data-testid');
      const tag = element.tagName.toLowerCase();
      return testId ? `${tag}[data-testid="${testId}"]` : `${tag}${id}`;
    };
    const nameOf = (element) => (
      element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.getAttribute('placeholder')
      || element.closest('label')?.textContent
      || element.textContent
      || ''
    ).trim();
    const add = (severity, category, code, message, element, details = {}) => {
      const rect = element?.getBoundingClientRect?.();
      const elementName = element ? nameOf(element).slice(0, 80) : '';
      const elementClass = element?.getAttribute?.('class') || '';
      result.push({
        severity,
        category,
        code,
        message,
        route,
        viewport: viewportId,
        state,
        selector: element ? labelFor(element) : null,
        bbox: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        details: {
          ...details,
          name: elementName || undefined,
          className: elementClass ? elementClass.slice(0, 180) : undefined,
        },
      });
    };
    const hasScrollableAncestor = (element) => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (/(auto|scroll)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) return true;
        current = current.parentElement;
      }
      return false;
    };

    if (!document.title.trim()) add('error', 'accessibility', 'EMPTY_DOCUMENT_TITLE', 'document.title is empty', document.documentElement);
    if (!document.querySelector('main, [role="main"]')) add('warning', 'accessibility', 'MISSING_MAIN_LANDMARK', 'Page lacks a main landmark', document.body);
    if (!document.querySelector('nav, [role="navigation"], aside, header')) add('error', 'interaction', 'MISSING_NAVIGATION', 'No stable navigation landmark was found', document.body);
    if (!document.querySelector('h1,h2,[data-page-title]')) add('error', 'accessibility', 'MISSING_VISIBLE_PAGE_TITLE', 'No visible page title or heading was found', document.body);
    if (document.documentElement.scrollWidth > window.innerWidth + 2 && !document.querySelector('[data-testid*="grid"], .overflow-x-auto, [class*="overflow-x-auto"]')) {
      add('error', 'layout', 'DOCUMENT_HORIZONTAL_OVERFLOW', 'Document has horizontal overflow outside a known scroll container', document.documentElement, {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      });
    }

    for (const element of Array.from(document.querySelectorAll('button,a,input,select,textarea,[role="button"],[role="menu"],[role="dialog"],[data-testid*="toast"]'))) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const labelRect = element.closest('label')?.getBoundingClientRect?.();
      const hitRect = labelRect && labelRect.width >= rect.width && labelRect.height >= rect.height ? labelRect : rect;
      const interactive = element.matches('button,a,input,select,textarea,[role="button"]');
      const nativeSmallControl = element.matches('input[type="checkbox"],input[type="radio"],input[type="range"]');
      const name = nameOf(element);
      if (interactive && !name) add('error', 'accessibility', 'CONTROL_MISSING_NAME', 'Interactive control has no accessible name', element);
      if (interactive && !nativeSmallControl && (hitRect.width < 24 || hitRect.height < 24)) add('error', 'interaction', 'CLICK_TARGET_TOO_SMALL', 'Click target is smaller than 24x24px', element, { width: hitRect.width, height: hitRect.height });
      if (interactive && !nativeSmallControl && isMobile && (hitRect.width < 32 || hitRect.height < 32)) add('error', 'interaction', 'MOBILE_CLICK_TARGET_TOO_SMALL', 'Mobile click target is smaller than 32x32px', element, { width: hitRect.width, height: hitRect.height });
      if ((rect.right > window.innerWidth + 4 || rect.left < -4) && !hasScrollableAncestor(element)) {
        add('error', 'layout', 'ELEMENT_OUTSIDE_VIEWPORT', 'Visible control extends outside viewport', element);
      }
      if ((element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2) && name.length > 0 && !element.getAttribute('title')) {
        add('warning', 'visual', 'TEXT_CLIPPED_WITHOUT_FULL_TEXT', 'Text appears clipped without title/full-text fallback', element);
      }
    }

    for (const field of Array.from(document.querySelectorAll('input,select,textarea'))) {
      if (!visible(field)) continue;
      const hasLabel = (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)) || field.closest('label');
      const hasName = hasLabel || field.getAttribute('aria-label') || field.getAttribute('aria-labelledby') || field.getAttribute('placeholder') || field.getAttribute('title');
      if (!hasName) add('error', 'accessibility', 'FIELD_MISSING_NAME', 'Form field has no accessible name', field);
      const focusStyle = window.getComputedStyle(field, ':focus');
      if (!focusStyle.outlineStyle && !focusStyle.boxShadow) add('warning', 'interaction', 'FIELD_FOCUS_STYLE_WEAK', 'Field may lack a visible focus style', field);
    }

    const textNodes = Array.from(document.body.querySelectorAll('body *')).filter((element) => visible(element) && (element.textContent || '').trim().length > 0);
    for (const element of textNodes.slice(0, 350)) {
      const style = window.getComputedStyle(element);
      const size = Number.parseFloat(style.fontSize || '0');
      const text = (element.textContent || '').trim();
      if (size && size < 11 && text.length > 1) add('warning', 'visual', 'TINY_TEXT', 'Visible text is below 11px', element, { fontSize: size, text: text.slice(0, 80) });
      if (/[\uFFFD]/.test(text)) add('error', 'visual', 'MOJIBAKE_REPLACEMENT_CHAR', 'Visible text contains replacement characters', element, { text: text.slice(0, 120) });
    }

    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      if (!visible(table)) continue;
      const cols = table.querySelectorAll('thead th, tbody tr:first-child td').length;
      if (isMobile && cols > 12 && !hasScrollableAncestor(table)) add('warning', 'responsive', 'MOBILE_WIDE_TABLE_WITHOUT_SCROLL', 'Wide table on mobile has no obvious scroll container', table, { columns: cols });
      const rect = table.getBoundingClientRect();
      if (rect.right > window.innerWidth + 4 && !hasScrollableAncestor(table)) add('error', 'responsive', 'TABLE_OVERFLOWS_PAGE', 'Table overflows page instead of internal scroll container', table);
    }

    const stickyHeight = Array.from(document.querySelectorAll('header,[class*="sticky"],[class*="fixed"]'))
      .filter(visible)
      .reduce((sum, element) => sum + Math.min(element.getBoundingClientRect().height, window.innerHeight), 0);
    if (isMobile && stickyHeight > window.innerHeight * 0.45) add('warning', 'responsive', 'MOBILE_STICKY_TOO_TALL', 'Sticky elements consume more than 45% of mobile height', document.body, { stickyHeight });

    return result;
  }, { route, viewportId: viewport.id, state, isMobile: viewport.isMobile });

  for (const finding of findings) {
    addFinding(run.report, { ...finding, screenshot });
  }

  if (run.config.failOnConsoleErrors) {
    for (const error of collectors.routeErrors) {
      addFinding(run.report, {
        severity: 'error',
        category: 'console',
        code: 'CONSOLE_ERROR',
        message: error.message,
        route,
        viewport: viewport.id,
        state,
        screenshot,
        details: error,
      });
    }
  }
  for (const failure of collectors.httpFailures) {
    addFinding(run.report, {
      severity: 'error',
      category: 'network',
      code: 'HTTP_OR_REQUEST_FAILURE',
      message: failure.status ? `HTTP ${failure.status}: ${failure.url}` : `${failure.failure}: ${failure.url}`,
      route,
      viewport: viewport.id,
      state,
      screenshot,
      details: failure,
    });
  }
  collectors.clear();
}

async function auditKeyboard(page, run, route, viewport) {
  const focusSequence = [];
  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press('Tab');
    const item = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        name: (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().slice(0, 80),
        hidden: style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0 || rect.right < -4 || rect.bottom < -4,
        bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
    if (item) focusSequence.push(item);
  }
  const hiddenFocus = focusSequence.find((item) => item.hidden);
  if (hiddenFocus) {
    addFinding(run.report, {
      severity: 'error',
      category: 'interaction',
      code: 'FOCUS_ENTERED_HIDDEN_CONTENT',
      message: 'Keyboard focus entered hidden or offscreen content',
      route,
      viewport: viewport.id,
      state: 'keyboard',
      bbox: hiddenFocus.bbox,
      details: { focusSequence },
    });
  }
  if (!focusSequence.length) {
    addFinding(run.report, {
      severity: 'warning',
      category: 'interaction',
      code: 'NO_KEYBOARD_FOCUS_SEQUENCE',
      message: 'Tab did not reach any focusable controls',
      route,
      viewport: viewport.id,
      state: 'keyboard',
    });
  }
}

async function safeOpenMenuState(page, run, route, viewport, collectors) {
  const safeButton = page.locator('button[aria-haspopup], button[aria-expanded], [role="button"][aria-haspopup]').filter({ hasNotText: DESTRUCTIVE_TEXT }).first();
  if (!(await safeButton.count())) return;
  try {
    await safeButton.click({ timeout: 1500 });
    await page.waitForTimeout(200);
    await auditState(page, run, route, viewport, 'safe-menu-opened', collectors);
    await page.keyboard.press('Escape').catch(() => {});
  } catch (error) {
    addFinding(run.report, {
      severity: 'warning',
      category: 'interaction',
      code: 'SAFE_MENU_TOGGLE_FAILED',
      message: `Safe menu toggle could not be audited: ${String(error.message || error)}`,
      route,
      viewport: viewport.id,
      state: 'safe-menu-opened',
    });
  }
}

async function safeSearchEmptyState(page, run, route, viewport, collectors) {
  const search = page.locator('input[type="search"], input[placeholder*="Search"], input[placeholder*="搜索"], input[aria-label*="Search"], input[aria-label*="搜索"]').first();
  if (!(await search.count())) return;
  try {
    const previousValue = await search.inputValue().catch(() => '');
    await search.fill(`__NO_RESULTS_${run.runId}__`);
    await page.waitForTimeout(500);
    await auditState(page, run, route, viewport, 'search-empty', collectors);
    await search.fill(previousValue);
  } catch (error) {
    addFinding(run.report, {
      severity: 'warning',
      category: 'interaction',
      code: 'SAFE_SEARCH_STATE_FAILED',
      message: `Search empty-state audit failed: ${String(error.message || error)}`,
      route,
      viewport: viewport.id,
      state: 'search-empty',
    });
  }
}

async function auditRouteViewport(page, run, route, viewport, collectors) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${run.config.appUrl.replace(/\/?$/, '/')}${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: run.config.pageTimeoutMs,
  });
  await waitForAppSettled(page, run.config.pageTimeoutMs);

  const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  if (!bodyText.trim() || /login|登录|sign in/i.test(bodyText.slice(0, 600))) {
    run.report.skippedRoutes.push({ route, viewport: viewport.id, reason: 'route did not render an authenticated app page' });
    return;
  }

  if (MOJIBAKE_PATTERN.test(bodyText)) {
    addFinding(run.report, {
      severity: 'error',
      category: 'visual',
      code: 'VISIBLE_MOJIBAKE_TEXT',
      message: 'Visible page text contains mojibake-like characters',
      route,
      viewport: viewport.id,
      state: 'initial',
      details: { sample: bodyText.match(MOJIBAKE_PATTERN)?.[0] || '' },
    });
  }

  run.report.summary.viewportRuns += 1;
  await auditState(page, run, route, viewport, 'initial', collectors);
  await auditKeyboard(page, run, route, viewport);
  await safeOpenMenuState(page, run, route, viewport, collectors);
  await safeSearchEmptyState(page, run, route, viewport, collectors);
}

function writeReports(run, status) {
  const { report } = run;
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - run.startedAt;
  report.summary.errors = report.findings.filter((item) => item.severity === 'error').length;
  report.summary.warnings = report.findings.filter((item) => item.severity === 'warning').length;
  report.summary.info = report.findings.filter((item) => item.severity === 'info').length;
  report.summary.routesAudited = report.routes.length;

  const reportJson = path.join(run.root, 'report.json');
  const reportMd = path.join(run.root, 'report.md');
  const summaryTxt = path.join(run.root, 'summary.txt');
  atomicWrite(reportJson, JSON.stringify(report, null, 2));
  atomicWrite(reportMd, renderMarkdown(report, status));
  atomicWrite(summaryTxt, [
    `status=${status}`,
    `runId=${report.runId}`,
    `routes=${report.routes.length}`,
    `errors=${report.summary.errors}`,
    `warnings=${report.summary.warnings}`,
    `screenshots=${report.summary.screenshots}`,
    `report=${reportJson}`,
  ].join(os.EOL));
  return { reportJson, reportMd, summaryTxt };
}

function renderMarkdown(report, status) {
  const topErrors = report.findings.filter((item) => item.severity === 'error').slice(0, 10);
  const groupedByRoute = groupBy(report.findings, 'route');
  const groupedByViewport = groupBy(report.findings, 'viewport');
  const mobileIssues = report.findings.filter((item) => /^mobile/.test(item.viewport));
  const accessibilityIssues = report.findings.filter((item) => item.category === 'accessibility');
  const consoleNetworkIssues = report.findings.filter((item) => item.category === 'console' || item.category === 'network');

  return [
    '# Browser UI/UX Audit v2',
    '',
    `Status: **${status}**`,
    `Run ID: \`${report.runId}\``,
    `App URL: \`${report.appUrl}\``,
    '',
    '## Executive Summary',
    '',
    `Routes audited: ${report.summary.routesAudited}`,
    `Viewport runs: ${report.summary.viewportRuns}`,
    `State runs: ${report.summary.stateRuns}`,
    `Errors: ${report.summary.errors}`,
    `Warnings: ${report.summary.warnings}`,
    `Screenshots: ${report.summary.screenshots}`,
    '',
    '## Top Blocking Errors',
    '',
    topErrors.length ? topErrors.map((item, index) => `${index + 1}. [${item.code}] ${item.route} ${item.viewport} ${item.message}`).join('\n') : 'No blocking errors.',
    '',
    '## Findings By Route',
    '',
    renderGroups(groupedByRoute),
    '',
    '## Findings By Viewport',
    '',
    renderGroups(groupedByViewport),
    '',
    '## Mobile Issues',
    '',
    renderFindingList(mobileIssues),
    '',
    '## Accessibility Issues',
    '',
    renderFindingList(accessibilityIssues),
    '',
    '## Console And Network Issues',
    '',
    renderFindingList(consoleNetworkIssues),
    '',
    '## Screenshot Index',
    '',
    report.artifacts.screenshots.map((item) => `- ${item}`).join('\n') || 'No screenshots captured.',
    '',
    '## Reproduction Command',
    '',
    '```powershell',
    'npm run test:browser:ui-ux',
    '```',
    '',
  ].join('\n');
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key] || 'unknown';
    groups[value] = groups[value] || [];
    groups[value].push(item);
    return groups;
  }, {});
}

function renderGroups(groups) {
  const keys = Object.keys(groups).sort();
  if (!keys.length) return 'No findings.';
  return keys.map((key) => [`### ${key}`, renderFindingList(groups[key])].join('\n\n')).join('\n\n');
}

function renderFindingList(items) {
  if (!items.length) return 'No findings.';
  return items.slice(0, 50).map((item) => `- ${item.severity.toUpperCase()} [${item.category}/${item.code}] ${item.route} ${item.viewport} ${item.state}: ${item.message}`).join('\n');
}

async function run() {
  const config = parseConfig();
  const run = createRun(config);
  run.config = config;
  ensureDir(run.root);

  let browser;
  let context;
  let page;
  let setupFailed = false;
  const deadlineAt = Date.now() + config.timeoutMs;
  let timedOut = false;

  try {
    const launched = await launchBrowserWithGuard({ retryLimit: 1, waitMs: 800 });
    browser = launched.browser;
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: config.colorScheme === 'dark' ? 'dark' : 'light',
      reducedMotion: config.reducedMotion ? 'reduce' : 'no-preference',
    });
    page = await context.newPage();
    const collectors = installPageCollectors(page, run);

    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
    await loginUiAuditUser(page, config.appUrl, {
      account: { username: config.username, password: config.password, role: 'admin' },
      defaultStorage: { 'ailao.language': 'zh', 'ailao.theme': config.colorScheme === 'dark' ? 'dark' : 'light' },
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
    await waitForAppSettled(page, config.pageTimeoutMs);

    if (config.reducedMotion) {
      await page.addStyleTag({
        content: '*,*::before,*::after{transition-duration:0.01ms!important;animation-duration:0.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;}',
      }).catch(() => {});
    }

    const routes = await discoverRoutes(page, config, run.report);
    run.report.routes = routes;
    if (!routes.length) throw new Error('No route can be audited.');

    for (const route of routes) {
      for (const viewport of VIEWPORTS) {
        if (Date.now() > deadlineAt) {
          timedOut = true;
          addFinding(run.report, {
            severity: 'error',
            category: 'runtime',
            code: 'AUDIT_TOTAL_TIMEOUT',
            message: `UI/UX audit exceeded ${config.timeoutMs}ms before completing all routes`,
            route,
            viewport: viewport.id,
            state: 'deadline',
          });
          break;
        }
        try {
          await auditRouteViewport(page, run, route, viewport, collectors);
        } catch (error) {
          const screenshot = page ? await saveScreenshot(page, run, route, viewport, 'route-failure', true).catch(() => null) : null;
          addFinding(run.report, {
            severity: 'error',
            category: 'runtime',
            code: 'ROUTE_VIEWPORT_AUDIT_FAILED',
            message: String(error.message || error),
            route,
            viewport: viewport.id,
            state: 'route',
            screenshot,
          });
        }
      }
      if (timedOut) break;
    }
  } catch (error) {
    setupFailed = true;
    addFinding(run.report, {
      severity: 'error',
      category: 'runtime',
      code: 'AUDIT_SETUP_FAILED',
      message: String(error.message || error),
      route: '',
      viewport: '',
      state: 'setup',
    });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  if (run.report.summary.viewportRuns === 0) {
    addFinding(run.report, {
      severity: 'error',
      category: 'runtime',
      code: 'NO_VIEWPORTS_AUDITED',
      message: 'UI/UX audit did not complete any route viewport run',
      route: '',
      viewport: '',
      state: 'final',
    });
  }
  if (run.report.summary.screenshots === 0) {
    addFinding(run.report, {
      severity: 'error',
      category: 'runtime',
      code: 'NO_SCREENSHOTS_CAPTURED',
      message: 'UI/UX audit completed without any screenshots',
      route: '',
      viewport: '',
      state: 'final',
    });
  }
  const hasErrors = run.report.findings.some((item) => item.severity === 'error');
  const hasWarnings = run.report.findings.some((item) => item.severity === 'warning');
  const status = setupFailed || hasErrors || (config.failOnWarnings && hasWarnings) ? 'failed' : 'passed';
  const paths = writeReports(run, status);

  if (status !== 'passed') {
    console.error(`Browser UI/UX audit failed. Report: ${paths.reportJson}`);
    process.exit(1);
  }
  console.log(`Browser UI/UX audit passed. Report: ${paths.reportJson}`);
}

run().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
