const fs = require('fs');
const path = require('path');

const VALID_SEVERITIES = new Set(['info', 'warning', 'error', 'blocker']);

const defaultRoutes = [
  {
    id: 'dashboard',
    hash: '#dashboard',
    title: 'Dashboard',
    expected: ['AilaoDa Business Cockpit', 'Overview'],
    category: 'smoke',
    severity: 'error',
    tags: ['core', 'navigation'],
    viewport: null,
  },
  {
    id: 'crm',
    hash: '#crm',
    title: 'CRM',
    expected: ['Customer Relationship and Credit Files', 'Customers'],
    category: 'smoke',
    severity: 'error',
    tags: ['crm', 'table'],
    viewport: null,
  },
  {
    id: 'orders',
    hash: '#orders',
    title: 'Sales Orders',
    expected: ['Sales Order Center', 'Sales Orders'],
    category: 'smoke',
    severity: 'error',
    tags: ['orders', 'table'],
    viewport: null,
  },
  {
    id: 'warehouse',
    hash: '#warehouse',
    title: 'Warehouse',
    expected: ['Warehouse, Locations, and Inventory', 'Warehouse'],
    category: 'smoke',
    severity: 'error',
    tags: ['warehouse', 'inventory'],
    viewport: null,
  },
  {
    id: 'procurement',
    hash: '#procurement',
    title: 'Procurement',
    expected: ['Procurement, Suppliers, and Receiving', 'Procurement'],
    category: 'smoke',
    severity: 'error',
    tags: ['procurement', 'receiving'],
    viewport: null,
  },
  {
    id: 'finance',
    hash: '#financeAnalytics',
    title: 'Finance Analytics',
    expected: ['Finance Operations Analytics', 'Finance'],
    category: 'smoke',
    severity: 'error',
    tags: ['finance', 'analytics'],
    viewport: null,
  },
  {
    id: 'team',
    hash: '#team',
    title: 'Users and Roles',
    expected: ['Users, Roles, and Permissions', 'Org & Roles'],
    category: 'smoke',
    severity: 'error',
    tags: ['permissions', 'team'],
    viewport: null,
  },
  {
    id: 'audit',
    hash: '#audit',
    title: 'Audit Logs',
    expected: ['System Audit and Operation Logs', 'Audit Logs'],
    category: 'smoke',
    severity: 'error',
    tags: ['audit', 'logs'],
    viewport: null,
  },
];

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function assertString(value, label, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} must be a non-empty string`);
  }
}

function normalizeRoute(route, index) {
  const errors = [];
  if (!route || typeof route !== 'object' || Array.isArray(route)) {
    return { route: null, errors: [`route[${index}] must be an object`] };
  }

  assertString(route.id, `route[${index}].id`, errors);
  assertString(route.hash, `route[${index}].hash`, errors);
  if (typeof route.hash === 'string' && !route.hash.startsWith('#')) {
    errors.push(`route[${index}].hash must begin with #`);
  }

  const expected = asArray(route.expected).filter((item) => typeof item === 'string' && item.trim() !== '');
  if (expected.length === 0) {
    errors.push(`route[${index}].expected must be a non-empty string or string array`);
  }

  const severity = route.severity || 'error';
  if (!VALID_SEVERITIES.has(severity)) {
    errors.push(`route[${index}].severity must be one of ${Array.from(VALID_SEVERITIES).join(', ')}`);
  }

  const tags = route.tags == null ? [] : route.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    errors.push(`route[${index}].tags must be an array of non-empty strings`);
  }

  let viewport = route.viewport == null ? null : route.viewport;
  if (viewport !== null) {
    if (
      !viewport ||
      typeof viewport !== 'object' ||
      !Number.isFinite(Number(viewport.width)) ||
      !Number.isFinite(Number(viewport.height)) ||
      Number(viewport.width) <= 0 ||
      Number(viewport.height) <= 0
    ) {
      errors.push(`route[${index}].viewport must be null or { width, height } with positive numbers`);
    } else {
      viewport = {
        ...viewport,
        width: Math.floor(Number(viewport.width)),
        height: Math.floor(Number(viewport.height)),
      };
    }
  }

  return {
    route: {
      ...route,
      id: String(route.id || '').trim(),
      hash: String(route.hash || '').trim(),
      title: typeof route.title === 'string' && route.title.trim()
        ? route.title.trim()
        : String(route.id || '').trim(),
      expected,
      category: typeof route.category === 'string' && route.category.trim() ? route.category.trim() : 'smoke',
      severity,
      tags,
      viewport,
    },
    errors,
  };
}

function validateRoutes(routes) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('isolated Playwright routes must be a non-empty array');
  }

  const ids = new Set();
  const normalized = [];
  const errors = [];

  routes.forEach((route, index) => {
    const result = normalizeRoute(route, index);
    errors.push(...result.errors);
    if (!result.route) return;
    if (ids.has(result.route.id)) {
      errors.push(`route id must be unique: ${result.route.id}`);
    }
    ids.add(result.route.id);
    normalized.push(result.route);
  });

  if (errors.length > 0) {
    throw new Error(`Invalid isolated Playwright route schema:\n- ${errors.join('\n- ')}`);
  }

  return normalized;
}

function unwrapRoutes(moduleValue) {
  if (Array.isArray(moduleValue)) return moduleValue;
  if (Array.isArray(moduleValue?.routes)) return moduleValue.routes;
  if (Array.isArray(moduleValue?.ROUTES)) return moduleValue.ROUTES;
  return null;
}

function resolveRoutesFile(repoRoot, configuredPath) {
  if (!configuredPath) return path.join(repoRoot, 'scripts', 'lib', 'isolated-playwright-routes.cjs');
  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(repoRoot, configuredPath);
}

function loadRoutes(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const configuredPath = options.routesFile || process.env.ISOLATED_PLAYWRIGHT_ROUTES_FILE || '';
  const routesFile = resolveRoutesFile(repoRoot, configuredPath);
  if (!fs.existsSync(routesFile)) {
    throw new Error(`ISOLATED_PLAYWRIGHT_ROUTES_FILE not found: ${routesFile}`);
  }

  const loaded = routesFile === __filename ? defaultRoutes : unwrapRoutes(require(routesFile));
  const routes = routesFile === __filename ? loaded : loaded;
  if (!Array.isArray(routes)) {
    throw new Error(`Route file must export an array or { routes }: ${routesFile}`);
  }

  return {
    routes: validateRoutes(routes),
    routesFile,
  };
}

const routes = validateRoutes(defaultRoutes);

module.exports = routes;
module.exports.routes = routes;
module.exports.ROUTES = routes;
module.exports.VALID_SEVERITIES = VALID_SEVERITIES;
module.exports.loadRoutes = loadRoutes;
module.exports.validateRoutes = validateRoutes;
