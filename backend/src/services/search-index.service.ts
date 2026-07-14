import prisma from '../config/database';
import { recordSearchMetric } from '../middleware/metricsMiddleware';
import { createExternalSearchProviders, getSearchStatus, type SearchIndex } from './search.service';
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
  completedAt: string;
};

const DEFAULT_REINDEX_BATCH_SIZE = 500;

const runAcrossSearchProviders = async <T>(operation: (provider: ReturnType<typeof createExternalSearchProviders>[number]) => Promise<T>) => {
  const providers = createExternalSearchProviders();
  if (providers.length === 0) throw new Error('MEILISEARCH_NOT_CONFIGURED');
  const results = await Promise.allSettled(providers.map(operation));
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<T> => result.status === 'fulfilled');
  const minimumSuccesses = Math.min(
    providers.length,
    Math.max(1, Number(process.env.SEARCH_MIN_WRITE_SUCCESSES || 1)),
  );
  if (fulfilled.length < minimumSuccesses) {
    const reasons = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`MEILISEARCH_REPLICAS_INSUFFICIENT_${fulfilled.length}_OF_${minimumSuccesses}: ${reasons.join('; ')}`);
  }
  return fulfilled.map(result => result.value);
};
let activeReindex: Promise<ReindexResult> | null = null;
let lastReindex: ReindexResult | null = null;
let lastError: string | null = null;

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
    return {
      ...getSearchStatus(),
      reindexRunning: Boolean(activeReindex),
      lastReindex,
      lastError,
    };
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
    activeReindex = this.runReindex();
    try {
      const result = await activeReindex;
      lastReindex = result;
      lastError = null;
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
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

    for (const index of Object.keys(searchableAttributes) as SearchIndex[]) {
      await runAcrossSearchProviders(async provider => {
        const taskUid = await provider.updateSearchableAttributes(index, searchableAttributes[index]);
        if (taskUid !== null) await provider.waitForTask(taskUid);
      });
    }

    const indexes: ReindexResult['indexes'] = {
      customers: { documents: await this.reindexCustomers() },
      orders: { documents: await this.reindexOrders() },
    };
    recordSearchMetric('reindex', 'customers');
    recordSearchMetric('reindex', 'orders');
    return { enabled: true, indexes, completedAt: new Date().toISOString() };
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
