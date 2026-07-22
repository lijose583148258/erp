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
  '#dashboard', '#crm', '#orders', '#collections', '#adjustment', '#financeAnalytics',
  '#contracts', '#barter', '#risk', '#dealerAnalytics', '#samples', '#shipping',
  '#discrepancies', '#rma', '#team', '#assets', '#production', '#warehouse',
  '#procurement', '#audit',
];

function boolEnv(env, name, defaultValue) {
  const raw = env[name];
  if (raw == null || raw === '') return defaultValue;
  if (raw === '1' || /^true$/i.test(raw)) return true;
  if (raw === '0' || /^false$/i.test(raw)) return false;
  throw new Error(`${name} must be a boolean value: 0/1/true/false`);
}

function intEnv(env, name, defaultValue, min = 1) {
  const raw = env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

function enumEnv(env, name, defaultValue, allowed) {
  const value = env[name] || defaultValue;
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function regexEnv(env, name) {
  const raw = env[name];
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

function parseConfig(env = process.env) {
  return {
    appUrl: env.APP_URL || 'http://127.0.0.1:5001/',
    username: env.AUDIT_ADMIN_USERNAME || 'ui_ux_audit_admin',
    password: env.AUDIT_ADMIN_PASSWORD || 'AuditSmoke12345!',
    forcedRoutes: (env.UI_UX_AUDIT_ROUTES || '').split(',').map(normalizeRoute).filter(Boolean),
    maxRoutes: intEnv(env, 'UI_UX_AUDIT_MAX_ROUTES', 30, 1),
    timeoutMs: intEnv(env, 'UI_UX_AUDIT_TIMEOUT_MS', 420000, 1000),
    pageTimeoutMs: intEnv(env, 'UI_UX_AUDIT_PAGE_TIMEOUT_MS', 15000, 1000),
    failOnWarnings: boolEnv(env, 'UI_UX_AUDIT_FAIL_ON_WARNINGS', false),
    failOnConsoleErrors: boolEnv(env, 'UI_UX_AUDIT_FAIL_ON_CONSOLE_ERRORS', true),
    ignoreConsolePattern: regexEnv(env, 'UI_UX_AUDIT_IGNORE_CONSOLE_PATTERN'),
    ignoreHttpPattern: regexEnv(env, 'UI_UX_AUDIT_IGNORE_HTTP_PATTERN'),
    screenshotMode: enumEnv(env, 'UI_UX_AUDIT_SCREENSHOT_MODE', 'viewport', ['fullPage', 'viewport']),
    traceOnFailure: boolEnv(env, 'UI_UX_AUDIT_TRACE_ON_FAILURE', false),
    reducedMotion: boolEnv(env, 'UI_UX_AUDIT_REDUCED_MOTION', true),
    colorScheme: enumEnv(env, 'UI_UX_AUDIT_COLOR_SCHEME', 'light', ['light', 'dark', 'both']),
  };
}

module.exports = { FALLBACK_ROUTES, VIEWPORTS, normalizeRoute, parseConfig };
