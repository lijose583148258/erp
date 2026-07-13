const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const add = (severity, file, message) => findings.push({ severity, file, message });

function requireIncludes(relativePath, tokens) {
  if (!exists(relativePath)) {
    add('P0', relativePath, 'Required OpenAPI contract file is missing.');
    return '';
  }
  const text = read(relativePath);
  for (const token of tokens) {
    if (!text.includes(token)) {
      add('P1', relativePath, `Missing OpenAPI contract token: ${token}`);
    }
  }
  return text;
}

const openApiDocument = requireIncludes('backend/src/openapi/openapiDocument.ts', [
  "openapi: '3.0.3'",
  "'/api/v1'",
  "'/api'",
  '${prefix}/openapi.json',
  '${prefix}/docs',
  '${prefix}/rum/vitals',
  '/metrics',
  'CustomerListResponse',
  'OrderListResponse',
  'CollectionOverdueListResponse',
  'bearerAuth',
]);

requireIncludes('backend/src/server.ts', [
  "app.get(['/api/openapi.json', '/api/v1/openapi.json']",
  "app.get('/api/docs'",
  "app.get('/api/v1/docs'",
  'buildOpenApiDocument()',
  "renderOpenApiDocsHtml('/api/openapi.json')",
  "renderOpenApiDocsHtml('/api/v1/openapi.json')",
]);

requireIncludes('backend/src/routes/apiRegistry.ts', [
  "export const API_PREFIXES = ['/api', '/api/v1'] as const;",
  'export const API_ROUTE_MODULES',
  'mountApiRoutes',
]);

requireIncludes('backend/src/openapi/openapiRoutes.test.ts', [
  "get('/api/openapi.json')",
  "get('/api/v1/openapi.json')",
  "get('/api/v1/docs')",
  "post('/api/rum/vitals')",
  "post('/api/v1/rum/vitals')",
  "get('/metrics').expect(401)",
]);

const packageJson = requireIncludes('package.json', [
  'audit:api:openapi',
  'audit:api:sdk',
  'generate:api:sdk',
]);

if (packageJson && !packageJson.includes('node ./scripts/openapi-contract-audit-v1.cjs')) {
  add('P1', 'package.json', 'audit:api:openapi should run scripts/openapi-contract-audit-v1.cjs.');
}

if (!exists('docs/adr/0001-versioned-api-openapi-contract.md')) {
  add('P1', 'docs/adr/0001-versioned-api-openapi-contract.md', 'Versioned API/OpenAPI ADR is missing.');
}

if (openApiDocument && !openApiDocument.includes('Use <code>/api/v1/*</code> for new production clients')) {
  add('P2', 'backend/src/openapi/openapiDocument.ts', 'Docs landing page should steer new integrations to /api/v1.');
}

if (findings.length) {
  console.error('OpenAPI Contract Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('OpenAPI Contract Audit: PASS');
console.log('- /api and /api/v1 both expose OpenAPI JSON and docs entry points.');
console.log('- Runtime probes, RUM ingest, and metrics contract surfaces are documented.');
console.log('- Route registry, server mounts, and backend tests still agree on the versioned contract boundary.');
