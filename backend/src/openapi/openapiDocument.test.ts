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
    expect(document.paths['/internal/ready']?.get?.security).toEqual([{ bearerAuth: [] }, { metricsBearerAuth: [] }]);
    expect(document.paths['/internal/health']?.get?.security).toEqual([{ bearerAuth: [] }, { metricsBearerAuth: [] }]);
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

  it('documents warehouse idempotency and optimistic concurrency contracts', () => {
    const document = buildOpenApiDocument();

    for (const prefix of ['/api', '/api/v1']) {
      const adjustment = document.paths[`${prefix}/warehouses/stock-balances/{id}`]?.patch;
      const transfer = document.paths[`${prefix}/warehouses/stock-balances/{id}/transfer`]?.post;
      expect(adjustment?.responses['409']).toBeDefined();
      expect(transfer?.responses['409']).toBeDefined();
      expect((adjustment?.requestBody?.content as any)?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/WarehouseStockAdjustmentRequest',
      });
    }

    expect(document.components.schemas.WarehouseStockAdjustmentRequest.required)
      .toEqual(['quantity', 'expectedQuantity', 'requestId']);
    expect(document.components.schemas.WarehouseRequestId.pattern)
      .toBe('^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$');
  });

  it('documents the persistent order import idempotency contract', () => {
    const document = buildOpenApiDocument() as any;
    for (const prefix of ['/api', '/api/v1']) {
      const operation = document.paths[`${prefix}/orders/import`].post;
      expect(operation.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: true }),
      ]));
      expect(operation.responses['409']).toBeDefined();
    }
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

  it('resolves every local schema reference after composing the document', () => {
    const document = buildOpenApiDocument();
    const schemaNames = new Set(Object.keys(document.components.schemas));
    const unresolved = new Set<string>();

    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === '$ref' && typeof child === 'string' && child.startsWith('#/components/schemas/')) {
          const schemaName = child.slice('#/components/schemas/'.length);
          if (!schemaNames.has(schemaName)) unresolved.add(schemaName);
        } else {
          visit(child);
        }
      }
    };

    visit(document);
    expect(Array.from(unresolved)).toEqual([]);
  });
});
