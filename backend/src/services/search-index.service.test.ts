const mockCustomerRows = [
  {
    id: 1,
    name: 'Acme',
    nameZh: null,
    nameEn: null,
    nameVi: null,
    nameAliases: null,
    licenseNumber: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    address: null,
    addressesJson: null,
    contactsJson: null,
  },
];
const mockOrderRows = [
  {
    id: 2,
    orderNo: 'SO-2',
    customer: { name: 'Acme', nameZh: null, nameEn: null, nameVi: null },
  },
];

const mockPrisma = {
  customer: {
    count: jest.fn(async () => mockCustomerRows.length),
    findMany: jest.fn()
      .mockResolvedValueOnce(mockCustomerRows)
      .mockResolvedValueOnce([]),
    findUnique: jest.fn(),
  },
  order: {
    count: jest.fn(async () => mockOrderRows.length),
    findMany: jest.fn()
      .mockResolvedValueOnce(mockOrderRows)
      .mockResolvedValueOnce([]),
    findUnique: jest.fn(),
  },
};

const mockProvider = {
  ensureIndex: jest.fn(async (index: 'customers' | 'orders') => index === 'customers' ? 99 : null),
  indexExists: jest.fn(async () => true),
  updateSearchableAttributes: jest.fn(async () => 10),
  deleteAllDocuments: jest.fn(async () => 12),
  upsertDocuments: jest.fn(async () => 11),
  waitForTask: jest.fn(async (taskUid: number) => {
    if (taskUid === 99) throw new Error('MEILISEARCH_TASK_FAILED: Index `ailaoda_customers` already exists.');
    return { status: 'succeeded', taskUid };
  }),
  getIndexStats: jest.fn(async (index: 'customers' | 'orders') => ({
    numberOfDocuments: index === 'customers' ? mockCustomerRows.length : mockOrderRows.length,
    isIndexing: false,
  })),
};

jest.mock('../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('./search.service', () => ({
  createExternalSearchProviders: jest.fn(() => [mockProvider]),
  setExternalSearchReady: jest.fn(),
  getSearchStatus: jest.fn(() => ({
    driver: 'meilisearch',
    configuredDriver: 'meilisearch',
    fallback: 'prisma',
    externalConfigured: true,
    endpointConfigured: true,
    endpointCount: 1,
    indexPrefix: 'ailaoda',
    meilisearchIndexes: ['ailaoda_customers', 'ailaoda_orders'],
  })),
}));
jest.mock('../middleware/metricsMiddleware', () => ({ recordSearchMetric: jest.fn() }));

import { SearchIndexService } from './search-index.service';

describe('SearchIndexService startup lifecycle', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      SEARCH_REINDEX_ON_STARTUP: 'true',
      SEARCH_MIN_READY_SUCCESSES: '1',
      SEARCH_STARTUP_TIMEOUT_MS: '2000',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('recovers an index-create race, rebuilds documents, and turns readiness green only after stats verification', async () => {
    expect(SearchIndexService.getStatus()).toMatchObject({ ready: false, initialization: { status: 'idle' } });

    await SearchIndexService.initialize();

    expect(mockProvider.ensureIndex).toHaveBeenCalledWith('customers');
    expect(mockProvider.ensureIndex).toHaveBeenCalledWith('orders');
    expect(mockProvider.indexExists).toHaveBeenCalledWith('customers');
    expect(mockProvider.updateSearchableAttributes).toHaveBeenCalledTimes(2);
    expect(mockProvider.deleteAllDocuments).toHaveBeenCalledTimes(2);
    expect(mockProvider.upsertDocuments).toHaveBeenCalledTimes(2);
    expect(mockProvider.getIndexStats).toHaveBeenCalledTimes(2);
    expect(SearchIndexService.getStatus()).toMatchObject({
      ready: true,
      initialization: { status: 'ready', mode: 'reindex' },
      lastReindex: {
        indexes: { customers: { documents: 1 }, orders: { documents: 1 } },
        readiness: { providerCount: 1, readyProviders: 1 },
      },
      lastError: null,
    });
  });
});
