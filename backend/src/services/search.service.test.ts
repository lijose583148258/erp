import {
  buildCustomerSearchWhere,
  buildCustomerSearchWhereAsync,
  buildOrderSearchWhere,
  buildOrderSearchWhereAsync,
  getSearchStatus,
  MeilisearchProvider,
  normalizeSearchTerm,
} from './search.service';
import { renderPrometheusMetrics } from '../middleware/metricsMiddleware';

describe('search service boundary', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SEARCH_DRIVER;
    delete process.env.SEARCH_ENDPOINT;
    delete process.env.SEARCH_ENDPOINTS;
    delete process.env.MEILISEARCH_URL;
    delete process.env.ELASTICSEARCH_URL;
    delete process.env.SEARCH_INDEX_PREFIX;
    delete process.env.SEARCH_MAX_QUERY_LENGTH;
    delete process.env.MEILISEARCH_API_KEY;
    delete process.env.SEARCH_API_KEY;
    delete process.env.SEARCH_REQUEST_TIMEOUT_MS;
    delete process.env.SEARCH_RESULT_CACHE_TTL_SECONDS;
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('normalizes and caps search terms before building Prisma fallback clauses', () => {
    process.env.SEARCH_MAX_QUERY_LENGTH = '16';

    expect(normalizeSearchTerm('  Acme   Trading  ')).toBe('Acme Trading');
    expect(normalizeSearchTerm('')).toBeNull();
    expect(normalizeSearchTerm('x'.repeat(40))).toBe('x'.repeat(16));

    const customerWhere = buildCustomerSearchWhere('Acme') as { OR: unknown[] };
    const orderWhere = buildOrderSearchWhere('ORD-2026') as { OR: unknown[] };

    expect(customerWhere.OR).toHaveLength(12);
    expect(customerWhere.OR).toContainEqual({ name: { contains: 'Acme' } });
    expect(customerWhere.OR).toContainEqual({ contactsJson: { contains: 'Acme' } });
    expect(orderWhere.OR).toHaveLength(5);
    expect(orderWhere.OR).toContainEqual({ orderNo: { contains: 'ORD-2026' } });
    expect(orderWhere.OR).toContainEqual({ customer: { nameZh: { contains: 'ORD-2026' } } });
  });

  it('exposes configured search status without pretending external search is active', () => {
    expect(getSearchStatus()).toMatchObject({
      driver: 'prisma',
      configuredDriver: 'prisma',
      fallback: 'prisma',
      externalConfigured: false,
      endpointConfigured: false,
      indexPrefix: 'ailaoda',
    });

    process.env.SEARCH_DRIVER = 'meilisearch';
    expect(getSearchStatus()).toMatchObject({
      driver: 'prisma',
      configuredDriver: 'meilisearch',
      externalConfigured: false,
    });

    process.env.SEARCH_ENDPOINT = 'http://search:7700';
    process.env.SEARCH_INDEX_PREFIX = 'erp-prod';
    expect(getSearchStatus()).toMatchObject({
      driver: 'meilisearch',
      configuredDriver: 'meilisearch',
      externalConfigured: true,
      endpointConfigured: true,
      indexPrefix: 'erp-prod',
    });
  });

  it('records fallback search metrics by bounded index labels', () => {
    buildCustomerSearchWhere('metric-customer');
    buildOrderSearchWhere('metric-order');

    const metrics = renderPrometheusMetrics();
    expect(metrics).toContain('ailaoda_search_operations_total{action="fallback",index="customers"}');
    expect(metrics).toContain('ailaoda_search_operations_total{action="fallback",index="orders"}');
  });

  it('queries Meilisearch indexes and returns bounded id filters', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      const [url, init] = args;
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ hits: [{ id: 10 }, { id: '11' }, { id: 'bad' }] }), { status: 200 });
    }) as typeof fetch;

    process.env.SEARCH_DRIVER = 'meilisearch';
    process.env.SEARCH_ENDPOINT = 'http://search:7700';
    process.env.SEARCH_INDEX_PREFIX = 'erp';
    process.env.MEILISEARCH_API_KEY = 'master-key';

    await expect(buildCustomerSearchWhereAsync('Acme')).resolves.toEqual({ id: { in: [10, 11] } });
    await expect(buildOrderSearchWhereAsync('ORD')).resolves.toEqual({ id: { in: [10, 11] } });

    expect(calls[0].url).toBe('http://search:7700/indexes/erp_customers/search');
    expect(calls[1].url).toBe('http://search:7700/indexes/erp_orders/search');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer master-key');
    expect(calls[0].init?.body).toContain('"attributesToRetrieve":["id"]');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('coalesces concurrent identical external searches', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ hits: [{ id: 19 }] }), { status: 200 });
    }) as typeof fetch;
    process.env.SEARCH_DRIVER = 'meilisearch';
    process.env.SEARCH_ENDPOINT = 'http://search:7700';

    await expect(Promise.all([
      buildCustomerSearchWhereAsync('coalesced-query'),
      buildCustomerSearchWhereAsync('coalesced-query'),
    ])).resolves.toEqual([{ id: { in: [19] } }, { id: { in: [19] } }]);
    expect(calls).toBe(1);
  });

  it('falls back to Prisma clauses when external search fails', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 503 })) as typeof fetch;
    process.env.SEARCH_DRIVER = 'meilisearch';
    process.env.SEARCH_ENDPOINT = 'http://search:7700';

    const where = await buildCustomerSearchWhereAsync('Fallback Co') as { OR: unknown[] };

    expect(where.OR).toContainEqual({ name: { contains: 'Fallback Co' } });
    expect(renderPrometheusMetrics()).toContain('ailaoda_search_operations_total{action="invalid",index="customers"}');
  });

  it('fails over to a secondary Meilisearch endpoint before Prisma fallback', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      calls.push(String(args[0]));
      if (String(args[0]).startsWith('http://primary:7700')) throw new Error('primary unavailable');
      return new Response(JSON.stringify({ hits: [{ id: 88 }] }), { status: 200 });
    }) as typeof fetch;
    process.env.SEARCH_DRIVER = 'meilisearch';
    process.env.SEARCH_ENDPOINT = 'http://primary:7700';
    process.env.SEARCH_ENDPOINTS = 'http://secondary:7700';

    await expect(buildOrderSearchWhereAsync('failover-query')).resolves.toEqual({ id: { in: [88] } });
    expect(calls).toHaveLength(2);
    expect(calls[1].startsWith('http://secondary:7700')).toBe(true);
  });

  it('keeps empty external search results as empty id filters instead of widening access', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 })) as typeof fetch;
    process.env.SEARCH_DRIVER = 'meilisearch';
    process.env.SEARCH_ENDPOINT = 'http://search:7700';

    await expect(buildOrderSearchWhereAsync('not-found')).resolves.toEqual({ id: { in: [] } });
  });

  it('exposes the low-level Meilisearch provider for index boundary tests', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ hits: [{ id: 7 }] }), { status: 200 })) as typeof fetch;
    process.env.SEARCH_INDEX_PREFIX = 'ailaoda';
    const provider = new MeilisearchProvider('http://search:7700/', '');

    await expect(provider.searchIds('customers', 'demo', 5)).resolves.toEqual([7]);
  });

  it('writes documents and waits for Meilisearch tasks before reporting sync success', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      const [url, init] = args;
      calls.push({ url: String(url), init });
      if (String(url).includes('/tasks/42')) {
        return new Response(JSON.stringify({ status: 'succeeded', taskUid: 42 }), { status: 200 });
      }
      return new Response(JSON.stringify({ taskUid: 42 }), { status: 202 });
    }) as typeof fetch;

    process.env.SEARCH_INDEX_PREFIX = 'erp';
    const provider = new MeilisearchProvider('http://search:7700/', 'master-key');

    await expect(provider.upsertDocuments('customers', [{ id: 7, name: 'Acme' }])).resolves.toBe(42);
    await expect(provider.updateSearchableAttributes('customers', ['name'])).resolves.toBe(42);
    await expect(provider.waitForTask(42)).resolves.toMatchObject({ status: 'succeeded' });

    expect(calls[0].url).toBe('http://search:7700/indexes/erp_customers/documents?primaryKey=id');
    expect(calls[0].init?.body).toBe('[{"id":7,"name":"Acme"}]');
    expect(calls[1].url).toBe('http://search:7700/indexes/erp_customers/settings/searchable-attributes');
    expect(calls[2].url).toBe('http://search:7700/tasks/42');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer master-key');
  });
});
