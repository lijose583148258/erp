import type { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { recordSearchMetric } from '../middleware/metricsMiddleware';
import { cacheService } from './cache.service';

type SearchDriver = 'prisma' | 'meilisearch' | 'elasticsearch';
export type SearchIndex = 'customers' | 'orders';
export type MeilisearchTask = {
  taskUid?: number;
  uid?: number;
  status?: string;
  error?: { message?: string } | null;
};

const EXTERNAL_SEARCH_DRIVERS = new Set<SearchDriver>(['meilisearch', 'elasticsearch']);
const inFlightSearches = new Map<string, Promise<number[]>>();

const getConfiguredDriver = (): SearchDriver => {
  const driver = String(process.env.SEARCH_DRIVER || 'prisma').trim().toLowerCase();
  if (driver === 'meilisearch' || driver === 'elasticsearch') return driver;
  return 'prisma';
};

const getExternalEndpoint = () =>
  String(process.env.SEARCH_ENDPOINT || process.env.MEILISEARCH_URL || process.env.ELASTICSEARCH_URL || '').trim();

const getExternalEndpoints = () => Array.from(new Set([
  getExternalEndpoint(),
  ...String(process.env.SEARCH_ENDPOINTS || '').split(',').map(value => value.trim()),
].filter(Boolean)));

const getIndexPrefix = () => String(process.env.SEARCH_INDEX_PREFIX || 'ailaoda').trim() || 'ailaoda';

const getMeiliApiKey = () => String(process.env.MEILISEARCH_API_KEY || process.env.SEARCH_API_KEY || '').trim();

export const normalizeSearchTerm = (input: unknown) => {
  const maxLength = Math.max(16, Number(process.env.SEARCH_MAX_QUERY_LENGTH || 120));
  const value = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.slice(0, maxLength);
};

const contains = (term: string) => ({ contains: term });

const buildIdWhere = <T extends Prisma.CustomerWhereInput | Prisma.OrderWhereInput>(ids: number[]): T | undefined => {
  if (!ids.length) return { id: { in: [] } } as unknown as T;
  return { id: { in: ids } } as unknown as T;
};

export const buildCustomerSearchWhere = (input: unknown): Prisma.CustomerWhereInput | undefined => {
  const term = normalizeSearchTerm(input);
  if (!term) {
    recordSearchMetric('empty', 'customers');
    return undefined;
  }

  recordSearchMetric('fallback', 'customers');
  return {
    OR: [
      { name: contains(term) },
      { nameZh: contains(term) },
      { nameEn: contains(term) },
      { nameVi: contains(term) },
      { nameAliases: contains(term) },
      { licenseNumber: contains(term) },
      { contactName: contains(term) },
      { contactPhone: contains(term) },
      { contactEmail: contains(term) },
      { address: contains(term) },
      { addressesJson: contains(term) },
      { contactsJson: contains(term) },
    ],
  };
};

export const buildOrderSearchWhere = (input: unknown): Prisma.OrderWhereInput | undefined => {
  const term = normalizeSearchTerm(input);
  if (!term) {
    recordSearchMetric('empty', 'orders');
    return undefined;
  }

  recordSearchMetric('fallback', 'orders');
  return {
    OR: [
      { orderNo: contains(term) },
      { customer: { name: contains(term) } },
      { customer: { nameZh: contains(term) } },
      { customer: { nameEn: contains(term) } },
      { customer: { nameVi: contains(term) } },
    ],
  };
};

export const getMeiliIndexName = (index: SearchIndex) => `${getIndexPrefix()}_${index}`;

export class MeilisearchProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async searchIds(index: SearchIndex, term: string, limit = 200): Promise<number[]> {
    const url = new URL(`/indexes/${encodeURIComponent(getMeiliIndexName(index))}/search`, this.endpoint.replace(/\/$/, ''));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(Math.max(250, Number(process.env.SEARCH_REQUEST_TIMEOUT_MS || 1500))),
      body: JSON.stringify({
        q: term,
        limit,
        attributesToRetrieve: ['id'],
      }),
    });
    if (!response.ok) throw new Error(`MEILISEARCH_SEARCH_FAILED_${response.status}`);

    const payload = await response.json() as { hits?: Array<{ id?: number | string }> };
    return (payload.hits || [])
      .map(hit => Number(hit.id))
      .filter(id => Number.isSafeInteger(id) && id > 0);
  }

  async upsertDocuments(index: SearchIndex, documents: Array<Record<string, unknown>>) {
    if (documents.length === 0) return null;
    const response = await this.request(
      `/indexes/${encodeURIComponent(getMeiliIndexName(index))}/documents?primaryKey=id`,
      {
        method: 'POST',
        body: JSON.stringify(documents),
      },
    );
    return this.getTaskUid(response);
  }

  async updateSearchableAttributes(index: SearchIndex, searchableAttributes: string[]) {
    const response = await this.request(
      `/indexes/${encodeURIComponent(getMeiliIndexName(index))}/settings/searchable-attributes`,
      {
        method: 'PUT',
        body: JSON.stringify(searchableAttributes),
      },
    );
    return this.getTaskUid(response);
  }

  async waitForTask(taskUid: number, timeoutMs = Number(process.env.SEARCH_TASK_TIMEOUT_MS || 30_000)) {
    const deadline = Date.now() + Math.max(1_000, timeoutMs);
    while (Date.now() < deadline) {
      const task = await this.request(`/tasks/${taskUid}`) as MeilisearchTask;
      if (task.status === 'succeeded') return task;
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new Error(`MEILISEARCH_TASK_${String(task.status).toUpperCase()}: ${task.error?.message || taskUid}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`MEILISEARCH_TASK_TIMEOUT_${taskUid}`);
  }

  private async request(pathname: string, init: RequestInit = {}) {
    const url = new URL(pathname, this.endpoint.replace(/\/$/, ''));
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
    if (init.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(url, { ...init, headers });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 300) };
      }
    }
    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as { message?: unknown }).message || '')
        : '';
      throw new Error(`MEILISEARCH_REQUEST_FAILED_${response.status}${message ? `: ${message}` : ''}`);
    }
    return payload;
  }

  private getTaskUid(payload: unknown) {
    if (!payload || typeof payload !== 'object') return null;
    const task = payload as MeilisearchTask;
    const value = Number(task.taskUid ?? task.uid);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
}

export const createExternalSearchProvider = () => {
  const driver = getConfiguredDriver();
  const endpoint = getExternalEndpoint();
  if (driver === 'meilisearch' && endpoint) {
    return new MeilisearchProvider(endpoint, getMeiliApiKey());
  }
  return null;
};

export const createExternalSearchProviders = () => {
  const driver = getConfiguredDriver();
  if (driver !== 'meilisearch') return [];
  return getExternalEndpoints().map(endpoint => new MeilisearchProvider(endpoint, getMeiliApiKey()));
};

export const getMeilisearchProvider = () => createExternalSearchProvider();

const searchExternalIds = async (provider: MeilisearchProvider, index: SearchIndex, term: string) => {
  const digest = crypto.createHash('sha256').update(term.toLocaleLowerCase()).digest('hex').slice(0, 24);
  const key = `search-ids:${getMeiliIndexName(index)}:${digest}`;
  const existing = inFlightSearches.get(key);
  if (existing) return existing;

  const request = cacheService.getOrSetJson<number[]>(
    key,
    Math.max(1, Number(process.env.SEARCH_RESULT_CACHE_TTL_SECONDS || 5)),
    () => provider.searchIds(index, term),
  ).finally(() => {
    inFlightSearches.delete(key);
  });
  inFlightSearches.set(key, request);
  return request;
};

export const buildCustomerSearchWhereAsync = async (input: unknown): Promise<Prisma.CustomerWhereInput | undefined> => {
  const term = normalizeSearchTerm(input);
  if (!term) {
    recordSearchMetric('empty', 'customers');
    return undefined;
  }

  const providers = createExternalSearchProviders();
  for (const provider of providers) {
    try {
      const ids = await searchExternalIds(provider, 'customers', term);
      recordSearchMetric('external', 'customers');
      return buildIdWhere<Prisma.CustomerWhereInput>(ids);
    } catch {
      recordSearchMetric('invalid', 'customers');
    }
  }

  return buildCustomerSearchWhere(term);
};

export const buildOrderSearchWhereAsync = async (input: unknown): Promise<Prisma.OrderWhereInput | undefined> => {
  const term = normalizeSearchTerm(input);
  if (!term) {
    recordSearchMetric('empty', 'orders');
    return undefined;
  }

  const providers = createExternalSearchProviders();
  for (const provider of providers) {
    try {
      const ids = await searchExternalIds(provider, 'orders', term);
      recordSearchMetric('external', 'orders');
      return buildIdWhere<Prisma.OrderWhereInput>(ids);
    } catch {
      recordSearchMetric('invalid', 'orders');
    }
  }

  return buildOrderSearchWhere(term);
};

export const getSearchStatus = () => {
  const configuredDriver = getConfiguredDriver();
  const endpoint = getExternalEndpoint();
  const externalConfigured = EXTERNAL_SEARCH_DRIVERS.has(configuredDriver) && Boolean(endpoint);

  return {
    driver: externalConfigured ? configuredDriver : 'prisma',
    configuredDriver,
    fallback: 'prisma',
    externalConfigured,
    endpointConfigured: Boolean(endpoint),
    endpointCount: getExternalEndpoints().length,
    indexPrefix: getIndexPrefix(),
    meilisearchIndexes: ['customers', 'orders'].map(index => getMeiliIndexName(index as SearchIndex)),
  };
};
