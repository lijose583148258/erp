import { buildOpenApiDocument } from './openapiDocument';
import { API_ROUTE_MODULES } from '../routes/apiRegistry';

describe('OpenAPI contract foundation', () => {
  const jsonSchemaRef = (response: Record<string, unknown> | undefined) => {
    const content = response?.content as Record<string, { schema?: unknown }> | undefined;
    return content?.['application/json']?.schema;
  };

  it('documents compatibility and v1 namespaces for every API module', () => {
    const document = buildOpenApiDocument();
    const paths = document.paths;

    for (const routeModule of API_ROUTE_MODULES) {
      expect(paths[`/api${routeModule.path}`]).toBeDefined();
      expect(paths[`/api/v1${routeModule.path}`]).toBeDefined();
    }
  });

  it('documents runtime probes and bearer authentication', () => {
    const document = buildOpenApiDocument();

    expect(document.paths['/api/health']).toBeDefined();
    expect(document.paths['/api/v1/health']).toBeDefined();
    expect(document.paths['/api/rum/vitals']?.post?.responses['202']).toBeDefined();
    expect(document.paths['/api/v1/rum/vitals']?.post?.responses['202']).toBeDefined();
    expect(document.paths['/metrics']).toBeDefined();
    expect(document.paths['/metrics'].get?.security).toEqual([{ bearerAuth: [] }, { metricsBearerAuth: [] }]);
    expect(document.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(document.components.securitySchemes.metricsBearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'Opaque collector token',
    });
  });

  it('documents external search operations under both API namespaces', () => {
    const document = buildOpenApiDocument();
    for (const prefix of ['/api', '/api/v1']) {
      expect(document.paths[`${prefix}/system/search/status`]?.get).toBeDefined();
      expect(document.paths[`${prefix}/system/search/reindex`]?.post?.responses['503']).toBeDefined();
    }
  });

  it('documents endpoint-level list contracts for high-frequency customer and order reads', () => {
    const document = buildOpenApiDocument();

    const customers = document.paths['/api/v1/customers']?.get;
    const orders = document.paths['/api/v1/orders']?.get;

    expect(customers?.parameters?.map(parameter => parameter.name)).toEqual(expect.arrayContaining([
      'page',
      'pageSize',
      'search',
      'status',
      'riskLevel',
      'segment',
      'poolState',
      'viewMode',
      'salespersonId',
      'sortBy',
      'sortOrder',
    ]));
    expect(jsonSchemaRef(customers?.responses['200'])).toEqual({
      $ref: '#/components/schemas/CustomerListResponse',
    });

    expect(orders?.parameters?.map(parameter => parameter.name)).toEqual(expect.arrayContaining([
      'page',
      'pageSize',
      'search',
      'status',
      'customerId',
      'startDate',
      'endDate',
      'sortBy',
      'sortOrder',
    ]));
    expect(jsonSchemaRef(orders?.responses['200'])).toEqual({
      $ref: '#/components/schemas/OrderListResponse',
    });

    expect(document.components.schemas.PaginationMeta).toBeDefined();
    expect(document.components.schemas.ApiResponse).toBeDefined();
    expect(document.components.schemas.CustomerListItem).toBeDefined();
    expect(document.components.schemas.OrderListItem).toBeDefined();
  });

  it('documents the overdue collection read model as an endpoint-level contract', () => {
    const document = buildOpenApiDocument();
    const overdue = document.paths['/api/v1/collections/overdue']?.get;

    expect(overdue?.parameters?.map(parameter => parameter.name)).toEqual(expect.arrayContaining([
      'page',
      'pageSize',
      'search',
    ]));
    expect(jsonSchemaRef(overdue?.responses['200'])).toEqual({
      $ref: '#/components/schemas/CollectionOverdueListResponse',
    });
    expect(document.components.schemas.CollectionOverdueListItem).toBeDefined();
    expect(document.components.schemas.CollectionOverdueListResponse).toBeDefined();
  });
});
