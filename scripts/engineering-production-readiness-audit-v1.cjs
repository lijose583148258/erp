const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'engineering-production-readiness-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'engineering-production-readiness-v1.md');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);
const WALK_EXCLUDED_DIRS = new Set([
  '.git',
  '.vite-cache',
  'backups',
  'dist',
  'logs',
  'node_modules',
  'output',
  'runtime-data',
  'runtime-db',
  'scratchdb',
  'temp_compare_cleanmigration',
  'tempdb',
]);

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readText(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (!text) return {};
  return JSON.parse(text);
}

function listFiles(startDir, predicate = () => true, bucket = []) {
  const fullStart = path.join(ROOT, startDir);
  if (!fs.existsSync(fullStart)) return bucket;
  let entries = [];
  try {
    entries = fs.readdirSync(fullStart, { withFileTypes: true });
  } catch {
    return bucket;
  }
  for (const entry of entries) {
    const full = path.join(fullStart, entry.name);
    if (entry.isDirectory()) {
      if (WALK_EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('temp')) continue;
      listFiles(rel(full), predicate, bucket);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = rel(full);
    if (predicate(relativePath, full)) bucket.push(relativePath);
  }
  return bucket;
}

function hasDependency(pkg, names) {
  const all = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  return names.filter((name) => Object.prototype.hasOwnProperty.call(all, name));
}

function countMatches(text, regex) {
  if (!text) return 0;
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function findFirstLine(text, needle) {
  const lines = String(text || '').split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  return index >= 0 ? index + 1 : null;
}

function extractPrismaProvider(schemaText) {
  const match = schemaText.match(/datasource\s+db\s*{[\s\S]*?provider\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

function countDirectPrismaFiles() {
  const backendFiles = listFiles('backend/src', (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)));
  const candidates = backendFiles.filter((file) => {
    const text = readText(file);
    if (!text) return false;
    const importsPrisma =
      /from\s+['"][^'"]*(?:config\/database|database\/prisma|@prisma\/client)['"]/.test(text) ||
      /require\(['"][^'"]*(?:config\/database|database\/prisma|@prisma\/client)['"]\)/.test(text);
    const usesPrisma = /\bprisma\./.test(text);
    return importsPrisma || usesPrisma;
  });
  return {
    count: candidates.length,
    files: candidates.slice(0, 40),
  };
}

function countApiMounts(serverText) {
  const matches = serverText.match(/app\.use\(\s*['"]\/api(?!\/v\d)/g) || [];
  const versionedMatches = serverText.match(/app\.use\(\s*['"]\/api\/v\d+/g) || [];
  return { unversioned: matches.length, versioned: versionedMatches.length };
}

function countJsonStringFields() {
  const files = listFiles('backend/prisma', (relativePath) => relativePath.endsWith('.prisma'));
  const hits = [];
  for (const file of files) {
    const lines = readText(file).split('\n');
    lines.forEach((line, index) => {
      if (/\b\w*(?:Json|JSON|Metadata|Snapshot|Scopes)\w*\s+String\??\b/.test(line)) {
        hits.push({ file, line: index + 1, text: line.trim() });
      }
    });
  }
  return hits;
}

function findFrontendUnitTests() {
  return listFiles('.', (relativePath) => {
    if (!SOURCE_EXTENSIONS.has(path.extname(relativePath))) return false;
    return /(?:^|\/)(__tests__|tests?)\//.test(relativePath) || /\.(test|spec)\.(tsx?|jsx?)$/.test(relativePath);
  }).filter((file) => !file.startsWith('backend/') && !file.startsWith('scripts/'));
}

function isBusinessSurfaceFile(file) {
  if (!SOURCE_EXTENSIONS.has(path.extname(file))) return false;
  if (file.startsWith('backend/')) return false;
  if (file.startsWith('components/ui/')) return false;
  if (file.startsWith('docs/')) return false;
  if (file.startsWith('scripts/')) return false;
  if (file.startsWith('utils/')) return false;
  if (file.includes('/__tests__/') || /\.(test|spec)\.(tsx?|jsx?)$/.test(file)) return false;
  return file.startsWith('pages/') ||
    file.startsWith('components/operatingTable/') ||
    file.startsWith('components/collections/') ||
    file.startsWith('app/');
}

function findSmartFilterBusinessAdoptionFiles() {
  return listFiles('.', (file) => {
    if (!isBusinessSurfaceFile(file)) return false;
    const text = readText(file);
    return /<EnterpriseDataGrid[\s\S]*filterDefinitions\s*=/.test(text) ||
      (/filterDefinitions\s*=/.test(text) && /BusinessFilterDefinition|businessFilters|EnterpriseDataGrid/.test(text));
  });
}

function findNpxScripts(pkg) {
  const scripts = pkg.scripts || {};
  return Object.entries(scripts)
    .filter(([, command]) => /\bnpx\s+/.test(String(command)))
    .map(([name, command]) => ({ name, command: String(command) }));
}

function add(requirements, item) {
  requirements.push({
    id: item.id,
    category: item.category,
    severity: item.severity || 'P2',
    status: item.status,
    title: item.title,
    evidence: item.evidence || [],
    nextAction: item.nextAction || '',
  });
}

function buildRequirements() {
  const rootPackage = readJson('package.json');
  const backendPackage = readJson('backend/package.json');
  const npxScripts = findNpxScripts(rootPackage);
  const tsconfig = readJson('tsconfig.json');
  const strictTsconfig = readJson('tsconfig.strict.json');
  const strictPilotTsconfig = readJson('tsconfig.strict.pilot.json');
  const backendTsconfig = readJson('backend/tsconfig.json');
  const openApiText = readText('docs/openapi.yaml') || readText('openapi.yaml');
  const schemaText = readText('backend/prisma/schema.prisma');
  const dockerfile = readText('Dockerfile');
  const postgresDockerfile = readText('Dockerfile.postgres');
  const compose = readText('docker-compose.yml');
  const postgresCompose = readText('docker-compose.postgres.yml');
  const runtimeConfig = readText('backend/src/config/runtime.ts');
  const backendPackageText = readText('backend/package.json');
  const viteConfig = readText('vite.config.ts');
  const appContent = readText('app/appContent.tsx');
  const pageRegistry = readText('app/activePathRegistry.ts');
  const pageErrorBoundary = readText('components/PageErrorBoundary.tsx');
  const dashboardPage = readText('pages/Dashboard.tsx');
  const serverStateProvider = readText('app/ServerStateProvider.tsx');
  const frontendSourceFiles = listFiles('.', (file) =>
    SOURCE_EXTENSIONS.has(path.extname(file)) &&
    !file.startsWith('backend/') &&
    !file.startsWith('scripts/') &&
    !file.startsWith('utils/quarantine/'));
  const dashboardService = readText('services/dashboard.service.ts');
  const dashboardRoutes = readText('backend/src/routes/dashboard.routes.ts');
  const dataTable = readText('components/DataTable.tsx');
  const enterpriseGrid = readText('components/ui/EnterpriseDataGrid.tsx');
  const businessFilters = readText('components/ui/businessFilters.ts');
  const serverText = readText('backend/src/server.ts');
  const webVitalsTelemetry = readText('utils/webVitalsTelemetry.ts');
  const metricsMiddlewareText = readText('backend/src/middleware/metricsMiddleware.ts');
  const objectStorageService = readText('backend/src/services/object-storage.service.ts');
  const cacheService = readText('backend/src/services/cache.service.ts');
  const prismaProvider = extractPrismaProvider(schemaText);
  const directPrisma = countDirectPrismaFiles();
  const jsonStringFields = countJsonStringFields();
  const frontendTests = findFrontendUnitTests();
  const runnableFrontendUnitTests = frontendTests.filter((file) => /\.unit\.test\.(tsx?|jsx?)$/.test(file));
  const apiMounts = countApiMounts(serverText);
  const redisDeps = hasDependency(backendPackage, ['redis', 'ioredis']);
  const hasCacheService = /interface\s+AppCache/.test(cacheService) &&
    /CACHE_STRATEGIES/.test(cacheService) &&
    /class\s+RedisAppCache/.test(cacheService);
  const hasLocalWebVitalsCollector = /startWebVitalsTelemetry/.test(webVitalsTelemetry) &&
    /PerformanceObserver/.test(webVitalsTelemetry) &&
    /sendBeacon/.test(webVitalsTelemetry);
  const hasWebVitalsEntrypoint = /startWebVitalsTelemetry\(\)/.test(readText('index.tsx'));
  const hasWebVitalsEndpoint = /\/api\/metrics\/web-vitals/.test(serverText) &&
    /\/api\/v1\/metrics\/web-vitals/.test(serverText) &&
    /recordWebVitalMetric/.test(serverText);
  const hasWebVitalsPrometheus = /ailaoda_browser_web_vital_total/.test(metricsMiddlewareText) &&
    /ailaoda_browser_web_vital_value_latest/.test(metricsMiddlewareText);
  const cacheStrategyDocs = listFiles('docs/adr', (file) => /cache|redis/i.test(file));
  const hasCacheStrategyDoc = cacheStrategyDocs.length > 0;
  const rootDeps = {
    query: hasDependency(rootPackage, ['@tanstack/react-query', 'react-query']),
    stores: hasDependency(rootPackage, ['zustand', 'jotai', '@reduxjs/toolkit', 'redux']),
    virtual: hasDependency(rootPackage, ['@tanstack/react-virtual', 'react-window', 'react-virtualized']),
    webVitals: hasDependency(rootPackage, ['web-vitals']),
    pwa: hasDependency(rootPackage, ['vite-plugin-pwa', 'workbox-window']),
    test: hasDependency(rootPackage, ['vitest', '@testing-library/react', '@testing-library/jest-dom', '@testing-library/user-event', 'jsdom']),
    openApiRoot: hasDependency(rootPackage, ['swagger-jsdoc', 'swagger-ui-express', 'openapi-typescript', '@asteasolutions/zod-to-openapi']),
    websocketRoot: hasDependency(rootPackage, ['ws', 'socket.io']),
    searchRoot: hasDependency(rootPackage, ['@elastic/elasticsearch', 'meilisearch']),
  };
  const queryProviderMounted = /QueryClientProvider/.test(serverStateProvider) &&
    /serverStateQueryClient/.test(serverStateProvider) &&
    /<ServerStateProvider>/.test(readText('index.tsx'));
  const queryUsageFiles = frontendSourceFiles.filter((file) => /useQuery\s*\(/.test(readText(file)));
  const hasServerStateQueryLayer = rootDeps.query.length > 0 &&
    queryProviderMounted &&
    queryUsageFiles.length > 0;
  const backendDeps = {
    openApi: hasDependency(backendPackage, ['swagger-jsdoc', 'swagger-ui-express', 'openapi-typescript', '@asteasolutions/zod-to-openapi']),
    csrf: hasDependency(backendPackage, ['csrf', 'csurf']),
    websocket: hasDependency(backendPackage, ['ws', 'socket.io']),
    search: hasDependency(backendPackage, ['@elastic/elasticsearch', 'meilisearch']),
    otel: hasDependency(backendPackage, ['@opentelemetry/sdk-node', '@opentelemetry/api', 'prom-client']),
    storage: hasDependency(backendPackage, ['@aws-sdk/client-s3', 'minio']),
    mfa: hasDependency(backendPackage, ['otplib', 'speakeasy']),
    vault: hasDependency(backendPackage, ['node-vault', '@aws-sdk/client-secrets-manager', '@azure/keyvault-secrets']),
  };

  const requirements = [];

  add(requirements, {
    id: 'research-backed-product-roadmap',
    category: 'business-experience',
    severity: 'P1',
    status: exists('docs/PRODUCT_RESEARCH_EXECUTIVE_DASHBOARD_FILTERS_MOBILE.md') &&
      exists('docs/EXECUTIVE_DASHBOARD_FILTER_MOBILE_INTEGRATION_SPEC.md') &&
      exists('docs/ENGINEERING_PRODUCTION_READINESS_ROADMAP.md')
      ? 'present'
      : 'gap',
    title: 'Dashboard/filter/mobile work is backed by research and an integration spec',
    evidence: [
      `research note=${exists('docs/PRODUCT_RESEARCH_EXECUTIVE_DASHBOARD_FILTERS_MOBILE.md')}`,
      `integration spec=${exists('docs/EXECUTIVE_DASHBOARD_FILTER_MOBILE_INTEGRATION_SPEC.md')}`,
      `roadmap=${exists('docs/ENGINEERING_PRODUCTION_READINESS_ROADMAP.md')}`,
    ],
    nextAction: 'Keep product changes tied to the shared filter, drill-down, and mobile card contracts instead of isolated visual rewrites.',
  });

  add(requirements, {
    id: 'db-postgresql-production',
    category: 'engineering-architecture',
    severity: 'P0',
    status: prismaProvider === 'postgresql' && !/file:\/data\/stable\.db/.test(dockerfile + compose)
      ? 'present'
      : exists('Dockerfile.postgres') &&
        exists('docker-compose.postgres.yml') &&
        exists('backend/scripts/prepare-postgres-prisma-artifact.cjs') &&
        exists('backend/scripts/prisma-validate-postgres.cjs') &&
        /AILAODA_PRISMA_PROVIDER/.test(runtimeConfig) &&
        /prisma:validate:postgres/.test(backendPackageText + readText('package.json'))
        ? 'partial'
        : 'gap',
    title: 'Production database uses PostgreSQL artifact and defaults',
    evidence: [
      `backend/prisma/schema.prisma provider=${prismaProvider || 'unknown'}`,
      `Dockerfile sqliteDefault=${/DATABASE_URL=file:\/data\/stable\.db/.test(dockerfile)}`,
      `docker-compose sqliteDefault=${/DATABASE_URL:\s*\$\{DATABASE_URL:-file:\/data\/stable\.db\}/.test(compose)}`,
      `Dockerfile.postgres exists=${exists('Dockerfile.postgres')}`,
      `Dockerfile.postgres provider marker=${/AILAODA_PRISMA_PROVIDER=postgresql/.test(postgresDockerfile)}`,
      `docker-compose.postgres service=${/image:\s*postgres:/.test(postgresCompose)}`,
      `docker-compose.postgres DATABASE_URL=${/postgresql:\/\//.test(postgresCompose)}`,
      `postgres artifact prepare script=${exists('backend/scripts/prepare-postgres-prisma-artifact.cjs')}`,
      `postgres validate script=${exists('backend/scripts/prisma-validate-postgres.cjs')}`,
      `prisma:validate:postgres script=${/prisma:validate:postgres/.test(backendPackageText + readText('package.json'))}`,
      `SaaS sqlite guard=${/SaaS deployment requires PostgreSQL DATABASE_URL/.test(runtimeConfig)}`,
      `PostgreSQL-with-SQLite-artifact guard=${/built with the SQLite Prisma provider/.test(runtimeConfig)}`,
      `SQLite-with-PostgreSQL-artifact guard=${/PostgreSQL Prisma provider artifact requires a PostgreSQL DATABASE_URL/.test(runtimeConfig)}`,
    ],
    nextAction: 'Run PostgreSQL artifact generation/validation in CI, add migrations and seed/backup/restore validation, then run business-chain API audits on a real PostgreSQL runtime.',
  });

  add(requirements, {
    id: 'typescript-strict',
    category: 'engineering-architecture',
    severity: 'P0',
    status: tsconfig.compilerOptions?.strict === true
      ? 'present'
      : strictTsconfig.compilerOptions?.strict === true && rootPackage.scripts?.['typecheck:strict:pilot']
        ? 'partial'
        : 'gap',
    title: 'Frontend TypeScript strict mode is enabled',
    evidence: [
      `tsconfig strict=${String(tsconfig.compilerOptions?.strict)}`,
      `tsconfig.strict.json exists=${exists('tsconfig.strict.json')}`,
      `tsconfig.strict strict=${String(strictTsconfig.compilerOptions?.strict)}`,
      `tsconfig.strict.pilot.json exists=${exists('tsconfig.strict.pilot.json')}`,
      `strict pilot includes=${Array.isArray(strictPilotTsconfig.include) ? strictPilotTsconfig.include.join(',') : 'none'}`,
      `typecheck:strict script=${Boolean(rootPackage.scripts?.['typecheck:strict'])}`,
      `typecheck:strict:pilot script=${Boolean(rootPackage.scripts?.['typecheck:strict:pilot'])}`,
      `tsconfig skipLibCheck=${String(tsconfig.compilerOptions?.skipLibCheck)}`,
      `backend tsconfig strict=${String(backendTsconfig.compilerOptions?.strict)}`,
    ],
    nextAction: 'Expand the strict pilot include set module by module, run typecheck:strict regularly, then enable strict in the main config once full frontend errors are burned down.',
  });

  add(requirements, {
    id: 'frontend-src-layout',
    category: 'engineering-architecture',
    severity: 'P1',
    status: exists('src') || (!exists('services') && !exists('pages') && !exists('components')) ? 'present' : 'gap',
    title: 'Frontend source has a coherent src/ ownership boundary',
    evidence: [
      `root services/=${exists('services')}`,
      `root pages/=${exists('pages')}`,
      `root components/=${exists('components')}`,
      `src/ exists=${exists('src')}`,
      `tsconfig excludes src=${(tsconfig.exclude || []).includes('src')}`,
      `vite alias root=${/alias:\s*{[\s\S]*'@':\s*path\.resolve\(__dirname,\s*'\.'\)/.test(viteConfig)}`,
    ],
    nextAction: 'Move frontend services/pages/components into src/ in a mechanical PR with path aliases and no behavior changes.',
  });

  add(requirements, {
    id: 'shared-types-contract',
    category: 'engineering-architecture',
    severity: 'P1',
    status: exists('shared') || exists('packages/shared') ? 'present' : 'gap',
    title: 'Frontend and backend share generated or contract-owned types',
    evidence: [
      `root types.ts=${exists('types.ts')}`,
      `shared/=${exists('shared')}`,
      `packages/shared/=${exists('packages/shared')}`,
      `backend zod dependency=${hasDependency(backendPackage, ['zod']).join(',') || 'none'}`,
    ],
    nextAction: 'Create a shared contract package generated from Prisma/Zod/OpenAPI instead of hand-maintained frontend-only types.',
  });

  add(requirements, {
    id: 'client-state-management',
    category: 'engineering-architecture',
    severity: 'P1',
    status: rootDeps.stores.length ? 'present' : 'gap',
    title: 'Client state is managed by a scoped store instead of only global React context',
    evidence: [
      `state deps=${rootDeps.stores.join(',') || 'none'}`,
      `AppContext=${exists('app/AppContext.tsx') || exists('contexts/AppContext.tsx') || exists('AppContext.tsx')}`,
      `createContext count=${listFiles('.', (file) => SOURCE_EXTENSIONS.has(path.extname(file))).reduce((sum, file) => sum + countMatches(readText(file), /createContext\s*</g), 0)}`,
    ],
    nextAction: 'Introduce a narrow Zustand/Jotai store for one high-churn module first, then migrate cross-cutting UI state gradually.',
  });

  add(requirements, {
    id: 'server-state-query-layer',
    category: 'engineering-architecture',
    severity: 'P1',
    status: hasServerStateQueryLayer ? 'present' : rootDeps.query.length || queryProviderMounted ? 'partial' : 'gap',
    title: 'Server state uses a cache/query layer',
    evidence: [
      `query deps=${rootDeps.query.join(',') || 'none'}`,
      `QueryClientProvider mounted=${queryProviderMounted}`,
      `useQuery adoption=${queryUsageFiles.slice(0, 8).join(', ') || 'none'}`,
      `axios dependency=${hasDependency(rootPackage, ['axios']).join(',') || 'none'}`,
    ],
    nextAction: hasServerStateQueryLayer
      ? 'Migrate the next read-heavy modules to TanStack Query and add invalidation after business writes.'
      : 'Add TanStack Query for read-heavy modules, with query keys aligned to API filters and invalidation after writes.',
  });

  add(requirements, {
    id: 'backend-layering',
    category: 'engineering-architecture',
    severity: 'P1',
    status: directPrisma.count === 0 && exists('backend/src/repositories') ? 'present' : directPrisma.count <= 5 ? 'partial' : 'gap',
    title: 'Backend routes/controllers are separated from direct Prisma access',
    evidence: [
      `backend/src/repositories exists=${exists('backend/src/repositories')}`,
      `direct prisma files=${directPrisma.count}`,
      `sample direct prisma files=${directPrisma.files.slice(0, 8).join(', ') || 'none'}`,
    ],
    nextAction: 'Introduce repository/service boundaries module by module, starting with orders or collections, and keep controller tests around each migration.',
  });

  add(requirements, {
    id: 'openapi-contract',
    category: 'engineering-architecture',
    severity: 'P1',
    status: /x-contract-status:\s*(generated|published)/.test(openApiText) ||
      (backendDeps.openApi.length && rootDeps.openApiRoot.length)
      ? 'present'
      : /x-contract-status:\s*(seed|partial)/.test(openApiText) && rootPackage.scripts?.['audit:openapi:contract']
        ? 'partial'
        : 'gap',
    title: 'API contract is generated or published as OpenAPI/Swagger',
    evidence: [
      `backend OpenAPI deps=${backendDeps.openApi.join(',') || 'none'}`,
      `root OpenAPI deps=${rootDeps.openApiRoot.join(',') || 'none'}`,
      `openapi.yaml=${exists('openapi.yaml')}`,
      `docs/openapi.yaml=${exists('docs/openapi.yaml')}`,
      `openapi contract status=${(openApiText.match(/x-contract-status:\s*([a-z-]+)/) || [])[1] || 'none'}`,
      `audit:openapi:contract script=${Boolean(rootPackage.scripts?.['audit:openapi:contract'])}`,
    ],
    nextAction: 'Expand docs/openapi.yaml from seed to generated/published coverage with route inventory, Zod schemas, response examples, and /api-docs or CI artifact publication.',
  });

  add(requirements, {
    id: 'frontend-unit-tests',
    category: 'engineering-architecture',
    severity: 'P1',
    status: rootDeps.test.includes('vitest') && frontendTests.length > 0
      ? 'present'
      : rootPackage.scripts?.['test:frontend:unit'] && runnableFrontendUnitTests.length > 0
        ? 'partial'
        : 'gap',
    title: 'Frontend has component/unit test foundation',
    evidence: [
      `frontend test deps=${rootDeps.test.join(',') || 'none'}`,
      `test:frontend:unit script=${Boolean(rootPackage.scripts?.['test:frontend:unit'])}`,
      `frontend test files=${frontendTests.length}`,
      `runnable frontend unit test files=${runnableFrontendUnitTests.length}`,
      `sample frontend tests=${frontendTests.slice(0, 8).join(', ') || 'none'}`,
      `sample runnable unit tests=${runnableFrontendUnitTests.slice(0, 8).join(', ') || 'none'}`,
    ],
    nextAction: 'Add Vitest, Testing Library, jsdom, and tests for status badges, forms, and critical table state rendering.',
  });

  add(requirements, {
    id: 'route-lazy-loading',
    category: 'performance-experience',
    severity: 'P1',
    status: /lazy\s*\(/.test(appContent) && /activePageImports/.test(pageRegistry) ? 'present' : 'gap',
    title: 'Route-level lazy loading is active',
    evidence: [
      `app/appContent.tsx lazy=${/lazy\s*\(/.test(appContent)}`,
      `app/activePathRegistry.ts imports=${/activePageImports/.test(pageRegistry)}`,
      `vite manualChunks=${/manualChunks/.test(viteConfig)}`,
    ],
    nextAction: 'Keep existing lazy registry and add per-route performance budgets before refactoring more bundles.',
  });

  add(requirements, {
    id: 'route-error-boundary',
    category: 'performance-experience',
    severity: 'P1',
    status: /componentDidCatch|getDerivedStateFromError/.test(pageErrorBoundary) && /PageErrorBoundary/.test(appContent) ? 'present' : 'gap',
    title: 'Route-level error boundary prevents total white-screen failures',
    evidence: [
      `components/PageErrorBoundary.tsx exists=${exists('components/PageErrorBoundary.tsx')}`,
      `app/appContent.tsx wraps PageErrorBoundary=${/PageErrorBoundary/.test(appContent)}`,
    ],
    nextAction: 'Add telemetry hook for boundary failures once observability work starts.',
  });

  add(requirements, {
    id: 'virtualized-large-lists',
    category: 'performance-experience',
    severity: 'P1',
    status: rootDeps.virtual.length ? 'present' : 'gap',
    title: 'Large tables/lists use virtualization where server paging is insufficient',
    evidence: [
      `virtualization deps=${rootDeps.virtual.join(',') || 'none'}`,
      `EnterpriseDataGrid server paging=${/isServerPaged/.test(readText('components/ui/EnterpriseDataGrid.tsx'))}`,
    ],
    nextAction: 'Use @tanstack/react-virtual for dense local lists; preserve existing server paging for business tables.',
  });

  const memoCount = listFiles('.', (file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .reduce((sum, file) => sum + countMatches(readText(file), /React\.memo|useMemo\s*\(|useCallback\s*\(/g), 0);
  add(requirements, {
    id: 'react-render-optimization',
    category: 'performance-experience',
    severity: 'P2',
    status: memoCount > 30 ? 'present' : memoCount > 0 ? 'partial' : 'gap',
    title: 'High-churn React surfaces use memoization intentionally',
    evidence: [`memo/useMemo/useCallback count=${memoCount}`],
    nextAction: 'Use profiler evidence before adding memoization broadly; focus on grids, filters, and drawer-heavy workflows.',
  });

  add(requirements, {
    id: 'pwa-offline',
    category: 'performance-experience',
    severity: 'P2',
    status: rootDeps.pwa.length && !/service worker is disabled/.test(serverText) ? 'present' : 'gap',
    title: 'PWA/offline strategy is defined for desktop packaging',
    evidence: [
      `PWA deps=${rootDeps.pwa.join(',') || 'none'}`,
      `server disables /sw.js=${/service worker is disabled/.test(serverText)}`,
    ],
    nextAction: 'Write an explicit offline strategy ADR before enabling a service worker, because stale ERP data can be dangerous.',
  });

  add(requirements, {
    id: 'web-vitals',
    category: 'performance-experience',
    severity: 'P2',
    status: rootDeps.webVitals.length && hasWebVitalsEndpoint && hasWebVitalsPrometheus
      ? 'present'
      : hasLocalWebVitalsCollector && hasWebVitalsEntrypoint && hasWebVitalsEndpoint && hasWebVitalsPrometheus
        ? 'partial'
        : 'gap',
    title: 'Web Vitals are measured and reported',
    evidence: [
      `web-vitals deps=${rootDeps.webVitals.join(',') || 'none'}`,
      `local collector=${hasLocalWebVitalsCollector}`,
      `entrypoint wired=${hasWebVitalsEntrypoint}`,
      `ingest endpoint=${hasWebVitalsEndpoint}`,
      `prometheus browser metrics=${hasWebVitalsPrometheus}`,
    ],
    nextAction: 'Replace the local browser API collector with the official web-vitals package or equivalent tested library, then add dashboard/alert evidence for LCP, CLS, INP, TTFB, and long-task trends.',
  });

  const dashboardHasChart = /ResponsiveContainer|BarChart|LineChart|AreaChart|PieChart/.test(dashboardPage);
  const dashboardHasTrendApi = /getTrends|\/trends/.test(dashboardService + dashboardRoutes);
  const dashboardHasExecutiveKpis = /yearOverYear|monthOverMonth|cashFlow|cashForecast|receivableAging|agingHeatmap|retention|repurchase|kpiTree|mobileExecutive/i.test(dashboardPage + dashboardService + dashboardRoutes);
  add(requirements, {
    id: 'executive-operating-dashboard',
    category: 'business-experience',
    severity: 'P0',
    status: dashboardHasChart && dashboardHasTrendApi && dashboardHasExecutiveKpis ? 'present' : dashboardHasChart && dashboardHasTrendApi ? 'partial' : 'gap',
    title: 'Executive dashboard shows operating trends, risk, and drill-down KPIs',
    evidence: [
      `dashboard chart evidence=${dashboardHasChart}`,
      `dashboard trend API evidence=${dashboardHasTrendApi}`,
      `YoY/MoM/cash/aging/retention/KPI tree evidence=${dashboardHasExecutiveKpis}`,
      `dashboard uses Recharts=${/recharts/.test(dashboardPage)}`,
    ],
    nextAction: 'Upgrade Dashboard from operational cards to an executive cockpit: revenue/profit trend with YoY/MoM, cash forecast, AR aging heatmap, customer tiers, KPI drill-down, and mobile owner summary.',
  });

  const tableText = `${dataTable}\n${enterpriseGrid}`;
  const hasAdvancedFilterContract = /filterDefinitions|BusinessFilterDefinition|BusinessFilterState|dateRange|numberRange|amountRange|multiSelect|multi-select|facet/i.test(`${tableText}\n${businessFilters}`);
  const smartFilterUsageFiles = findSmartFilterBusinessAdoptionFiles();
  const hasKeywordSearch = /searchTerm|searchValue|onSearchChange/.test(tableText);
  add(requirements, {
    id: 'smart-filter-table',
    category: 'business-experience',
    severity: 'P0',
    status: hasAdvancedFilterContract && smartFilterUsageFiles.length > 0 ? 'present' : hasAdvancedFilterContract || hasKeywordSearch ? 'partial' : 'gap',
    title: 'Data grids support Smart Filter style fielded queries',
    evidence: [
      `keyword search evidence=${hasKeywordSearch}`,
      `advanced filter contract evidence=${hasAdvancedFilterContract}`,
      `smart filter adoption files=${smartFilterUsageFiles.length}`,
      `sample smart filter adoption=${smartFilterUsageFiles.slice(0, 5).join(', ') || 'none'}`,
      `DataTable column visibility=${/visibleColumnKeys|setColumnVisibility/.test(dataTable)}`,
      `EnterpriseDataGrid sorting=${/toggleSort|sortable/.test(enterpriseGrid)}`,
    ],
    nextAction: 'Add reusable fielded filters for date ranges, amount ranges, status multi-select, customer/SKU facets, and saved filter presets.',
  });

  const hasImportPreview = /previewRows|duplicateStrategy|failedRows|exportFailed|failureExport|importPreview/i.test(tableText);
  add(requirements, {
    id: 'table-import-governance',
    category: 'business-experience',
    severity: 'P1',
    status: hasImportPreview ? 'present' : /sheet_to_json|XLSX\.read/.test(tableText) ? 'partial' : 'gap',
    title: 'Table import has preview, duplicate strategy, and failed-row export',
    evidence: [
      `xlsx parsing evidence=${/sheet_to_json|XLSX\.read/.test(tableText)}`,
      `preview/duplicate/failure export evidence=${hasImportPreview}`,
    ],
    nextAction: 'Add an import review step that previews rows, chooses duplicate handling, validates required fields, and exports rejected rows.',
  });

  const hasMobileCardView = /CardView|mobileCard|mobileCards|lg:hidden|md:hidden|sm:hidden/.test(tableText);
  add(requirements, {
    id: 'mobile-card-data-view',
    category: 'business-experience',
    severity: 'P0',
    status: hasMobileCardView ? 'present' : 'gap',
    title: 'Mobile data tables have task-shaped card views',
    evidence: [
      `mobile card evidence=${hasMobileCardView}`,
      `horizontal table wrappers=${countMatches(tableText, /overflow-x-auto/g)}`,
      `minimum table width evidence=${/min-w-\[|min-w-full/.test(tableText)}`,
    ],
    nextAction: 'Add mobile card rendering for DataTable and EnterpriseDataGrid so warehouse, sales, and travel workflows avoid horizontal scrolling.',
  });

  const hasDarkMode = /dark:/.test(dashboardPage + dataTable + enterpriseGrid);
  const hasContrastAudit = listFiles('scripts', (file) => /contrast|wcag/i.test(file)).length > 0;
  add(requirements, {
    id: 'dark-mode-wcag-contrast',
    category: 'business-experience',
    severity: 'P1',
    status: hasDarkMode && hasContrastAudit ? 'present' : hasDarkMode ? 'partial' : 'gap',
    title: 'Dark mode has WCAG contrast evidence',
    evidence: [
      `dark mode classes evidence=${hasDarkMode}`,
      `contrast audit script evidence=${hasContrastAudit}`,
    ],
    nextAction: 'Add an automated contrast audit for dark-mode dashboard/cards/tables before broad visual refactors.',
  });

  add(requirements, {
    id: 'websocket-notifications',
    category: 'production-readiness',
    severity: 'P2',
    status: backendDeps.websocket.length || rootDeps.websocketRoot.length ? 'present' : 'gap',
    title: 'Real-time notifications have a WebSocket/SSE channel',
    evidence: [
      `backend websocket deps=${backendDeps.websocket.join(',') || 'none'}`,
      `root websocket deps=${rootDeps.websocketRoot.join(',') || 'none'}`,
      `CSP ws allowed=${/ws:/.test(serverText) && /wss:/.test(serverText)}`,
    ],
    nextAction: 'Define notification event contracts and prefer SSE/WebSocket after API versioning is in place.',
  });

  add(requirements, {
    id: 'api-versioning',
    category: 'production-readiness',
    severity: 'P1',
    status: apiMounts.versioned > 0 && apiMounts.unversioned === 0
      ? 'present'
      : apiMounts.versioned > 0
        ? 'partial'
        : 'gap',
    title: 'API routes are versioned',
    evidence: [
      `unversioned api mounts=${apiMounts.unversioned}`,
      `versioned api mounts=${apiMounts.versioned}`,
      `first /api line=${findFirstLine(serverText, "app.use('/api/") || 'none'}`,
    ],
    nextAction: 'Keep /api/v1 compatibility aliases, migrate frontend clients route group by route group, then deprecate unversioned /api once clients and external users are off legacy paths.',
  });

  add(requirements, {
    id: 'file-storage-abstraction',
    category: 'production-readiness',
    severity: 'P1',
    status: backendDeps.storage.length
      ? 'present'
      : /interface\s+ObjectStorage/.test(objectStorageService) && /class\s+LocalObjectStorage/.test(objectStorageService)
        ? 'partial'
        : 'gap',
    title: 'Uploaded files use a storage abstraction beyond local disk',
    evidence: [
      `storage deps=${backendDeps.storage.join(',') || 'none'}`,
      `ObjectStorage interface=${/interface\s+ObjectStorage/.test(objectStorageService)}`,
      `LocalObjectStorage adapter=${/class\s+LocalObjectStorage/.test(objectStorageService)}`,
      `UPLOAD_DIR runtime=${/UPLOAD_DIR/.test(runtimeConfig)}`,
      `/uploads static=${/app\.use\('\/uploads'/.test(serverText)}`,
    ],
    nextAction: 'Add S3/MinIO adapters behind ObjectStorage, move every document controller to objectStorage, and make /uploads static serving conditional on local storage only.',
  });

  add(requirements, {
    id: 'search-engine',
    category: 'production-readiness',
    severity: 'P2',
    status: backendDeps.search.length || rootDeps.searchRoot.length ? 'present' : 'gap',
    title: 'Search workloads have an index/search engine path',
    evidence: [
      `backend search deps=${backendDeps.search.join(',') || 'none'}`,
      `root search deps=${rootDeps.searchRoot.join(',') || 'none'}`,
    ],
    nextAction: 'Start with customer/order indexed read models after PostgreSQL migration and query profiling.',
  });

  add(requirements, {
    id: 'observability',
    category: 'production-readiness',
    severity: 'P1',
    status: /\/metrics/.test(serverText) && /renderPrometheusMetrics/.test(serverText) ? 'partial' : 'gap',
    title: 'Monitoring and observability cover metrics, traces, and dashboards',
    evidence: [
      `/metrics route=${/\/metrics/.test(serverText)}`,
      `renderPrometheusMetrics=${/renderPrometheusMetrics/.test(serverText)}`,
      `OpenTelemetry deps=${backendDeps.otel.join(',') || 'none'}`,
      `Winston logger=${hasDependency(backendPackage, ['winston']).join(',') || 'none'}`,
    ],
    nextAction: 'Keep existing Prometheus text endpoint and add OpenTelemetry tracing plus Grafana dashboard docs.',
  });

  add(requirements, {
    id: 'cache-strategy',
    category: 'production-readiness',
    severity: 'P1',
    status: redisDeps.length === 1 && hasCacheService && hasCacheStrategyDoc
      ? 'present'
      : hasCacheService && hasCacheStrategyDoc
        ? 'partial'
        : 'gap',
    title: 'Cache layer has one client and explicit strategy',
    evidence: [
      `redis deps=${redisDeps.join(',') || 'none'}`,
      `ioredis count=${countMatches(JSON.stringify(backendPackage), /ioredis/g)}`,
      `redis count=${countMatches(JSON.stringify(backendPackage), /"redis"/g)}`,
      `cache service=${hasCacheService}`,
      `cache strategy docs=${cacheStrategyDocs.join(',') || 'none'}`,
      `selected cache client=${/provider\s*=\s*'ioredis'/.test(cacheService) ? 'ioredis' : 'none'}`,
      `failure mode bypass=${/failureMode:\s*'bypass'/.test(cacheService)}`,
    ],
    nextAction: 'Choose one Redis client and document cache keys, TTLs, invalidation, and failure mode per use case.',
  });

  add(requirements, {
    id: 'json-field-normalization',
    category: 'production-readiness',
    severity: 'P1',
    status: jsonStringFields.length === 0 ? 'present' : 'gap',
    title: 'JSON-like fields are queryable or normalized',
    evidence: [
      `json string fields=${jsonStringFields.length}`,
      `sample fields=${jsonStringFields.slice(0, 8).map((hit) => `${hit.file}:${hit.line}`).join(', ') || 'none'}`,
    ],
    nextAction: 'Normalize addresses/contacts into tables and convert true document metadata to Prisma Json after PostgreSQL migration.',
  });

  add(requirements, {
    id: 'csp-csrf',
    category: 'security-collaboration',
    severity: 'P1',
    status: /helmet\(\{[\s\S]*contentSecurityPolicy/.test(serverText) && backendDeps.csrf.length ? 'present' : 'partial',
    title: 'CSP and CSRF protections are explicit',
    evidence: [
      `helmet CSP=${/helmet\(\{[\s\S]*contentSecurityPolicy/.test(serverText)}`,
      `script unsafe-inline=${/scriptSrc:\s*\[[^\]]*'unsafe-inline'/.test(serverText)}`,
      `style unsafe-inline=${/styleSrc:\s*\[[^\]]*'unsafe-inline'/.test(serverText)}`,
      `CSRF deps=${backendDeps.csrf.join(',') || 'none'}`,
    ],
    nextAction: 'Tighten CSP in stages and add CSRF strategy for cookie-based or browser-mutating endpoints.',
  });

  add(requirements, {
    id: 'mfa',
    category: 'security-collaboration',
    severity: 'P1',
    status: backendDeps.mfa.length || /totp|mfa|2fa|otp/i.test(serverText + readText('backend/src/routes/auth.routes.ts')) ? 'partial' : 'gap',
    title: 'Privileged authentication supports MFA',
    evidence: [
      `MFA deps=${backendDeps.mfa.join(',') || 'none'}`,
      `auth route MFA tokens=${/totp|mfa|2fa|otp/i.test(readText('backend/src/routes/auth.routes.ts'))}`,
    ],
    nextAction: 'Add TOTP enrollment and admin enforcement policy after auth contract tests are in place.',
  });

  add(requirements, {
    id: 'secret-management',
    category: 'security-collaboration',
    severity: 'P1',
    status: backendDeps.vault.length ? 'present' : 'gap',
    title: 'Secrets have a managed provider path',
    evidence: [
      `secret-manager deps=${backendDeps.vault.join(',') || 'none'}`,
      `.env production example=${exists('.env.production.example')}`,
    ],
    nextAction: 'Document env-only as local/dev mode and add Vault/Secrets Manager adapter for deployment.',
  });

  add(requirements, {
    id: 'npm-script-local-execution',
    category: 'security-collaboration',
    severity: 'P1',
    status: npxScripts.length === 0 ? 'present' : 'gap',
    title: 'npm scripts avoid network-capable npx execution',
    evidence: [
      `npx script count=${npxScripts.length}`,
      `sample npx scripts=${npxScripts.slice(0, 10).map((item) => `${item.name}: ${item.command}`).join(' | ') || 'none'}`,
    ],
    nextAction: 'Replace npx invocations with local npm script binary resolution or explicit node wrappers; do not let verification fetch packages from the network.',
  });

  add(requirements, {
    id: 'architecture-decision-records',
    category: 'security-collaboration',
    severity: 'P2',
    status: exists('docs/adr') || exists('docs/ADR') ? 'present' : 'gap',
    title: 'Architecture decisions are recorded as ADRs',
    evidence: [`docs/adr exists=${exists('docs/adr')}`, `docs/ADR exists=${exists('docs/ADR')}`],
    nextAction: 'Add ADRs for PostgreSQL runtime split, offline/service worker policy, cache strategy, and API versioning.',
  });

  add(requirements, {
    id: 'collaboration-docs',
    category: 'security-collaboration',
    severity: 'P2',
    status: exists('CONTRIBUTING.md') && exists('CHANGELOG.md') ? 'present' : 'gap',
    title: 'CONTRIBUTING and CHANGELOG exist',
    evidence: [`CONTRIBUTING.md=${exists('CONTRIBUTING.md')}`, `CHANGELOG.md=${exists('CHANGELOG.md')}`],
    nextAction: 'Add contribution workflow, local validation matrix, release notes policy, and change classification.',
  });

  const webhookHits = listFiles('backend/src', (file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .filter((file) => /webhook|sdk/i.test(file) || /webhook|sdk/i.test(readText(file)));
  add(requirements, {
    id: 'api-sdk-webhooks',
    category: 'security-collaboration',
    severity: 'P2',
    status: exists('sdk') || exists('packages/sdk') || webhookHits.length > 0 ? 'partial' : 'gap',
    title: 'External integration surface exists through SDK or webhooks',
    evidence: [
      `sdk/=${exists('sdk')}`,
      `packages/sdk/=${exists('packages/sdk')}`,
      `webhook/sdk backend hits=${webhookHits.length}`,
    ],
    nextAction: 'Define webhook event envelope, idempotency, retry, and a generated API client after OpenAPI is published.',
  });

  return requirements;
}

function summarize(requirements) {
  const byStatus = {};
  const byCategory = {};
  const bySeverity = {};
  for (const item of requirements) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
  }
  const gaps = requirements.filter((item) => item.status === 'gap');
  const partial = requirements.filter((item) => item.status === 'partial');
  const present = requirements.filter((item) => item.status === 'present');
  return {
    total: requirements.length,
    byStatus,
    byCategory,
    bySeverity,
    present: present.length,
    partial: partial.length,
    gaps: gaps.length,
    p0Gaps: gaps.filter((item) => item.severity === 'P0').length,
    p1Gaps: gaps.filter((item) => item.severity === 'P1').length,
  };
}

function statusFrom(summary) {
  if (summary.p0Gaps > 0) return 'not-production-ready';
  if (summary.p1Gaps > 0 || summary.partial > 0) return 'needs-hardening';
  return 'production-ready-evidence-present';
}

function renderMarkdown(report) {
  const lines = [
    '# Engineering Production Readiness Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- requirements: ${report.summary.total}`,
    `- present: ${report.summary.present}`,
    `- partial: ${report.summary.partial}`,
    `- gaps: ${report.summary.gaps}`,
    `- P0 gaps: ${report.summary.p0Gaps}`,
    `- P1 gaps: ${report.summary.p1Gaps}`,
    '',
    '## Readiness By Category',
    '',
    '| category | total | present | partial | gap |',
    '|---|---:|---:|---:|---:|',
  ];
  const categories = Array.from(new Set(report.requirements.map((item) => item.category))).sort();
  for (const category of categories) {
    const items = report.requirements.filter((item) => item.category === category);
    lines.push(`| ${category} | ${items.length} | ${items.filter((item) => item.status === 'present').length} | ${items.filter((item) => item.status === 'partial').length} | ${items.filter((item) => item.status === 'gap').length} |`);
  }
  lines.push('', '## Requirements', '');
  for (const item of report.requirements) {
    lines.push(`### ${item.id}`);
    lines.push('');
    lines.push(`- status: ${item.status}`);
    lines.push(`- severity: ${item.severity}`);
    lines.push(`- category: ${item.category}`);
    lines.push(`- title: ${item.title}`);
    lines.push('- evidence:');
    for (const evidence of item.evidence) lines.push(`  - ${evidence}`);
    if (item.nextAction) lines.push(`- next action: ${item.nextAction}`);
    lines.push('');
  }
  lines.push('## Reproduction', '', '```powershell', 'npm run audit:engineering:readiness', '```', '');
  return lines.join(os.EOL);
}

function main() {
  const requirements = buildRequirements();
  const summary = summarize(requirements);
  const report = {
    schemaVersion: 1,
    auditId: 'engineering-production-readiness-v1',
    generatedAt: new Date().toISOString(),
    status: statusFrom(summary),
    summary,
    requirements,
    output: {
      json: toPosix(JSON_REPORT),
      markdown: toPosix(MD_REPORT),
    },
    mode: process.env.ENGINEERING_READINESS_FAIL_ON_GAPS === '1' ? 'gate' : 'report-only',
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MD_REPORT, `${renderMarkdown(report)}\n`, 'utf8');

  console.log(`Engineering production readiness audit status=${report.status}`);
  console.log(`Report: ${JSON_REPORT}`);
  if (report.mode === 'gate' && report.status !== 'production-ready-evidence-present') {
    process.exit(1);
  }
}

main();
