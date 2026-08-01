import { API_PREFIXES, API_ROUTE_MODULES } from '../routes/apiRegistry';
import { openApiSchemas } from './openapiSchemas';

type OpenApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type OpenApiOperation = {
  tags: string[];
  summary: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, Record<string, unknown>>;
};

type OpenApiPathItem = Partial<Record<OpenApiMethod, OpenApiOperation>>;

const jsonResponse = {
  '200': { description: 'JSON response.' },
  '401': { description: 'Authentication is required or the token is invalid.' },
  '403': { description: 'The authenticated user does not have the required permission.' },
  '500': { description: 'Unexpected server error.' },
};

const writeResponses = {
  '200': { description: 'Operation completed successfully.' },
  '400': { description: 'The request body, params, or query failed validation.' },
  '401': { description: 'Authentication is required or the token is invalid.' },
  '403': { description: 'The authenticated user does not have the required permission.' },
  '409': { description: 'The operation conflicts with existing business data.' },
  '500': { description: 'Unexpected server error.' },
};

const secured = (requiresAuth: boolean) => (requiresAuth ? [{ bearerAuth: [] }] : undefined);

const queryParam = (name: string, schema: Record<string, unknown>, description: string) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});

const paginatedJsonResponse = (schemaRef: string) => ({
  ...jsonResponse,
  '200': {
    description: 'Paginated JSON response.',
    content: {
      'application/json': {
        schema: { $ref: schemaRef },
      },
    },
  },
});

const listParameters = [
  queryParam('page', { type: 'integer', minimum: 1, default: 1 }, 'One-based result page.'),
  queryParam('pageSize', { type: 'integer', minimum: 1, maximum: 100, default: 30 }, 'Page size, capped by the backend.'),
  queryParam('search', { type: 'string', maxLength: 120 }, 'Normalized text search term.'),
];

const customerListParameters = [
  ...listParameters,
  queryParam('status', { type: 'string', enum: ['active', 'inactive', 'blocked'] }, 'Customer lifecycle status.'),
  queryParam('riskLevel', { type: 'string', enum: ['low', 'medium', 'high'] }, 'Customer risk level.'),
  queryParam('segment', { type: 'string', enum: ['direct', 'channel', 'mixed'] }, 'Customer commercial segment.'),
  queryParam('poolState', { type: 'string', enum: ['public', 'internal', 'private'] }, 'Customer pool state.'),
  queryParam('viewMode', { type: 'string', enum: ['public', 'my'] }, 'Convenience customer pool view.'),
  queryParam('salespersonId', { type: 'integer', minimum: 1 }, 'Assigned salesperson id.'),
  queryParam('sortBy', { type: 'string', enum: ['createdAt', 'updatedAt', 'name', 'creditLimit', 'overdueAmount', 'riskLevel', 'poolUpdatedAt', 'salespersonId'] }, 'Sort field.'),
  queryParam('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }, 'Sort direction.'),
];

const orderListParameters = [
  ...listParameters,
  queryParam('status', { type: 'string' }, 'Order lifecycle status.'),
  queryParam('customerId', { type: 'integer', minimum: 1 }, 'Customer id.'),
  queryParam('startDate', { type: 'string', format: 'date' }, 'Inclusive created-at start date.'),
  queryParam('endDate', { type: 'string', format: 'date' }, 'Inclusive created-at end date.'),
  queryParam('sortBy', { type: 'string', enum: ['createdAt', 'updatedAt', 'orderNo', 'finalAmount', 'paidAmount', 'status', 'paymentStatus'] }, 'Sort field.'),
  queryParam('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }, 'Sort direction.'),
];

const collectionOverdueParameters = [
  queryParam('page', { type: 'integer', minimum: 1, default: 1 }, 'One-based overdue result page.'),
  queryParam('pageSize', { type: 'integer', minimum: 1, maximum: 100 }, 'Page size, capped by the backend.'),
  queryParam('search', { type: 'string', maxLength: 200 }, 'Searches overdue order number, customer names, contact, owner, risk, payment status, and contract text.'),
];

const moduleOperations = (tag: string, summary: string, requiresAuth: boolean): OpenApiPathItem => ({
  get: {
    tags: [tag],
    summary: `List or read ${tag} resources`,
    description: summary,
    security: secured(requiresAuth),
    responses: jsonResponse,
  },
  post: {
    tags: [tag],
    summary: `Create or execute ${tag} workflow actions`,
    description: summary,
    security: secured(requiresAuth),
    responses: writeResponses,
  },
});

export const buildOpenApiDocument = () => {
  const paths: Record<string, OpenApiPathItem> = {};

  for (const prefix of API_PREFIXES) {
    paths[`${prefix}/livez`] = {
      get: {
        tags: ['Runtime'],
        summary: 'Liveness probe',
        responses: { '200': { description: 'The HTTP process is alive.' } },
      },
    };
    paths[`${prefix}/ready`] = {
      get: {
        tags: ['Runtime'],
        summary: 'Readiness probe',
        responses: {
          '200': { description: 'The API, database, and Redis critical dependencies are ready; only minimal public status is returned.' },
          '503': { description: 'The API is running but a critical database or Redis dependency is unavailable.' },
        },
      },
    };
    paths[`${prefix}/health`] = {
      get: {
        tags: ['Runtime'],
        summary: 'Health check',
        responses: {
          '200': { description: 'The API is healthy; only minimal public status is returned.' },
          '503': { description: 'One or more runtime checks are degraded.' },
        },
      },
    };
    paths[`${prefix}/docs`] = {
      get: {
        tags: ['Runtime'],
        summary: 'OpenAPI documentation landing page',
        responses: { '200': { description: 'HTML page linking to the OpenAPI JSON contract.' } },
      },
    };
    paths[`${prefix}/openapi.json`] = {
      get: {
        tags: ['Runtime'],
        summary: 'OpenAPI JSON contract',
        responses: { '200': { description: 'OpenAPI 3.0 JSON document.' } },
      },
    };
    paths[`${prefix}/rum/vitals`] = {
      post: {
        tags: ['Runtime'],
        summary: 'Browser Web Vitals RUM ingest',
        description: 'Accepts privacy-safe browser performance samples and aggregates them for Prometheus metrics.',
        responses: {
          '202': { description: 'One or more Web Vitals samples were accepted.' },
          '400': { description: 'The RUM payload is empty, too large, or invalid.' },
          '429': { description: 'The request was rate limited.' },
          '500': { description: 'Unexpected server error.' },
        },
      },
    };

    for (const routeModule of API_ROUTE_MODULES) {
      paths[`${prefix}${routeModule.path}`] = moduleOperations(
        routeModule.tag,
        routeModule.summary,
        routeModule.requiresAuth,
      );
    }

    paths[`${prefix}/customers`] = {
      ...paths[`${prefix}/customers`],
      get: {
        tags: ['Customers'],
        summary: 'List customers',
        description: 'Returns a paginated CRM customer list with backend-enforced access scope, search, sorting, and pagination caps.',
        security: secured(true),
        parameters: customerListParameters,
        responses: paginatedJsonResponse('#/components/schemas/CustomerListResponse'),
      },
    };

    paths[`${prefix}/orders`] = {
      ...paths[`${prefix}/orders`],
      get: {
        tags: ['Orders'],
        summary: 'List sales orders',
        description: 'Returns a paginated sales order list with backend-enforced access scope, search, sorting, and pagination caps.',
        security: secured(true),
        parameters: orderListParameters,
        responses: paginatedJsonResponse('#/components/schemas/OrderListResponse'),
      },
    };

    paths[`${prefix}/orders/import`] = {
      post: {
        tags: ['Orders'],
        summary: 'Import sales orders idempotently',
        description: 'Imports up to 500 orders. Exact retries with the same Idempotency-Key and payload return the stored result; key reuse with a different payload returns 409. Requires orders.import.',
        security: secured(true),
        parameters: [{
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          description: 'Caller-generated key, 8-80 characters. Keep it stable for an exact network retry.',
          schema: { type: 'string', minLength: 8, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$' },
        }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['orders'], properties: { orders: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object' } } } } } },
        },
        responses: writeResponses,
      },
    };

    paths[`${prefix}/procurement/orders`] = {
      get: {
        tags: ['Procurement'],
        summary: 'List purchase orders',
        description: 'Returns purchase orders visible to the authenticated procurement scope.',
        security: secured(true),
        responses: jsonResponse,
      },
      post: {
        tags: ['Procurement'],
        summary: 'Create a purchase order commitment',
        description: 'Creates a procurement commitment. Inventory is not increased until a later receipt is posted. Canonical material identity is propagated when materialId is supplied.',
        security: secured(true),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ProcurementPurchaseOrderCreateRequest' },
            },
          },
        },
        responses: {
          ...writeResponses,
          '201': { description: 'Purchase order commitment created.' },
        },
      },
    };

    paths[`${prefix}/collections/overdue`] = {
      get: {
        tags: ['Collections'],
        summary: 'List overdue collection orders',
        description: 'Returns a paginated collection workbench read model for overdue receivables with backend-enforced permissions and page-size caps.',
        security: secured(true),
        parameters: collectionOverdueParameters,
        responses: paginatedJsonResponse('#/components/schemas/CollectionOverdueListResponse'),
      },
    };

    paths[`${prefix}/materials`] = {
      get: {
        tags: ['Materials'],
        summary: 'Search canonical material master data',
        description: 'Exact-first relational search across code, Chinese/English/Vietnamese names, CAS, HS code, and governed aliases. Requires materials.read.',
        security: secured(true),
        parameters: [
          queryParam('q', { type: 'string', maxLength: 160 }, 'Code, name, CAS number, HS code, or multilingual alias.'),
          queryParam('status', { type: 'string', enum: ['draft', 'active', 'blocked', 'retired'] }, 'Lifecycle status.'),
          queryParam('category', { type: 'string', enum: ['raw_material', 'finished_good', 'semi_finished', 'packaging', 'consumable', 'service'] }, 'Material category.'),
          queryParam('limit', { type: 'integer', minimum: 1, maximum: 100, default: 30 }, 'Result limit.'),
          queryParam('offset', { type: 'integer', minimum: 0, default: 0 }, 'Result offset.'),
        ],
        responses: jsonResponse,
      },
      post: {
        tags: ['Materials'],
        summary: 'Create canonical material master data',
        description: 'Creates a draft or governed material and its multilingual aliases in one transaction. Requires materials.write.',
        security: secured(true),
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MaterialWriteRequest' } } },
        },
        responses: { ...writeResponses, '201': { description: 'Material created.' } },
      },
    };

    paths[`${prefix}/materials/{id}`] = {
      get: {
        tags: ['Materials'],
        summary: 'Read canonical material master data',
        security: secured(true),
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: { ...jsonResponse, '404': { description: 'Material not found.' } },
      },
      patch: {
        tags: ['Materials'],
        summary: 'Update canonical material with optimistic concurrency',
        description: 'The optional expectedUpdatedAt field rejects stale edits with 409. Active materials cannot remain temporary.',
        security: secured(true),
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MaterialUpdateRequest' } } },
        },
        responses: writeResponses,
      },
    };

    paths[`${prefix}/materials/{id}/aliases`] = {
      post: {
        tags: ['Materials'],
        summary: 'Add a governed multilingual alias',
        security: secured(true),
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['alias'],
                properties: {
                  alias: { type: 'string', minLength: 1, maxLength: 160 },
                  language: { type: 'string', enum: ['zh', 'en', 'vi', 'und'] },
                  aliasType: { type: 'string', enum: ['business', 'supplier', 'customer', 'legacy', 'translation'] },
                },
              },
            },
          },
        },
        responses: { ...writeResponses, '201': { description: 'Alias created.' } },
      },
    };

    paths[`${prefix}/materials/governance/backfill-candidates`] = {
      get: {
        tags: ['Materials'],
        summary: 'Preview controlled historical BOM material backfill',
        description: 'Returns exact-only suggestions without writing data. Every candidate includes an item-ID fingerprint so stale previews are rejected. Requires materials.govern.',
        security: secured(true),
        parameters: [
          queryParam('limit', { type: 'integer', minimum: 1, maximum: 50, default: 30 }, 'Source groups per page.'),
          queryParam('offset', { type: 'integer', minimum: 0, default: 0 }, 'Source-group offset.'),
        ],
        responses: jsonResponse,
      },
    };

    paths[`${prefix}/materials/governance/backfill`] = {
      post: {
        tags: ['Materials'],
        summary: 'Apply an audited historical BOM material backfill',
        description: 'Links at most 500 unchanged BOM rows to active, non-temporary, unit-compatible materials in one transaction. Requires materials.govern.',
        security: secured(true),
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MaterialBomBackfillRequest' } } },
        },
        responses: { ...writeResponses, '201': { description: 'Governance run applied and audited.' } },
      },
    };

    paths[`${prefix}/materials/governance/runs`] = {
      get: {
        tags: ['Materials'],
        summary: 'List historical material governance runs',
        description: 'Lists applied and rolled-back BOM material governance runs. Requires materials.govern.',
        security: secured(true),
        parameters: [
          queryParam('limit', { type: 'integer', minimum: 1, maximum: 50, default: 30 }, 'Run limit.'),
          queryParam('offset', { type: 'integer', minimum: 0, default: 0 }, 'Run offset.'),
        ],
        responses: jsonResponse,
      },
    };

    paths[`${prefix}/materials/governance/runs/{runId}/rollback`] = {
      post: {
        tags: ['Materials'],
        summary: 'Rollback a historical BOM material governance run',
        description: 'Clears only links that still match the applied target. Any downstream conflict blocks the entire rollback. Requires materials.govern.',
        security: secured(true),
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: writeResponses,
      },
    };

    paths[`${prefix}/production/boms`] = {
      post: {
        tags: ['Production'],
        summary: 'Create a governed production BOM',
        description: 'Creates a production BOM with an explicit finished-product shelf-life policy. Requires production.write.',
        security: secured(true),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ProductionBomCreateRequest' },
            },
          },
        },
        responses: {
          ...writeResponses,
          '201': { description: 'The BOM was created and returned with its persisted shelf-life policy.' },
        },
      },
    };

    paths[`${prefix}/production/batches/{batchId}/trace`] = {
      get: {
        tags: ['Production'],
        summary: 'Read the direct batch genealogy and shipment evidence',
        description: 'Returns the selected batch, direct actual-consumption edges, direct downstream batches, shipments, orders and customers. The response declares scope=direct-one-hop and is not a recall-case workflow. Requires production.read.',
        security: secured(true),
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        responses: jsonResponse,
      },
    };

    paths[`${prefix}/production/work-orders/{id}/checks`] = {
      post: {
        tags: ['Production'],
        summary: 'Submit a structured production quality inspection',
        description: 'Captures actual values against the immutable BOM characteristic snapshot. The server derives pass/fail; the client cannot submit its own result. Requires production.quality.inspect.',
        security: secured(true),
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductionQualityInspectionRequest' } } } },
        responses: { ...writeResponses, '201': { description: 'Inspection submitted and held for independent review.' } },
      },
    };

    paths[`${prefix}/production/work-orders/{id}/checks/{checkId}/review`] = {
      post: {
        tags: ['Production'],
        summary: 'Independently release or reject a production inspection',
        description: 'Rejects self-review, stale revisions, and release of a failed inspection. Requires production.quality.release.',
        security: secured(true),
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'checkId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductionQualityReviewRequest' } } } },
        responses: writeResponses,
      },
    };

    paths[`${prefix}/shipping`] = {
      ...paths[`${prefix}/shipping`],
      post: {
        tags: ['Shipping'],
        summary: 'Create an identity-bound shipment',
        description: 'Binds the shipment to an exact customer, optional sales-order line, canonical material, and product batch. Identity substitution conflicts are rejected before persistence. Requires shipping.write.',
        security: secured(true),
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ShipmentCreateRequest' } } } },
        responses: { ...writeResponses, '201': { description: 'Shipment created with resolved identity.' }, '404': { description: 'The linked order item or product batch does not exist.' } },
      },
    };

    paths[`${prefix}/system/search/status`] = {
      get: {
        tags: ['System'],
        summary: 'External search index status',
        description: 'Returns the configured search driver plus last full-reindex status. Requires system.read.',
        security: secured(true),
        responses: jsonResponse,
      },
    };

    paths[`${prefix}/system/search/reindex`] = {
      post: {
        tags: ['System'],
        summary: 'Rebuild external search indexes',
        description: 'Rebuilds the customer and order Meilisearch indexes. Requires system.backup.manage.',
        security: secured(true),
        responses: {
          ...writeResponses,
          '503': { description: 'External search is not configured or unavailable.' },
        },
      },
    };

    paths[`${prefix}/ai/status`] = {
      get: {
        tags: ['AI'],
        summary: 'Read governed AI gateway status',
        description: 'Returns privacy mode and server-side provider readiness without exposing credentials or provider URLs. Requires ai.assistant.use.',
        security: secured(true),
        responses: jsonResponse,
      },
    };

    paths[`${prefix}/ai/assist`] = {
      post: {
        tags: ['AI'],
        summary: 'Request governed AI assistance',
        description: 'Accepts a bounded prompt and aggregate-only context. Provider endpoint, model selection, and credentials are server controlled. External dispatch fails closed unless a sanitized audit event is durably persisted first. Requires ai.assistant.use.',
        security: secured(true),
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AIAssistRequest' } } },
        },
        responses: {
          ...writeResponses,
          '200': {
            description: 'Governed assistant response.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AIAssistResponse' } } },
          },
        },
      },
    };

    paths[`${prefix}/warehouses/stock-balances/{id}`] = {
      patch: {
        tags: ['Warehouse'],
        summary: 'Adjust an inventory balance with optimistic concurrency',
        description: 'Sets an absolute stock quantity. requestId makes exact retries idempotent; expectedQuantity prevents stale clients from overwriting concurrent stock movements. Requires warehouse.write.',
        security: secured(true),
        parameters: [{
          name: 'id', in: 'path', required: true,
          schema: { type: 'integer', minimum: 1 },
        }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WarehouseStockAdjustmentRequest' } } },
        },
        responses: writeResponses,
      },
    };

    paths[`${prefix}/warehouses/stock-balances`] = {
      ...paths[`${prefix}/warehouses/stock-balances`],
      post: {
        tags: ['Warehouse'],
        summary: 'Post a governed manual stock inbound voucher',
        description: 'Posts inventory through the stock ledger. Supplying materialId locks product name, base unit, shelf-life policy, balance identity, and generated batch identity to active material master data. Requires warehouse.write.',
        security: secured(true),
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WarehouseStockCreateRequest' } } } },
        responses: { ...writeResponses, '201': { description: 'Stock inbound voucher posted.' } },
      },
    };

    paths[`${prefix}/warehouses/stock-balances/{id}/transfer`] = {
      post: {
        tags: ['Warehouse'],
        summary: 'Transfer stock between locations idempotently',
        description: 'Posts one outbound and one inbound ledger movement in one transaction. Reusing requestId with a different payload returns HTTP 409. Requires warehouse.write.',
        security: secured(true),
        parameters: [{
          name: 'id', in: 'path', required: true,
          schema: { type: 'integer', minimum: 1 },
        }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WarehouseStockTransferRequest' } } },
        },
        responses: {
          ...writeResponses,
          '201': { description: 'The transfer voucher and both balance movements were posted.' },
        },
      },
    };
  }

  paths['/internal/ready'] = {
    get: {
      tags: ['Runtime'],
      summary: 'Protected deep readiness probe',
      description: 'Returns dependency policy and degradable component details to an administrator or metrics collector only.',
      security: [{ bearerAuth: [] }, { metricsBearerAuth: [] }],
      responses: {
        '200': { description: 'Critical dependencies are ready and detailed operational status is returned.' },
        '401': { description: 'A valid administrator JWT or metrics collector token is required.' },
        '503': { description: 'A critical dependency is unavailable.' },
      },
    },
  };
  paths['/internal/health'] = {
    get: {
      tags: ['Runtime'],
      summary: 'Protected deep health report',
      description: 'Returns storage, cache, auth, telemetry, secret-source, and disk details to an administrator or metrics collector only.',
      security: [{ bearerAuth: [] }, { metricsBearerAuth: [] }],
      responses: {
        '200': { description: 'The application is healthy and detailed operational state is returned.' },
        '401': { description: 'A valid administrator JWT or metrics collector token is required.' },
        '503': { description: 'One or more runtime checks are degraded.' },
      },
    },
  };

  paths['/metrics'] = {
    get: {
      tags: ['Runtime'],
      summary: 'Prometheus metrics',
      security: [{ bearerAuth: [] }, { metricsBearerAuth: [] }],
      responses: {
        '200': { description: 'Prometheus text exposition format.' },
        '401': { description: 'A valid administrator JWT or metrics collector bearer token is required.' },
        '403': { description: 'The user does not have system.metrics.read permission.' },
      },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'AilaoDa ERP+CRM API',
      version: '1.0.0',
      description: 'Versioned API contract foundation for ERP, CRM, audit, finance, production, warehouse, procurement, shipping, and collection workflows.',
    },
    servers: [
      { url: '/api', description: 'Current compatibility API namespace.' },
      { url: '/api/v1', description: 'Stable v1 API namespace for production clients.' },
    ],
    tags: Array.from(new Set(['Runtime', ...API_ROUTE_MODULES.map(routeModule => routeModule.tag)]))
      .map(name => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        metricsBearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'Opaque collector token',
        },
      },
      schemas: openApiSchemas,
    },
  };
};

export const renderOpenApiDocsHtml = (specUrl: string) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AilaoDa ERP+CRM API Docs</title>
  </head>
  <body>
    <main>
      <h1>AilaoDa ERP+CRM API</h1>
      <p>OpenAPI 3.0 contract foundation for the compatibility namespace and the stable v1 namespace.</p>
      <p>Contract JSON: <a href="${specUrl}"><code>${specUrl}</code></a></p>
      <p>Use <code>/api/v1/*</code> for new production clients. Existing clients can continue using <code>/api/*</code> during the compatibility window.</p>
    </main>
  </body>
</html>`;
