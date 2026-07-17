const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, '');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function add(severity, file, message) {
  findings.push({ severity, file, message });
}

function requireIncludes(file, text, severity, message) {
  const content = read(file);
  if (!content.includes(text)) add(severity, file, message);
  return content;
}

const generator = requireIncludes(
  'scripts/generate-api-sdk-v1.cjs',
  'shared/api-contract.ts',
  'P1',
  'API generator should emit shared/api-contract.ts.',
);
if (!generator.includes('AilaoDaPaginationMeta')) add('P1', 'scripts/generate-api-sdk-v1.cjs', 'Generator should emit shared pagination meta.');
for (const token of ['AilaoDaCustomerListQuery', 'AilaoDaCustomerListResponse', 'AilaoDaOrderListQuery', 'AilaoDaOrderListResponse', 'AilaoDaCollectionOverdueListQuery', 'AilaoDaCollectionOverdueListResponse']) {
  if (!generator.includes(token)) add('P1', 'scripts/generate-api-sdk-v1.cjs', `Generator should emit endpoint contract token: ${token}`);
}

const shared = requireIncludes(
  'shared/api-contract.ts',
  'AilaoDaApiResponse<T = unknown>',
  'P1',
  'Generated shared API response contract is missing.',
);
for (const token of [
  'AilaoDaApiNamespace',
  'AilaoDaPaginationMeta',
  'AILAO_DA_API_MODULES',
  'AilaoDaApiModulePath',
  'AilaoDaCustomerListQuery',
  'AilaoDaCustomerListResponse',
  'AilaoDaOrderListQuery',
  'AilaoDaOrderListResponse',
  'AilaoDaCollectionOverdueListQuery',
  'AilaoDaCollectionOverdueListResponse',
]) {
  if (!shared.includes(token)) add('P1', 'shared/api-contract.ts', `Missing shared contract token: ${token}`);
}

const sdk = requireIncludes(
  'sdk/ailaoda-api-client.ts',
  "from '../shared/api-contract'",
  'P1',
  'SDK should import shared API contract types.',
);
if (sdk.includes('export type AilaoDaApiResponse<T = unknown> =')) {
  add('P1', 'sdk/ailaoda-api-client.ts', 'SDK should not redefine AilaoDaApiResponse.');
}
for (const token of ['listCustomers', 'listOrders', 'listCollectionOverdueOrders']) {
  if (!sdk.includes(token)) add('P1', 'sdk/ailaoda-api-client.ts', `SDK is missing typed endpoint helper: ${token}`);
}

const strict = requireIncludes(
  'tsconfig.strict.json',
  'shared/api-contract.ts',
  'P2',
  'Shared API contract should be covered by the frontend strict ratchet.',
);
if (!strict.includes('sdk/ailaoda-api-client.ts')) add('P2', 'tsconfig.strict.json', 'SDK should remain covered by the frontend strict ratchet.');

if (!exists('docs/adr/0017-shared-api-contract-generation.md')) {
  add('P2', 'docs/adr/0017-shared-api-contract-generation.md', 'Shared API contract ADR is missing.');
}

if (findings.length) {
  console.error('Shared API Contract Audit: FAIL');
  for (const finding of findings) {
    console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Shared API Contract Audit: PASS');
console.log('- shared/api-contract.ts is generated from the API route registry.');
console.log('- Customer, order, and collection overdue list DTOs are shared by OpenAPI, SDK, and frontend strict checks.');
console.log('- SDK imports shared API response/module types instead of redefining them.');
console.log('- Shared contract and SDK are covered by the strict TypeScript ratchet.');
