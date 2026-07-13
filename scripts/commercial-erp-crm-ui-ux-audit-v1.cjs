const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const ROUTES_FILE = path.join(ROOT, 'scripts', 'audit-routes', 'commercial-erp-crm-ui-ux-routes.cjs');
const ROUTES_MODULE = require(ROUTES_FILE);
const ROUTES = Array.isArray(ROUTES_MODULE) ? ROUTES_MODULE : ROUTES_MODULE.routes;
const COMMERCIAL_CONFIG = ROUTES_MODULE.commercialAuditConfig || {};
const RUNNER = path.join(ROOT, 'scripts', 'parallel-isolated-playwright-audit-v1.cjs');
const DEFAULT_APP_URL = 'http://127.0.0.1:5001/';

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${process.pid}-${random}`;
}

function parseNumberEnv(name, defaultValue, min = 0) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a number >= ${min}`);
  }
  return value;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${value}\n`, 'utf8');
}

function toRepoRelative(filePath) {
  if (!filePath) return null;
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function normalizePathForReport(filePath) {
  if (!filePath) return null;
  return path.resolve(filePath).replace(/\\/g, '/');
}

function routeMetadataById() {
  return Object.fromEntries(ROUTES.map((route) => [route.id, route]));
}

function countIssues(route) {
  return (
    (route.consoleErrors || []).length +
    (route.pageErrors || []).length +
    (route.httpFailures || []).length +
    (route.failedRequests || []).length
  );
}

function screenshotNameFor(routeId) {
  return `${String(routeId).replace(/[^a-z0-9_-]/gi, '_')}.png`;
}

function resolveRouteScreenshot(route, workerOutputDir) {
  if (!workerOutputDir) return null;
  if (route.screenshot) {
    return path.resolve(workerOutputDir, route.screenshot);
  }
  const fallback = path.resolve(workerOutputDir, 'screenshots', screenshotNameFor(route.id));
  return fs.existsSync(fallback) ? fallback : null;
}

function scoreRoute(route, metadata, workerOutputDir) {
  const screenshotAbsolute = resolveRouteScreenshot(route, workerOutputDir);
  const scoring = {
    routeRendered: route.status === 'passed',
    screenshotCaptured: Boolean(screenshotAbsolute),
    browserHealthy: countIssues(route) === 0,
    metadataPresent: Boolean(metadata?.commercial),
  };
  const weights = COMMERCIAL_CONFIG.scoring || {};
  const totalPossible =
    (weights.routeRenderedWeight || 50) +
    (weights.screenshotWeight || 20) +
    (weights.browserHealthWeight || 25) +
    (weights.metadataWeight || 5);
  const earned =
    (scoring.routeRendered ? weights.routeRenderedWeight || 50 : 0) +
    (scoring.screenshotCaptured ? weights.screenshotWeight || 20 : 0) +
    (scoring.browserHealthy ? weights.browserHealthWeight || 25 : 0) +
    (scoring.metadataPresent ? weights.metadataWeight || 5 : 0);

  const commercialWeight = Number(metadata?.commercial?.weight || 1);
  return {
    routeId: route.id,
    moduleId: metadata?.commercial?.moduleId || route.id,
    title: route.title,
    hash: route.hash,
    category: route.category,
    group: metadata?.commercial?.group || 'unknown',
    risk: metadata?.commercial?.risk || route.severity || 'unknown',
    viewport: metadata?.commercial?.viewport || 'unknown',
    commercialWeight,
    criteriaIds: metadata?.commercial?.criteriaIds || [],
    evidenceRequired: metadata?.commercial?.evidenceRequired || [],
    actionEvidence: metadata?.commercial?.actionEvidence || [],
    sampling: metadata?.commercial?.sampling || null,
    score: Number(((earned / totalPossible) * 100).toFixed(2)),
    weightedEarned: earned * commercialWeight,
    weightedPossible: totalPossible * commercialWeight,
    checks: scoring,
    matchedText: route.matchedText || null,
    issueCount: countIssues(route),
    error: route.error || null,
    screenshot: screenshotAbsolute ? normalizePathForReport(screenshotAbsolute) : null,
  };
}

function scoreReport(parallelReport) {
  const metadata = routeMetadataById();
  const workerDirs = Object.fromEntries((parallelReport.workers || []).map((worker) => [worker.workerId, worker.outputDir]));
  const routes = (parallelReport.routes || []).map((route) =>
    scoreRoute(route, metadata[route.id], workerDirs[route.workerId]),
  );
  const weightedEarned = routes.reduce((sum, route) => sum + route.weightedEarned, 0);
  const weightedPossible = routes.reduce((sum, route) => sum + route.weightedPossible, 0);
  const score = weightedPossible > 0 ? Number(((weightedEarned / weightedPossible) * 100).toFixed(2)) : 0;
  const missingRoutes = ROUTES.filter((route) => !routes.some((item) => item.routeId === route.id));
  const blockers = routes.filter((route) => route.risk === 'critical' && route.score < 100);
  const missingScreenshots = routes.filter((route) => !route.screenshot);
  const groupsCovered = Array.from(new Set(routes.map((route) => route.group))).sort();
  const criteriaCovered = Array.from(new Set(routes.flatMap((route) => route.criteriaIds || []))).sort();
  const screenshots = routes
    .filter((route) => route.screenshot)
    .map((route) => ({
      routeId: route.routeId,
      moduleId: route.moduleId,
      viewport: route.viewport,
      path: route.screenshot,
    }));
  return {
    score,
    minScore: parseNumberEnv('COMMERCIAL_UI_UX_MIN_SCORE', COMMERCIAL_CONFIG.scoring?.minScore || 85, 0),
    routes,
    missingRoutes: missingRoutes.map((route) => route.id),
    missingScreenshots: missingScreenshots.map((route) => route.routeId),
    blockers,
    groupsCovered,
    criteriaCovered,
    screenshots,
  };
}

function gitScopeEvidence() {
  const result = spawnSync('git', ['status', '--porcelain=v1'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  const statusEntries = result.status === 0
    ? result.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
    : [];
  const changedFiles = statusEntries
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/'));
  const forbiddenPatterns = [
    /^\.github\//,
    /^backend\//,
    /^scripts\/parallel-isolated-playwright-audit-v1\.cjs$/,
    /^scripts\/lib\/isolated-playwright-/,
  ];
  const forbiddenFiles = changedFiles.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));
  return {
    statusEntries,
    changedFiles,
    forbiddenFiles,
    status: forbiddenFiles.length ? 'failed' : 'passed',
  };
}

function summarizeCriteriaByDimension(criteria) {
  return criteria.reduce((summary, item) => {
    const dimension = item.dimension || 'uncategorized';
    if (!summary[dimension]) {
      summary[dimension] = {
        criteria: 0,
        totalWeight: 0,
        ids: [],
      };
    }
    summary[dimension].criteria += 1;
    summary[dimension].totalWeight += Number(item.weight || 0);
    summary[dimension].ids.push(item.id);
    return summary;
  }, {});
}

function summarizeCriteriaMapping(criteria, coveredCriteriaIds) {
  const covered = new Set(coveredCriteriaIds || []);
  const routeBound = criteria.filter((item) => !item.appliesTo?.reportLevel && !item.appliesTo?.policyLevel);
  return {
    routeBoundCriteriaTotal: routeBound.length,
    coveredCriteriaIds: Array.from(covered).sort(),
    unmappedRouteCriteriaIds: routeBound
      .filter((item) => !covered.has(item.id))
      .map((item) => item.id)
      .sort(),
    reportLevelCriteriaIds: criteria.filter((item) => item.appliesTo?.reportLevel).map((item) => item.id),
    policyLevelCriteriaIds: criteria.filter((item) => item.appliesTo?.policyLevel).map((item) => item.id),
  };
}

function buildFuturePrLeadDispositions() {
  return [
    {
      id: 'database-production',
      label: 'SQLite to PostgreSQL production artifact',
      currentEvidence: 'Default runtime remains SQLite, but scripts/db-migration-probe.cjs validates the copied schema as PostgreSQL, scripts/postgres-prisma-artifact-v1.cjs generates an isolated PostgreSQL Prisma client artifact under output/, docker-compose.postgres.yml provides a PostgreSQL-only rehearsal database, scripts/build-postgres-server-artifact-v1.cjs builds a copied backend dist wired to the generated PostgreSQL Prisma client, scripts/postgres-raw-sql-compat-audit-v1.cjs reports zero P1 cutover blockers and zero P2 raw SQL review files, and scripts/postgres-migration-rehearsal-audit-v1.cjs gates the preflight/backup/snapshot/rollback runbook.',
      pr2Decision: 'done-foundation',
      futureLane: 'Complete live PostgreSQL data import rehearsal, inventory/cost route smoke tests, same-window rollback execution, and PostgreSQL backup/restore verification.',
      evidenceCommands: [
        'npm run build:backend:postgres-server-artifact',
        'npm run audit:db:postgres-server-artifact',
        'npm run audit:db:postgres-artifact',
        'npm run audit:db:postgres-boundary',
        'npm run audit:db:postgres-raw-sql',
        'rg -n "provider|sqlite|postgres|DATABASE_URL|postgres-prisma-artifact|postgres-server-artifact|postgres-boundary|postgres-raw-sql|docker-compose.postgres|audit:db:postgres-artifact|audit:db:postgres-server-artifact|audit:db:postgres-raw-sql" backend/prisma Dockerfile backend/Dockerfile backend/src/config/runtime.ts scripts package.json docker-compose.postgres.yml',
      ],
    },
    {
      id: 'typescript-strictness',
      label: 'TypeScript strictness',
      currentEvidence: 'root tsconfig.json has no full-app strict flag; backend/tsconfig.json already has strict: true; tsconfig.strict.json gates selected frontend typed boundaries, including state, runtime error boundaries, virtual rows, realtime service, shared contract, and SDK files, through npm run typecheck:strict.',
      pr2Decision: 'foundation-added',
      futureLane: 'Expand the strict include list route by route, then move strict flags into root tsconfig.',
      evidenceCommands: ['npm run audit:frontend:strict-ratchet', 'npm run typecheck:strict', 'rg -n "\\"strict\\"|typecheck:strict|tsconfig.strict" tsconfig.json tsconfig.strict.json backend/tsconfig.json package.json'],
    },
    {
      id: 'frontend-structure',
      label: 'Frontend source structure',
      currentEvidence: 'active frontend code lives in app/, components/, pages/, services/ and root tsconfig excludes src.',
      pr2Decision: 'out-of-pr2',
      futureLane: 'Staged src/ migration with import aliases and active-source gates.',
      evidenceCommands: ['rg -n "exclude|src|app|components|pages|services" tsconfig.json package.json'],
    },
    {
      id: 'shared-contracts',
      label: 'Shared API/domain contracts',
      currentEvidence: 'shared/api-contract.ts is generated from backend/src/routes/apiRegistry.ts for API namespaces, response envelopes, pagination metadata, route modules, and the first customer/order/collection overdue list DTOs; root types.ts still manually mirrors broader domain shapes while Prisma models live under backend/prisma/models/*.prisma.',
      pr2Decision: 'foundation-added',
      futureLane: 'Generate broader endpoint-specific API DTOs from richer OpenAPI schemas for payments, inventory, finance, procurement, and warehouse workflows.',
      evidenceCommands: ['npm run audit:api:shared-contract', 'rg -n "interface|type|Prisma|model |AilaoDaApiResponse|AilaoDaCustomerList|AilaoDaOrderList|AILAO_DA_API_MODULES" shared sdk types.ts backend/prisma backend/src scripts'],
    },
    {
      id: 'backend-layering',
      label: 'backend layering',
      currentEvidence: 'backend/src/services/customer-query.service.ts owns CRM customer list/stat reads and OrderWorkspaceService owns sales order reads; many remaining controllers still combine HTTP and data access.',
      pr2Decision: 'foundation-added',
      futureLane: 'Extract service boundaries route by route with transaction/read-model tests.',
      evidenceCommands: ['npm run audit:backend:layering', 'rg -n "CustomerQueryService|OrderWorkspaceService|prisma\\." backend/src/controllers backend/src/services'],
    },
    {
      id: 'client-server-state',
      label: 'Client/server state management',
      currentEvidence: 'app/serverState.ts adds deterministic query keys, in-flight dedupe, TTL reuse, and invalidation; app/clientState.ts adds a Zustand shell-level client-state store; the sales order workspace now loads orders, customer lookup, and active contracts through the server-state boundary, and the collection center loads workbench/overdue search pages through the same boundary.',
      pr2Decision: 'foundation-added',
      futureLane: 'Broaden server-state adoption route by route and migrate performance-sensitive Context consumers to direct Zustand selectors.',
      evidenceCommands: ['npm run audit:frontend:server-state', 'npm run audit:frontend:client-state', 'rg -n "serverStateClient|invalidateSalesOrderWorkspaceState|invalidateCollectionCenterState|COLLECTION_WORKBENCH_QUERY_KEY|useClientStateStore|zustand|react-query|@tanstack/react-query|swr|createContext|useContext" package.json app components pages services'],
    },
    {
      id: 'route-loading-error-boundary',
      label: 'Route lazy loading and error boundaries',
      currentEvidence: 'app/appContent.tsx uses React.lazy and PageErrorBoundary for active pages; index.tsx wraps the shell in ErrorBoundary; scripts/frontend-runtime-resilience-audit-v1.cjs and frontend unit tests cover actionable root/page fallbacks.',
      pr2Decision: 'foundation-added',
      futureLane: 'Add browser-level fault injection for lazy import failures and connect client issue reports to production observability.',
      evidenceCommands: ['npm run audit:frontend:runtime-resilience', 'npm run test:unit:frontend', 'rg -n "React.lazy|PageErrorBoundary|ErrorBoundary|Suspense|RootErrorFallback|PageErrorFallback" app components pages index.tsx scripts'],
    },
    {
      id: 'large-table-scalability',
      label: 'Large table scalability',
      currentEvidence: 'EnterpriseDataGrid uses @tanstack/react-virtual for measured row virtualization and overscan on large loaded pages; scripts/frontend-bundle-budget-audit-v1.cjs enforces build asset budgets after Vite output; server pagination/search remains the main production path.',
      pr2Decision: 'foundation-added',
      futureLane: 'Add browser route timing budgets, mobile-specific list renderers, and search/index strategy.',
      evidenceCommands: ['npm run audit:ui:virtualized-grid', 'npm run audit:frontend:bundle-budget', 'rg -n "useVirtualizer|data-virtualizer|virtualizeThreshold|pagination|bundle-budget|manualChunks" components pages scripts vite.config.ts'],
    },
    {
      id: 'pwa-offline',
      label: 'PWA/offline policy',
      currentEvidence: 'public/app-pwa.js registers /sw.js; public/sw.js caches only the app shell/static assets, excludes /api, /uploads, /metrics, /health, and /ready, and falls back to public/offline.html for failed navigation.',
      pr2Decision: 'foundation-added',
      futureLane: 'Define stale-data labels, conflict handling, encrypted persistence, and per-module mobile offline read/write rules before caching ERP record data.',
      evidenceCommands: ['npm run audit:pwa:offline', 'rg -n "/sw\\.js|manifest|serviceWorker|Service Worker|offline" backend/src public app components pages services'],
    },
    {
      id: 'observability-rum',
      label: 'Browser RUM and Web Vitals',
      currentEvidence: 'public/app-vitals.js collects privacy-safe browser Web Vitals, backend /api/rum/vitals aggregates them into Prometheus metrics, requests emit W3C traceparent/X-Request-Id, and docker-compose.yml includes optional Prometheus/Grafana/OpenTelemetry Collector under the observability profile with starter alerts and ops/grafana/dashboards/ailaoda-overview.json.',
      pr2Decision: 'done-foundation',
      futureLane: 'Add token rotation, alert receivers, tuned thresholds, OpenTelemetry SDK spans/exporters, log aggregation, and trace storage.',
      evidenceCommands: [
        'npm run audit:observability:rum',
        'npm run audit:observability:stack',
        'rg -n "web-vitals|PerformanceObserver|navigator\\.sendBeacon|/rum|/metrics|/health|/ready|traceparent|X-Request-Id|otel|prometheus|grafana|observability|ailaoda-overview" app components pages services backend/src package.json docker-compose.yml ops docs scripts',
      ],
    },
    {
      id: 'api-versioning',
      label: 'API versioning',
      currentEvidence: 'backend/src/routes/apiRegistry.ts mounts API_ROUTE_MODULES under both /api and /api/v1; OpenAPI JSON is served from both namespaces and documents typed customer/order/collection overdue list schemas under the stable v1 surface.',
      pr2Decision: 'done-foundation',
      futureLane: 'Add deprecation policy and expand endpoint DTOs once more schemas are fully specified.',
      evidenceCommands: ['rg -n "/api/v1|API_PREFIXES|mountApiRoutes|openapi.json|CustomerListResponse|OrderListResponse|CollectionOverdueListResponse" backend/src'],
    },
    {
      id: 'realtime-notifications',
      label: 'Realtime notifications and collaboration',
      currentEvidence: 'backend/src/services/realtime-notification.service.ts exposes authenticated /ws/notifications and order/payment mutation paths publish workflow events; services/realtime.service.ts connects the frontend shell after login.',
      pr2Decision: 'foundation-added',
      futureLane: 'Add persisted delivery receipts, tenant-aware channels, heartbeat telemetry, and managed WebSocket scaling when deployment topology is fixed.',
      evidenceCommands: ['npm run audit:realtime:notifications', 'rg -n "socket\\.io|WebSocket|new WebSocket|EventSource|SSE|/ws/notifications|publishRealtimeNotification" backend/src app components pages services package.json backend/package.json'],
    },
    {
      id: 'file-storage',
      label: 'File storage abstraction',
      currentEvidence: 'backend/src/services/file-storage.service.ts defines FileStorageProvider with local and S3/MinIO-compatible providers; contract/POD writes and protected downloads use fileStorage; docker-compose.yml includes optional MinIO rehearsal under the object-storage profile.',
      pr2Decision: 'done-foundation',
      futureLane: 'Add retention policy, bucket lifecycle rules, signed direct-upload URLs, and deployment-specific bucket provisioning.',
      evidenceCommands: [
        'npm run audit:storage:abstraction',
        'npm --prefix backend test -- --runTestsByPath src/services/file-storage.service.test.ts',
        'rg -n "FileStorageProvider|LocalFileStorageProvider|S3FileStorageProvider|FILE_STORAGE_DRIVER|S3_ENDPOINT|object-storage|minio" backend/src docker-compose.yml .env.production.example docs scripts',
      ],
    },
    {
      id: 'search-engine',
      label: 'Search engine and indexing',
      currentEvidence: 'backend/src/services/search.service.ts centralizes customer/order Prisma fallback search and Meilisearch candidate ID recall; customer/order lists still apply Prisma business filters and data-scope permissions; docker-compose.yml includes optional Meilisearch rehearsal under the search profile.',
      pr2Decision: 'foundation-added',
      futureLane: 'Add external indexer/backfill jobs, permission-aware document model, freshness monitoring, ranking, and procurement/warehouse indexing.',
      evidenceCommands: [
        'npm run audit:search:boundary',
        'npm --prefix backend test -- --runTestsByPath src/services/search.service.test.ts src/services/customer-query.service.test.ts',
        'rg -n "MeilisearchProvider|buildCustomerSearchWhereAsync|buildOrderSearchWhereAsync|getSearchStatus|SEARCH_DRIVER|MEILISEARCH_API_KEY|meilisearch|search profile|attributesToRetrieve" backend/src docker-compose.yml .env.production.example docs scripts',
      ],
    },
    {
      id: 'unified-cache',
      label: 'Unified Redis/cache strategy',
      currentEvidence: 'backend/src/services/cache.service.ts defines a unified cache boundary with optional ioredis, memory fallback, Prometheus cache metrics, health visibility, and currency rate snapshot adoption.',
      pr2Decision: 'foundation-added',
      futureLane: 'Broaden cache consumers for high-value read models, then add invalidation tests and dashboards.',
      evidenceCommands: ['npm run audit:cache:strategy', 'rg -n "cacheService|ailaoda_cache_operations_total|ioredis|redis" backend/src scripts docs'],
    },
    {
      id: 'json-normalization',
      label: 'JSON field normalization',
      currentEvidence: 'Business fields are stored as JSON strings, including addressesJson, contactsJson, evidenceJson, processJson, qualitySpecJson, ocrMetadata, and dataScopesJson.',
      pr2Decision: 'out-of-pr2',
      futureLane: 'Normalize or type high-risk JSON fields before building broad reporting/search contracts on top of them.',
      evidenceCommands: ['rg -n "Json|Json\\?|String.*Json|addressesJson|contactsJson|evidenceJson|ocrMetadata|dataScopesJson" backend/prisma backend/src'],
    },
    {
      id: 'api-docs-sdk-webhook',
      label: 'OpenAPI, SDK, and webhook surface',
      currentEvidence: 'backend/src/openapi/openapiDocument.ts serves OpenAPI JSON/docs for /api and /api/v1; shared/api-contract.ts and sdk/ailaoda-api-client.ts are generated from the route registry; customer/order/collection overdue list reads now have endpoint-specific DTO helpers; backend/src/services/webhook.service.ts publishes signed order/payment lifecycle webhooks.',
      pr2Decision: 'foundation-added',
      futureLane: 'Expand endpoint request/response schemas, generate broader endpoint DTOs, and add durable webhook retry/dead-letter management.',
      evidenceCommands: ['npm run audit:api:sdk', 'npm run audit:api:shared-contract', 'npm run audit:webhooks', 'rg -n "swagger|openapi|api-docs|webhook|sdk|api-contract" docs backend/src package.json backend/package.json shared sdk scripts .github'],
    },
    {
      id: 'security-collaboration',
      label: 'CSRF, MFA, and secret management',
      currentEvidence: 'Helmet CSP and JWT secret production guard exist; backend/src/security/csrfBoundary.ts enforces the current Bearer-token-only CSRF/session boundary; backend/src/security/secretManagement.ts centralizes JWT secret quality checks; backend/src/security/mfa.service.ts adds a TOTP login gate for configured roles; scripts/production-dependency-security-audit-v1.cjs gates zero production dependency vulnerabilities and blocks no-fix xlsx usage.',
      pr2Decision: 'partial-foundation',
      futureLane: 'Add per-user MFA enrollment/recovery, external secret-manager provider integration, and supersede the CSRF ADR if the product moves to HttpOnly cookie sessions.',
      evidenceCommands: ['npm run audit:security:csrf-boundary', 'npm run audit:security:secrets', 'npm run audit:security:mfa', 'npm run audit:security:dependencies', 'rg -n "csrf|CSRF|helmet|contentSecurityPolicy|mfa|totp|two-factor|2fa|JWT_SECRET|secret manager|vault|audit:security:dependencies|exceljs|xlsx" backend/src backend/package.json package.json docs scripts utils'],
    },
    {
      id: 'engineering-docs',
      label: 'ADR, CONTRIBUTING, and CHANGELOG',
      currentEvidence: 'CONTRIBUTING.md and CHANGELOG.md exist; docs/adr/ now records API/versioning, file storage, PostgreSQL artifact, unified cache, CSRF/session, secret management, MFA, generated SDK, PWA offline shell, frontend server-state, realtime notification, outbound webhook, virtualized grid, search provider, frontend strict ratchet, backend read service layering, shared API contract, frontend client-state, production dependency security, PostgreSQL deployment boundary, PostgreSQL server artifact, and PostgreSQL raw SQL compatibility decisions.',
      pr2Decision: 'foundation-added',
      futureLane: 'Expand release ownership, support policy, and module owner documentation.',
      evidenceCommands: ['npm run audit:docs:engineering', 'Get-ChildItem -Force -Filter CONTRIBUTING*; Get-ChildItem -Force -Filter CHANGELOG*; Get-ChildItem docs/adr'],
    },
    {
      id: 'frontend-component-tests',
      label: 'Frontend component test foundation',
      currentEvidence: 'package.json includes test:unit:frontend and scripts/frontend-unit-tests.tsx covers selected server-rendered UI/helpers plus a React Testing Library/JSDOM proof that TanStack Virtual bounds mounted grid rows; broad route-level component coverage is still future work.',
      pr2Decision: 'partial-foundation',
      futureLane: 'Add Vitest/React Testing Library coverage for grids, filters, dashboard states, and AI surfaces.',
      evidenceCommands: ['rg -n "vitest|@testing-library|jest|describe\\(|it\\(|test\\(" package.json backend/package.json app components pages services utils backend/src'],
    },
  ];
}

function getRecommendedFollowUpOrder() {
  return [
    'Live PostgreSQL data import rehearsal, inventory/cost and route-level smoke tests, same-window rollback execution, and PostgreSQL backup/restore verification',
    'endpoint-specific OpenAPI DTO generation beyond the customer/order/collection overdue read contracts',
    'frontend state rollout with broader server-state adoption and direct Zustand selectors',
    'frontend strictness and component/unit test foundation',
    'browser-level fault injection for lazy route failures after the runtime resilience boundary is stable',
    'browser route timing budgets and mobile-specific list renderers',
    'Web Vitals/RUM and API versioning after the contract boundary is stable',
    'object-storage retention/direct-upload strategy, search/cache strategy, JSON normalization, realtime notifications, and MFA/security hardening',
  ];
}

function buildAiFutureWorkGovernanceMatrix() {
  const blockedData = [
    'raw customer records',
    'supplier records',
    'orders and receivables',
    'finance details',
    'formula/BOM details',
    'contacts, addresses, bank data, and audit logs',
  ];
  return [
    {
      aiSurface: 'global-ai-assistant',
      futureOnly: true,
      featureLane: 'assistant',
      allowedData: ['role', 'route', 'locale', 'safe counts', 'non-sensitive summaries'],
      blockedData,
      defaultMode: 'local/rules',
      externalModelOptInRequired: true,
      privacyGateEvidence: 'AI settings privacy gate screenshot or unavailable marker',
      roleIsolationEvidence: 'crm AI assistant browser audit and permission AI audit evidence',
      humanConfirmationRequired: true,
      plannerExecutorVerifierRequired: true,
      evalRedTeamEvidence: 'ai-security regression and ai-isolation red-team output',
      auditLogEvidence: 'future AI action/refusal audit event evidence',
      readBackEvidence: 'future read-back evidence for any assistant-suggested write',
      status: 'future-only',
      futurePR: 'AI assistant UX hardening with role-aware prompts, refusal clarity, mobile drawer, and eval evidence.',
    },
    {
      aiSurface: 'ocr-document-recognition',
      futureOnly: true,
      featureLane: 'ocr',
      allowedData: ['uploaded document metadata', 'user-approved extracted fields', 'validation errors'],
      blockedData,
      defaultMode: 'local/rules',
      externalModelOptInRequired: true,
      privacyGateEvidence: 'external model opt-in and sensitive document refusal evidence',
      roleIsolationEvidence: 'role-restricted OCR route and permission evidence',
      humanConfirmationRequired: true,
      plannerExecutorVerifierRequired: true,
      evalRedTeamEvidence: 'shipping OCR regression and sensitive prompt red-team evidence',
      auditLogEvidence: 'future OCR parse, preview, confirm, and refusal audit events',
      readBackEvidence: 'read-back of committed document fields after user confirmation',
      status: 'future-only',
      futurePR: 'OCR safety PR with preview, row/field validation, duplicate handling, and read-back audit.',
    },
    {
      aiSurface: 'smart-import-and-table-parsing',
      futureOnly: true,
      featureLane: 'import',
      allowedData: ['file schema', 'sample rows after user upload', 'validation summaries', 'duplicate policy choices'],
      blockedData,
      defaultMode: 'local/rules',
      externalModelOptInRequired: true,
      privacyGateEvidence: 'import privacy copy and external AI disabled-by-default evidence',
      roleIsolationEvidence: 'import route permission and customer-pool isolation evidence',
      humanConfirmationRequired: true,
      plannerExecutorVerifierRequired: true,
      evalRedTeamEvidence: 'import parser regression and failed-row export evidence',
      auditLogEvidence: 'future import preview, confirm, reject, and failed-row export audit events',
      readBackEvidence: 'post-import read-back evidence for created or updated records',
      status: 'future-only',
      futurePR: 'Smart import PR with template, preview, duplicate/update strategy, failed-row export, and read-back checks.',
    },
    {
      aiSurface: 'ai-command-bar',
      futureOnly: true,
      featureLane: 'commandBar',
      allowedData: ['navigation intent', 'read-only query intent', 'route metadata', 'permission-safe summaries'],
      blockedData,
      defaultMode: 'local/rules',
      externalModelOptInRequired: true,
      privacyGateEvidence: 'command intent privacy gate and blocked sensitive prompt evidence',
      roleIsolationEvidence: 'typed tool registry with permission checks before every action',
      humanConfirmationRequired: true,
      plannerExecutorVerifierRequired: true,
      evalRedTeamEvidence: 'command-bar intent eval, permission-bypass red-team, and hidden-write regression',
      auditLogEvidence: 'future command plan, tool call, verifier result, refusal, and confirmation audit events',
      readBackEvidence: 'read-back evidence for any confirmed write tool',
      status: 'future-only',
      futurePR: 'AI command-bar PR starting with navigation and read-only queries before any write-capable tool.',
    },
    {
      aiSurface: 'ai-analytics',
      futureOnly: true,
      featureLane: 'analytics',
      allowedData: ['canonical metric definitions', 'aggregated KPI values', 'source links', 'freshness timestamps'],
      blockedData,
      defaultMode: 'local/rules',
      externalModelOptInRequired: true,
      privacyGateEvidence: 'analytics prompt privacy gate and no-raw-record evidence',
      roleIsolationEvidence: 'role-scoped metric source and dashboard permission evidence',
      humanConfirmationRequired: false,
      plannerExecutorVerifierRequired: true,
      evalRedTeamEvidence: 'anti-fabrication metric eval and unavailable-marker cases',
      auditLogEvidence: 'future analytics question, source metric, confidence, and unavailable-marker trace',
      readBackEvidence: 'source metric link or unavailable marker for every AI explanation',
      status: 'future-only',
      futurePR: 'AI analytics PR with canonical metrics, source links, confidence, unavailable markers, and anti-fabrication eval.',
    },
  ];
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildCommercialReport({ runId, runRoot, startedAt, runnerResult, parallelReport, runnerReportPath }) {
  const scoring = parallelReport
    ? scoreReport(parallelReport)
    : {
      score: 0,
      minScore: parseNumberEnv('COMMERCIAL_UI_UX_MIN_SCORE', COMMERCIAL_CONFIG.scoring?.minScore || 85, 0),
      routes: [],
      missingRoutes: ROUTES.map((route) => route.id),
      missingScreenshots: ROUTES.map((route) => route.id),
      blockers: [],
      groupsCovered: [],
      screenshots: [],
    };
  const scopeEvidence = gitScopeEvidence();
  const runnerPassed = runnerResult.status === 0 && parallelReport?.status === 'passed';
  const productReadinessCriteria = Array.isArray(COMMERCIAL_CONFIG.productReadinessCriteria)
    ? COMMERCIAL_CONFIG.productReadinessCriteria
    : [];
  const approvedSkillAndAgentSupport = COMMERCIAL_CONFIG.approvedSkillAndAgentSupport || {};
  const futurePrLeadDispositions = buildFuturePrLeadDispositions();
  const aiFutureWorkGovernanceMatrix = buildAiFutureWorkGovernanceMatrix();
  const status = runnerPassed &&
    scoring.score >= scoring.minScore &&
    scoring.missingRoutes.length === 0 &&
    scoring.missingScreenshots.length === 0 &&
    scoring.blockers.length === 0 &&
    scopeEvidence.status === 'passed'
    ? 'passed'
    : 'failed';

  return {
    schemaVersion: 1,
    auditId: COMMERCIAL_CONFIG.auditId || 'commercial-erp-crm-ui-ux-v1',
    runId,
    status,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    appUrl: process.env.APP_URL || DEFAULT_APP_URL,
    scope: COMMERCIAL_CONFIG.scope || [],
    nonGoals: COMMERCIAL_CONFIG.nonGoals || [],
    routeConfig: toRepoRelative(ROUTES_FILE),
    runnerFoundation: {
      command: `node ${toRepoRelative(RUNNER)}`,
      reportPath: normalizePathForReport(runnerReportPath),
      status: parallelReport?.status || 'missing-report',
      exitCode: runnerResult.status,
      signal: runnerResult.signal || null,
      error: runnerResult.error ? String(runnerResult.error.message || runnerResult.error) : null,
    },
    scoring: {
      score: scoring.score,
      minScore: scoring.minScore,
      readiness: scoring.score >= 95 ? 'ready' : scoring.score >= scoring.minScore ? 'watch' : 'blocked',
      readinessScope: 'route-evidence-only',
      scoreMeaning: 'route-evidence-health-only',
      groupsCovered: scoring.groupsCovered,
      criteriaCovered: scoring.criteriaCovered,
      routesTotal: ROUTES.length,
      routesScored: scoring.routes.length,
      missingRoutes: scoring.missingRoutes,
      missingScreenshots: scoring.missingScreenshots,
      blockers: scoring.blockers.map((route) => ({
        routeId: route.routeId,
        moduleId: route.moduleId,
        viewport: route.viewport,
        score: route.score,
        error: route.error,
      })),
    },
    scopeGuardEvidence: scopeEvidence,
    approvedSkillAndAgentSupport,
    aiGovernance: {
      status: 'future-only-matrix',
      scope: 'PR2 documents and audits AI governance requirements only; it does not implement assistant, OCR, import, command-bar, analytics, or agent runtime behavior.',
      matrix: aiFutureWorkGovernanceMatrix,
    },
    productReadinessRubric: {
      status: 'manual-review-required',
      scoreScale: 'Per criterion: 0=missing or unsafe, 1=partial or weakly evidenced, 2=mature enough for commercial operator review. Optional 0-5 dimension summaries are derived from these criteria, not from the route health score.',
      reason: 'The automated runner verifies route evidence health. Product maturity criteria require screenshot review, action evidence, theme/locale notes, and missing-capability review; route render alone must not be marked commercially ready.',
      evidenceRecordTemplate: {
        criterionId: 'DASH-01',
        score: '0|1|2',
        routeId: 'dashboard-desktop',
        viewport: 'desktop',
        theme: 'light|dark|unsampled',
        locale: 'zh|en|vi|unsampled',
        evidencePath: 'absolute screenshot or report path',
        missingOrUnavailable: false,
        weakEvidence: true,
        notes: 'manual reviewer note',
      },
      darkModeContrastTemplate: {
        criterionId: 'DARK-01',
        routeId: 'dashboard-desktop',
        foreground: '#ffffff',
        background: '#111827',
        ratio: '4.50',
        wcagThreshold: '4.5 normal text / 3.0 large text or non-text UI',
        pass: true,
        statusMeaningNotColorOnly: true,
        evidencePath: 'absolute screenshot path',
      },
      criteriaTotal: productReadinessCriteria.length,
      dimensions: summarizeCriteriaByDimension(productReadinessCriteria),
      mapping: summarizeCriteriaMapping(productReadinessCriteria, scoring.criteriaCovered),
      criteria: productReadinessCriteria,
    },
    routes: scoring.routes,
    evidence: {
      outputRoot: normalizePathForReport(runRoot),
      isolatedParallelReport: normalizePathForReport(runnerReportPath),
      screenshots: scoring.screenshots,
    },
    externalAuditDisposition: {
      source: 'user-provided external AI audit note',
      disposition: 'review-lead-only-for-pr2',
      reason: 'Architecture/backend recommendations are outside the PR2 commercial UI/UX audit scope guard.',
      futurePrLeadDispositions,
      outOfScopeLeadExamples: futurePrLeadDispositions.map((lead) => lead.label),
      correctedEngineeringReadinessFindings: futurePrLeadDispositions.map((lead) => ({
        area: lead.id,
        evidence: lead.currentEvidence,
        followUp: lead.futureLane,
      })),
      recommendedFollowUpOrder: getRecommendedFollowUpOrder(),
    },
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Commercial ERP/CRM UI/UX Audit v1',
    '',
    `Status: **${report.status}**`,
    `Run ID: \`${report.runId}\``,
    `App URL: \`${report.appUrl}\``,
    `Route evidence health score: **${report.scoring.score} / 100**`,
    `Route evidence readiness: **route-evidence ${report.scoring.readiness}**`,
    '',
    '## Scope Guard',
    '',
    ...report.scope.map((item) => `- ${item}`),
    '',
    '## Non-goals',
    '',
    ...report.nonGoals.map((item) => `- ${item}`),
    '',
    '## Runner Foundation',
    '',
    `- command: \`${report.runnerFoundation.command}\``,
    `- runner status: \`${report.runnerFoundation.status}\``,
    `- runner exit code: \`${report.runnerFoundation.exitCode}\``,
    `- isolated report: \`${report.runnerFoundation.reportPath}\``,
    '',
    '## Route Evidence Health',
    '',
    `- routes configured: ${report.scoring.routesTotal}`,
    `- routes scored: ${report.scoring.routesScored}`,
    `- groups covered: ${report.scoring.groupsCovered.join(', ') || 'none'}`,
    `- criteria covered by routes: ${report.scoring.criteriaCovered.join(', ') || 'none'}`,
    `- missing routes: ${report.scoring.missingRoutes.length ? report.scoring.missingRoutes.join(', ') : 'none'}`,
    `- missing screenshots: ${report.scoring.missingScreenshots.length ? report.scoring.missingScreenshots.join(', ') : 'none'}`,
    `- blocker routes: ${report.scoring.blockers.length}`,
    '',
    '| Route | Viewport | Group | Risk | Health Score | Criteria | Screenshot |',
    '|---|---:|---|---|---:|---|---|',
    ...report.routes.map((route) => [
      route.routeId,
      route.viewport,
      route.group,
      route.risk,
      route.score,
      (route.criteriaIds || []).join(', '),
      route.screenshot ? 'yes' : 'no',
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## Scope Guard Evidence',
    '',
    `- forbidden changed files: ${report.scopeGuardEvidence.forbiddenFiles.length ? report.scopeGuardEvidence.forbiddenFiles.join(', ') : 'none'}`,
    '',
    '## Approved Skills And Agents',
    '',
    'Trusted local skills:',
    ...(report.approvedSkillAndAgentSupport.localSkills || []).map((item) => `- ${item}`),
    '',
    'Allowed subagents:',
    ...(report.approvedSkillAndAgentSupport.subagents || []).map((item) => `- ${item}`),
    '',
    'Guardrails:',
    ...(report.approvedSkillAndAgentSupport.guardrails || []).map((item) => `- ${item}`),
    '',
    '## AI Future Work Governance Matrix',
    '',
    report.aiGovernance.scope,
    '',
    '| Surface | Lane | Status | Default Mode | External Opt-in | Human Confirmation | Planner/Executor/Verifier | Eval/Red-team Evidence | Future PR |',
    '|---|---|---|---|---|---|---|---|---|',
    ...report.aiGovernance.matrix.map((item) => `| ${[
      item.aiSurface,
      item.featureLane,
      item.status,
      item.defaultMode,
      item.externalModelOptInRequired ? 'yes' : 'no',
      item.humanConfirmationRequired ? 'yes' : 'no',
      item.plannerExecutorVerifierRequired ? 'yes' : 'no',
      item.evalRedTeamEvidence,
      item.futurePR,
    ].map(markdownCell).join(' | ')} |`),
    '',
    '## Product Readiness Criteria',
    '',
    `Criteria status: \`${report.productReadinessRubric.status}\``,
    `Score scale: ${report.productReadinessRubric.scoreScale}`,
    report.productReadinessRubric.reason,
    `Unmapped route criteria: ${report.productReadinessRubric.mapping.unmappedRouteCriteriaIds.length ? report.productReadinessRubric.mapping.unmappedRouteCriteriaIds.join(', ') : 'none'}`,
    `Report-level criteria: ${report.productReadinessRubric.mapping.reportLevelCriteriaIds.join(', ') || 'none'}`,
    `Policy-level criteria: ${report.productReadinessRubric.mapping.policyLevelCriteriaIds.join(', ') || 'none'}`,
    '',
    '| ID | Dimension | Weight | Applies To | Criterion | Evidence |',
    '|---|---|---:|---|---|---|',
    ...report.productReadinessRubric.criteria.map((item) => [
      item.id,
      item.dimension,
      item.weight,
      JSON.stringify(item.appliesTo || {}),
      item.criterion,
      (item.evidence || []).join(', '),
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## External Audit Disposition',
    '',
    `The provided external AI audit is treated as ${report.externalAuditDisposition.disposition}.`,
    report.externalAuditDisposition.reason,
    '',
    'Out-of-scope leads:',
    ...report.externalAuditDisposition.outOfScopeLeadExamples.map((item) => `- ${item}`),
    '',
    'Future PR lead dispositions:',
    '',
    '| ID | PR2 Decision | Current Evidence | Future Lane | Evidence Commands |',
    '|---|---|---|---|---|',
    ...report.externalAuditDisposition.futurePrLeadDispositions.map((item) => `| ${[
      item.id,
      item.pr2Decision,
      item.currentEvidence,
      item.futureLane,
      (item.evidenceCommands || []).join('; '),
    ].map(markdownCell).join(' | ')} |`),
    '',
    'Corrected engineering-readiness findings:',
    ...report.externalAuditDisposition.correctedEngineeringReadinessFindings.map((item) =>
      `- ${item.area}: ${item.evidence} Follow-up: ${item.followUp}`,
    ),
    '',
    'Recommended follow-up order:',
    ...report.externalAuditDisposition.recommendedFollowUpOrder.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## Screenshot Index',
    '',
    ...(report.evidence.screenshots.length
      ? report.evidence.screenshots.map((item) => `- ${item.routeId}: \`${item.path}\``)
      : ['No screenshots captured.']),
    '',
    '## Reproduction',
    '',
    '```powershell',
    'npm run audit:commercial:ui-ux',
    '```',
    '',
  ];
  return lines.join(os.EOL);
}

function main() {
  const startedAt = Date.now();
  const runId = process.env.COMMERCIAL_UI_UX_RUN_ID || createRunId();
  const runRoot = path.join(ROOT, 'output', 'commercial-ui-ux-audit', runId);
  const isolatedOutputRoot = path.join(runRoot, 'isolated-playwright');
  ensureDir(runRoot);

  const env = {
    ...process.env,
    APP_URL: process.env.APP_URL || DEFAULT_APP_URL,
    PLAYWRIGHT_USERNAME: process.env.PLAYWRIGHT_USERNAME || 'commercial_ui_ux_audit_admin',
    PLAYWRIGHT_PASSWORD: process.env.PLAYWRIGHT_PASSWORD || 'AuditSmoke12345!',
    ISOLATED_PLAYWRIGHT_ROUTES_FILE: ROUTES_FILE,
    ISOLATED_PLAYWRIGHT_OUTPUT_ROOT: isolatedOutputRoot,
    ISOLATED_PLAYWRIGHT_WORKERS: process.env.COMMERCIAL_UI_UX_WORKERS || process.env.ISOLATED_PLAYWRIGHT_WORKERS || '2',
    ISOLATED_PLAYWRIGHT_FAIL_ON_CONSOLE_ERRORS: process.env.ISOLATED_PLAYWRIGHT_FAIL_ON_CONSOLE_ERRORS || '1',
    ISOLATED_PLAYWRIGHT_FAIL_ON_HTTP_FAILURES: process.env.ISOLATED_PLAYWRIGHT_FAIL_ON_HTTP_FAILURES || '1',
  };

  const runnerResult = spawnSync(process.execPath, [RUNNER], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });

  const runnerReportPath = path.join(isolatedOutputRoot, 'parallel-report.json');
  const parallelReport = readJson(runnerReportPath);
  const report = buildCommercialReport({
    runId,
    runRoot,
    startedAt,
    runnerResult,
    parallelReport,
    runnerReportPath,
  });
  const jsonPath = path.join(runRoot, 'commercial-ui-ux-report-v1.json');
  const mdPath = path.join(runRoot, 'commercial-ui-ux-report-v1.md');
  const summaryPath = path.join(runRoot, 'summary.txt');
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  writeText(summaryPath, [
    `status=${report.status}`,
    `runId=${report.runId}`,
    `score=${report.scoring.score}`,
    `readiness=route-evidence-${report.scoring.readiness}`,
    `readinessScope=${report.scoring.readinessScope}`,
    `report=${normalizePathForReport(jsonPath)}`,
    `markdown=${normalizePathForReport(mdPath)}`,
    `isolatedReport=${normalizePathForReport(runnerReportPath)}`,
  ].join(os.EOL));

  if (report.status !== 'passed') {
    console.error(`Commercial ERP/CRM UI/UX audit failed. Report: ${jsonPath}`);
    process.exit(1);
  }
  console.log(`Commercial ERP/CRM UI/UX audit passed. Report: ${jsonPath}`);
}

main();
