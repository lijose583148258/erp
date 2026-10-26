import prisma from '../config/database';
import { recordSearchMetric } from '../middleware/metricsMiddleware';
import { createExternalSearchProviders, getSearchStatus, setExternalSearchReady, type SearchIndex } from './search.service';
import { logger } from '../utils/logger';

type CustomerSearchDocument = {
  id: number;
  name: string;
  nameZh: string | null;
  nameEn: string | null;
  nameVi: string | null;
  nameAliases: string | null;
  licenseNumber: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  addressesJson: string | null;
  contactsJson: string | null;
};

type OrderSearchDocument = {
  id: number;
  orderNo: string;
  customerName: string | null;
  customerNameZh: string | null;
  customerNameEn: string | null;
  customerNameVi: string | null;
};

type ReindexResult = {
  enabled: boolean;
  indexes: Record<SearchIndex, { documents: number }>;
  readiness: {
    providerCount: number;
    readyProviders: number;
  };
  completedAt: string;
};

type SearchInitializationState = {
  status: 'idle' | 'running' | 'ready' | 'failed';
  mode: 'ensure' | 'reindex' | null;
  startedAt: string | null;
  completedAt: string | null;
};

const DEFAULT_REINDEX_BATCH_SIZE = 500;

const runAcrossSearchProviders = async <T>(operation: (provider: ReturnType<typeof createExternalSearchProviders>[number]) => Promise<T>) => {
  const providers = createExternalSearchProviders();
  if (providers.length === 0) throw new Error('MEILISEARCH_NOT_CONFIGURED');
  const results = await Promise.allSettled(providers.map(operation));
  const fulfilled = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const configuredMinimum = Number(process.env.SEARCH_MIN_WRITE_SUCCESSES || 1);
  const minimumSuccesses = Math.min(
    providers.length,
    Math.max(1, Number.isFinite(configuredMinimum) ? Math.floor(configuredMinimum) : 1),
  );
  if (fulfilled.length < minimumSuccesses) {
    const reasons = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`MEILISEARCH_REPLICAS_INSUFFICIENT_${fulfilled.length}_OF_${minimumSuccesses}: ${reasons.join('; ')}`);
  }
  return fulfilled;
};
let activeReindex: Promise<ReindexResult> | null = null;
let activeInitialization: Promise<void> | null = null;
let lastReindex: ReindexResult | null = null;
let lastError: string | null = null;
let initialization: SearchInitializationState = {
  status: 'idle',
  mode: null,
  startedAt: null,
  completedAt: null,
};

const getBatchSize = () => {
  const value = Number(process.env.SEARCH_REINDEX_BATCH_SIZE || DEFAULT_REINDEX_BATCH_SIZE);
  return Math.max(50, Math.min(2_000, Number.isFinite(value) ? Math.floor(value) : DEFAULT_REINDEX_BATCH_SIZE));
};

const asCustomerDocument = (row: CustomerSearchDocument) => ({ ...row, id: Number(row.id) });

const asOrderDocument = (row: {
  id: number;
  orderNo: string;
  customer: { name: string; nameZh: string | null; nameEn: string | null; nameVi: string | null } | null;
}): OrderSearchDocument => ({
  id: Number(row.id),
  orderNo: row.orderNo,
  customerName: row.customer?.name || null,
  customerNameZh: row.customer?.nameZh || null,
  customerNameEn: row.customer?.nameEn || null,
  customerNameVi: row.customer?.nameVi || null,
});

const envFlag = (name: string, fallback: boolean) => {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value);
};

const searchableAttributes: Record<SearchIndex, string[]> = {
  customers: [
    'name',
    'nameZh',
    'nameEn',
    'nameVi',
    'nameAliases',
    'licenseNumber',
    'contactName',
    'contactPhone',
    'contactEmail',
    'address',
    'addressesJson',
    'contactsJson',
  ],
  orders: ['orderNo', 'customerName', 'customerNameZh', 'customerNameEn', 'customerNameVi'],
};

export class SearchIndexService {
  static getStatus() {
    const search = getSearchStatus();
    const enabled = search.externalConfigured && search.configuredDriver === 'meilisearch';
    return {
      ...search,
      ready: !enabled || initialization.status === 'ready',
      initialization: enabled ? initialization : {
        status: 'disabled',
        mode: null,
        startedAt: null,
        completedAt: null,
      },
      reindexRunning: Boolean(activeReindex),
      lastReindex,
      lastError,
    };
  }

  static initialize() {
    if (activeInitialization) return activeInitialization;
    if (createExternalSearchProviders().length === 0) {
      initialization = { status: 'ready', mode: 'ensure', startedAt: null, completedAt: new Date().toISOString() };
      return Promise.resolve();
    }

    const mode: SearchInitializationState['mode'] = envFlag('SEARCH_REINDEX_ON_STARTUP', true) ? 'reindex' : 'ensure';
    setExternalSearchReady(false);
    initialization = {
      status: 'running',
      mode,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    lastError = null;
    activeInitialization = (async () => {
      try {
        if (mode === 'reindex') {
          if (activeReindex) {
            await activeReindex;
          } else {
            activeReindex = this.runReindex();
            try {
              lastReindex = await activeReindex;
            } finally {
              activeReindex = null;
            }
          }
        } else {
          await this.ensureIndexesAndSettings();
          const expected = await this.readExpectedDocumentCounts();
          await this.waitForIndexReadiness(expected);
        }
        lastError = null;
        setExternalSearchReady(true);
        initialization = {
          ...initialization,
          status: 'ready',
          completedAt: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        setExternalSearchReady(false);
        initialization = {
          ...initialization,
          status: 'failed',
          completedAt: new Date().toISOString(),
        };
        throw error;
      } finally {
        activeInitialization = null;
      }
    })();
    return activeInitialization;
  }

  static async syncCustomer(customerId: number) {
    if (createExternalSearchProviders().length === 0) return false;

    const customer = await prisma.customer.findUnique({
      where: { id: Number(customerId) },
      select: {
        id: true,
        name: true,
        nameZh: true,
        nameEn: true,
        nameVi: true,
        nameAliases: true,
        licenseNumber: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        address: true,
        addressesJson: true,
        contactsJson: true,
      },
    });
    if (!customer) return false;
    await this.upsertAndWait('customers', [asCustomerDocument(customer)]);
    return true;
  }

  static async syncOrder(orderId: number) {
    if (createExternalSearchProviders().length === 0) return false;

    const order = await prisma.order.findUnique({
      where: { id: Number(orderId) },
      select: {
        id: true,
        orderNo: true,
        customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
      },
    });
    if (!order) return false;
    await this.upsertAndWait('orders', [asOrderDocument(order)]);
    return true;
  }

  static async syncOrdersForCustomer(customerId: number) {
    if (createExternalSearchProviders().length === 0) return 0;

    let lastId = 0;
    let total = 0;
    const batchSize = getBatchSize();
    for (;;) {
      const orders = await prisma.order.findMany({
        where: { customerId: Number(customerId), id: { gt: lastId } },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: {
          id: true,
          orderNo: true,
          customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
        },
      });
      if (orders.length === 0) break;
      await this.upsertAndWait('orders', orders.map(asOrderDocument));
      total += orders.length;
      lastId = orders[orders.length - 1].id;
    }
    return total;
  }

  static async reindexAll(): Promise<ReindexResult> {
    if (activeReindex) throw new Error('SEARCH_REINDEX_IN_PROGRESS');
    setExternalSearchReady(false);
    activeReindex = this.runReindex();
    try {
      const result = await activeReindex;
      lastReindex = result;
      lastError = null;
      setExternalSearchReady(true);
      initialization = {
        status: 'ready',
        mode: 'reindex',
        startedAt: initialization.startedAt || new Date().toISOString(),
        completedAt: result.completedAt,
      };
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      setExternalSearchReady(false);
      initialization = {
        status: 'failed',
        mode: 'reindex',
        startedAt: initialization.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      throw error;
    } finally {
      activeReindex = null;
    }
  }

  static scheduleCustomerSync(customerId: number) {
    void this.syncCustomer(customerId)
      .then(() => this.syncOrdersForCustomer(customerId))
      .catch(error => this.recordSyncFailure('customers', error));
  }

  static scheduleOrderSync(orderId: number) {
    void this.syncOrder(orderId).catch(error => this.recordSyncFailure('orders', error));
  }

  private static async runReindex(): Promise<ReindexResult> {
    if (createExternalSearchProviders().length === 0) {
      throw new Error('MEILISEARCH_NOT_CONFIGURED');
    }

    await this.ensureIndexesAndSettings();
    await this.clearIndexesForRebuild();

    const indexes: ReindexResult['indexes'] = {
      customers: { documents: await this.reindexCustomers() },
      orders: { documents: await this.reindexOrders() },
    };
    const expected = await this.readExpectedDocumentCounts();
    if (indexes.customers.documents !== expected.customers || indexes.orders.documents !== expected.orders) {
      throw new Error(`MEILISEARCH_REINDEX_SOURCE_CHANGED_customers_${indexes.customers.documents}_of_${expected.customers}_orders_${indexes.orders.documents}_of_${expected.orders}`);
    }
    const readiness = await this.waitForIndexReadiness(expected);
    recordSearchMetric('reindex', 'customers');
    recordSearchMetric('reindex', 'orders');
    return { enabled: true, indexes, readiness, completedAt: new Date().toISOString() };
  }

  private static async ensureIndexesAndSettings() {
    for (const index of Object.keys(searchableAttributes) as SearchIndex[]) {
      await runAcrossSearchProviders(async provider => {
        const createTaskUid = await provider.ensureIndex(index);
        if (createTaskUid !== null) {
          try {
            await provider.waitForTask(createTaskUid);
          } catch (error) {
            // Concurrent replicas can each enqueue a create task after seeing
            // a missing index. Meilisearch marks the losing task as failed,
            // even though the winning task created the exact index. Read it
            // back before treating that expected race as idempotent.
            if (!await provider.indexExists(index)) throw error;
            logger.info(`[SearchIndexService] ${index} was created by a concurrent replica`);
          }
        }
        const settingsTaskUid = await provider.updateSearchableAttributes(index, searchableAttributes[index]);
        if (settingsTaskUid !== null) await provider.waitForTask(settingsTaskUid);
      });
    }
  }

  private static async clearIndexesForRebuild() {
    for (const index of Object.keys(searchableAttributes) as SearchIndex[]) {
      await runAcrossSearchProviders(async provider => {
        const clearTaskUid = await provider.deleteAllDocuments(index);
        if (clearTaskUid !== null) await provider.waitForTask(clearTaskUid);
      });
    }
  }

  private static async readExpectedDocumentCounts(): Promise<Record<SearchIndex, number>> {
    const [customers, orders] = await Promise.all([
      prisma.customer.count(),
      prisma.order.count(),
    ]);
    return { customers, orders };
  }

  private static async waitForIndexReadiness(expected: Record<SearchIndex, number>) {
    const providers = createExternalSearchProviders();
    if (providers.length === 0) throw new Error('MEILISEARCH_NOT_CONFIGURED');
    const configuredMinimum = Number(process.env.SEARCH_MIN_READY_SUCCESSES || providers.length);
    const minimumReady = Math.min(
      providers.length,
      Math.max(1, Number.isFinite(configuredMinimum) ? Math.floor(configuredMinimum) : providers.length),
    );
    const configuredTimeoutMs = Number(process.env.SEARCH_STARTUP_TIMEOUT_MS || 120_000);
    const timeoutMs = Number.isFinite(configuredTimeoutMs) ? Math.max(1_000, configuredTimeoutMs) : 120_000;
    const deadline = Date.now() + timeoutMs;
    let lastReasons: string[] = [];

    while (Date.now() < deadline) {
      const results = await Promise.allSettled(providers.map(async (provider) => {
        const stats = await Promise.all((Object.keys(expected) as SearchIndex[]).map(async index => {
          const value = await provider.getIndexStats(index);
          const documents = Number(value.numberOfDocuments || 0);
          if (value.isIndexing || documents !== expected[index]) {
            throw new Error(`${index}:${documents}/${expected[index]}${value.isIndexing ? ':indexing' : ''}`);
          }
          return { index, documents };
        }));
        return stats;
      }));
      const readyProviders = results.filter(result => result.status === 'fulfilled').length;
      if (readyProviders >= minimumReady) {
        return { providerCount: providers.length, readyProviders };
      }
      lastReasons = results.flatMap(result => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : []);
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error(`MEILISEARCH_READINESS_TIMEOUT_${minimumReady}_OF_${providers.length}: ${lastReasons.join('; ')}`);
  }

  private static async reindexCustomers() {
    let lastId = 0;
    let total = 0;
    const batchSize = getBatchSize();
    for (;;) {
      const customers = await prisma.customer.findMany({
        where: { id: { gt: lastId } },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: {
          id: true,
          name: true,
          nameZh: true,
          nameEn: true,
          nameVi: true,
          nameAliases: true,
          licenseNumber: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          address: true,
          addressesJson: true,
          contactsJson: true,
        },
      });
      if (customers.length === 0) break;
      await this.upsertAndWait('customers', customers.map(asCustomerDocument));
      total += customers.length;
      lastId = customers[customers.length - 1].id;
    }
    return total;
  }

  private static async reindexOrders() {
    let lastId = 0;
    let total = 0;
    const batchSize = getBatchSize();
    for (;;) {
      const orders = await prisma.order.findMany({
        where: { id: { gt: lastId } },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: {
          id: true,
          orderNo: true,
          customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
        },
      });
      if (orders.length === 0) break;
      await this.upsertAndWait('orders', orders.map(asOrderDocument));
      total += orders.length;
      lastId = orders[orders.length - 1].id;
    }
    return total;
  }

  private static async upsertAndWait(index: SearchIndex, documents: Array<Record<string, unknown>>) {
    await runAcrossSearchProviders(async provider => {
      const taskUid = await provider.upsertDocuments(index, documents);
      if (taskUid !== null) await provider.waitForTask(taskUid);
    });
    recordSearchMetric('index', index);
  }

  private static recordSyncFailure(index: SearchIndex, error: unknown) {
    lastError = error instanceof Error ? error.message : String(error);
    recordSearchMetric('index_error', index);
    logger.warn(`[SearchIndexService] ${index} incremental sync failed; reindex is required for recovery`, error);
  }
}
