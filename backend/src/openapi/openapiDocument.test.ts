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

  it('documents the row-level canonical material repair contract', () => {
    const document = buildOpenApiDocument() as any;
    expect(document.components.schemas.MaterialReadinessIssue.properties.reason.enum)
      .toContain('missing_material_id');
    expect(document.components.schemas.MaterialReadinessErrorResponse.properties.errorCode.enum)
      .toEqual(['MATERIAL_RELEASE_REQUIRED']);
    expect(document.paths['/api/v1/warehouses/stock-balances'].post.responses['409'].content['application/json'].schema)
      .toEqual(expect.objectContaining({
        oneOf: expect.arrayContaining([
          { $ref: '#/components/schemas/MaterialReadinessErrorResponse' },
        ]),
      }));
  });

  it('requires an explicit shelf-life policy when creating a production BOM', () => {
    const document = buildOpenApiDocument();

    for (const prefix of ['/api', '/api/v1']) {
      const createBom = document.paths[`${prefix}/production/boms`]?.post;
      expect((createBom?.requestBody?.content as any)?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/ProductionBomCreateRequest',
      });
      expect(createBom?.responses['201']).toBeDefined();
    }

    expect(document.components.schemas.ProductionBomCreateRequest.required)
      .toEqual(['productName', 'outputUnit', 'shelfLifeDays', 'items']);
    expect(document.components.schemas.ProductionBomCreateRequest.properties.shelfLifeDays)
      .toEqual(expect.objectContaining({ type: 'integer', minimum: 1, maximum: 3650 }));
    expect(document.components.schemas.ProductionBomCreateRequest.properties.materialId)
      .toEqual(expect.objectContaining({ type: 'integer', minimum: 1, nullable: true }));
  });

  it('documents the bounded batch genealogy evidence endpoint', () => {
    const document = buildOpenApiDocument();
    for (const prefix of ['/api', '/api/v1']) {
      const trace = document.paths[`${prefix}/production/batches/{batchId}/trace`]?.get;
      expect(trace).toBeDefined();
      expect(trace?.parameters?.[0]).toEqual(expect.objectContaining({ name: 'batchId', in: 'path', required: true }));
      expect(trace?.description).toContain('scope=direct-one-hop');
      expect(trace?.security).toBeDefined();
    }
  });

  it('documents structured inspection and independent release contracts', () => {
    const document = buildOpenApiDocument();
    for (const prefix of ['/api', '/api/v1']) {
      const submit = document.paths[`${prefix}/production/work-orders/{id}/checks`]?.post;
      const review = document.paths[`${prefix}/production/work-orders/{id}/checks/{checkId}/review`]?.post;
      expect((submit?.requestBody?.content as any)?.['application/json']?.schema).toEqual({ $ref: '#/components/schemas/ProductionQualityInspectionRequest' });
      expect((review?.requestBody?.content as any)?.['application/json']?.schema).toEqual({ $ref: '#/components/schemas/ProductionQualityReviewRequest' });
      expect(submit?.description).toContain('server derives pass/fail');
      expect(review?.description).toContain('self-review');
    }
    expect(document.components.schemas.ProductionQualityInspectionRequest.required).toEqual(['sampleNo', 'measurements']);
    expect(document.components.schemas.ProductionQualityReviewRequest.required).toEqual(['decision', 'reviewNote']);
  });

  it('documents identity-bound manual stock inbound and shipment creation', () => {
    const document = buildOpenApiDocument();
    for (const prefix of ['/api', '/api/v1']) {
      const inbound = document.paths[`${prefix}/warehouses/stock-balances`]?.post;
      const shipment = document.paths[`${prefix}/shipping`]?.post;
      expect((inbound?.requestBody?.content as any)?.['application/json']?.schema)
        .toEqual({ $ref: '#/components/schemas/WarehouseStockCreateRequest' });
      expect((shipment?.requestBody?.content as any)?.['application/json']?.schema)
        .toEqual({ $ref: '#/components/schemas/ShipmentCreateRequest' });
      expect(shipment?.responses['409']).toBeDefined();
      expect(shipment?.responses['404']).toBeDefined();
    }
    expect(document.components.schemas.WarehouseStockCreateRequest.properties.materialId).toBeDefined();
    expect(document.components.schemas.ShipmentCreateRequest.properties.orderItemId).toBeDefined();
    expect(document.components.schemas.ShipmentCreateRequest.properties.materialId).toBeDefined();
  });

  it('documents canonical material search, lifecycle writes, and BOM linkage', () => {
    const document = buildOpenApiDocument();

    for (const prefix of ['/api', '/api/v1']) {
      const materials = document.paths[`${prefix}/materials`];
      const material = document.paths[`${prefix}/materials/{id}`];
      const aliases = document.paths[`${prefix}/materials/{id}/aliases`];
      expect(materials?.get?.parameters?.map(parameter => parameter.name))
        .toEqual(expect.arrayContaining(['q', 'status', 'category', 'limit', 'offset']));
      expect((materials?.post?.requestBody?.content as any)?.['application/json']?.schema)
        .toEqual({ $ref: '#/components/schemas/MaterialWriteRequest' });
      expect((material?.patch?.requestBody?.content as any)?.['application/json']?.schema)
        .toEqual({ $ref: '#/components/schemas/MaterialUpdateRequest' });
      expect(aliases?.post?.responses['201']).toBeDefined();
    }

    expect(document.components.schemas.ProductionBomItemRequest.properties.materialId)
      .toEqual(expect.objectContaining({ type: 'integer', minimum: 1 }));
    expect(document.components.schemas.Material).toBeDefined();
    expect(document.components.schemas.MaterialAlias).toBeDefined();
  });

  it('documents canonical material identity on purchase-order creation', () => {
    const document = buildOpenApiDocument();

    for (const prefix of ['/api', '/api/v1']) {
      const createOrder = document.paths[`${prefix}/procurement/orders`]?.post;
      expect((createOrder?.requestBody?.content as any)?.['application/json']?.schema)
        .toEqual({ $ref: '#/components/schemas/ProcurementPurchaseOrderCreateRequest' });
      expect(createOrder?.responses['201']).toBeDefined();
    }

    expect(document.components.schemas.ProcurementPurchaseOrderCreateRequest.required)
      .toEqual(['supplierId', 'item', 'quantity', 'unit', 'price', 'eta']);
    expect(document.components.schemas.ProcurementPurchaseOrderCreateRequest.properties.materialId)
      .toEqual(expect.objectContaining({ type: 'integer', minimum: 1, nullable: true }));
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
