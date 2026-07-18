import fs from 'fs';
import path from 'path';

jest.mock('../routes/apiRegistry', () => ({
  API_PREFIXES: ['/api', '/api/v1'],
  API_ROUTE_MODULES: [{
    path: '/ai',
    tag: 'AI',
    summary: 'Governed AI assistant contract.',
    requiresAuth: true,
    router: {},
  }],
}));

import { buildOpenApiDocument } from './openapiDocument';

const expectedReasons = [
  'disabled', 'sensitive', 'unconfigured', 'provider_error', 'audit_unavailable',
  'unsafe_output', 'response_too_large', 'budget_unconfigured',
  'budget_store_unavailable', 'budget_exhausted', 'circuit_open',
];

describe('governed AI OpenAPI contract', () => {
  it('keeps API schemas and the browser client aligned with every fallback reason', () => {
    const document = buildOpenApiDocument() as any;
    const reasonSchema = document.components.schemas.AIAssistResponse
      .allOf[1].properties.data.properties.reason;

    expect(reasonSchema.enum).toEqual(expectedReasons);
    for (const prefix of ['/api', '/api/v1']) {
      expect(document.paths[`${prefix}/ai/assist`]?.post?.responses?.['200']).toBeDefined();
    }

    const browserClient = fs.readFileSync(
      path.resolve(__dirname, '../../../services/aiGateway.service.ts'),
      'utf8',
    );
    for (const reason of expectedReasons) expect(browserClient).toContain(`'${reason}'`);
  });
});
