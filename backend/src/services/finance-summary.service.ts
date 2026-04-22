import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AdjustmentService } from './adjustment.service';
import { CollectionService } from './collection.service';
import {
  COLLECTION_DUE_SOON_DAYS,
  buildOrderWhere,
  buildPaymentWhere,
  buildPromiseWhere,
  getOutstandingAmount,
  getDueDate,
  getOverdueDays,
} from './collection/collection.helpers';

export interface FinanceMonthlyTrendRow {
  period: string;
  revenue: number;
  received: number;
  outstanding: number;
  overdue: number;
  orderCount: number;
}

export interface FinanceCustomerRow {
  customerId: number;
  customerName: string;
  customerNameZh: string | null;
  customerNameEn: string | null;
  customerNameVi: string | null;
  salespersonName: string | null;
  riskLevel: string | null;
  collectionsStatus: string;
  dunningLevel: number;
  revenue: number;
  received: number;
  receivable: number;
  overdue: number;
  paymentRate: number;
  creditHold: boolean;
  shipmentHold: boolean;
  nextActionAt: string | null;
}

export interface FinanceSummary {
  overview: {
    totalRevenue: number;
    totalReceived: number;
    totalReceivable: number;
    overdueAmount: number;
    dueSoonAmount: number;
    paymentRate: number;
    commissionPendingAmount: number;
    pendingVerificationCount: number;
    openPromiseCount: number;
    openPromiseAmount: number;
    openDisputeCount: number;
    creditHoldCustomerCount: number;
    shipmentHoldOrderCount: number;
    adjustmentNetAmount: number;
    adjustmentCount: number;
  };
  paymentStatusBreakdown: Record<string, { count: number; amount: number }>;
  agingBuckets: {
    current: number;
    '1_7': number;
    '8_15': number;
    '16_30': number;
    '31_60': number;
    '60_plus': number;
  };
  monthlyTrend: FinanceMonthlyTrendRow[];
  topCustomers: FinanceCustomerRow[];
  recentPayments: Array<{
    id: number;
    amount: number;
    baseAmount: number;
    currency: string;
    exchangeRate: number;
    method: string;
    status: string;
    createdAt: string;
    orderNo: string;
    customerName: string;
    customerNameZh: string | null;
    customerNameEn: string | null;
    customerNameVi: string | null;
    milestoneTitle: string | null;
  }>;
  recentAdjustments: Array<{
    id: number;
    adjustmentNo: string;
    domain: string;
    targetRef: string | null;
    customerName: string | null;
    customerNameZh: string | null;
    customerNameEn: string | null;
    customerNameVi: string | null;
    orderNo: string | null;
    batchNo: string | null;
    reason: string;
    quantityDelta: number | null;
    amountDelta: number | null;
    status: string;
    createdAt: string;
  }>;
  insights: string[];
}

const MONTHS_TO_SHOW = 6;
const monthKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;

const toNumber = (value: unknown): number => {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
};

const resolveBaseAmount = (input: {
  amount: unknown;
  baseAmount?: unknown;
  exchangeRate?: unknown;
}) => {
  const amount = toNumber(input.amount);
  const exchangeRate = toNumber(input.exchangeRate);
  const directBaseAmount = Number(input.baseAmount);
  const looksLikeLegacyZeroBase =
    directBaseAmount === 0 &&
    amount !== 0 &&
    exchangeRate > 0;

  if (Number.isFinite(directBaseAmount) && !looksLikeLegacyZeroBase) {
    return directBaseAmount;
  }

  if (exchangeRate > 0) {
    return amount * exchangeRate;
  }

  return amount;
};

const resolveOrderBaseAmount = (order: {
  finalAmount: unknown;
  baseAmount?: unknown;
  lockedExchangeRate?: unknown;
}) => resolveBaseAmount({
  amount: order.finalAmount,
  baseAmount: order.baseAmount,
  exchangeRate: order.lockedExchangeRate,
});

const resolvePortionBaseAmount = (input: {
  portionAmount: unknown;
  totalAmount: unknown;
  totalBaseAmount?: unknown;
  exchangeRate?: unknown;
}) => {
  const portionAmount = toNumber(input.portionAmount);
  const totalAmount = toNumber(input.totalAmount);
  const totalBaseAmount = Number(input.totalBaseAmount);

  if (Number.isFinite(totalBaseAmount) && totalAmount > 0) {
    return totalBaseAmount * (portionAmount / totalAmount);
  }

  return resolveBaseAmount({
    amount: portionAmount,
    exchangeRate: input.exchangeRate,
  });
};

const buildMonthSeries = (count = MONTHS_TO_SHOW) => {
  const months: string[] = [];
  const current = new Date();
  current.setDate(1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(current.getFullYear(), current.getMonth() - i, 1);
    months.push(monthKey(date));
  }
  return months;
};

export class FinanceSummaryService {
  static async getSummary(req: AuthRequest): Promise<FinanceSummary> {
    const now = new Date();
    const orderWhere = buildOrderWhere(req);

    const [orders, snapshot, financeAdjustmentSummary, recentAdjustments, recentPayments, paymentRecords] = await Promise.all([
      prisma.order.findMany({
        where: orderWhere,
        select: {
          id: true,
          orderNo: true,
          finalAmount: true,
          paidAmount: true,
          receivableAdjustmentAmount: true,
          baseAmount: true,
          lockedExchangeRate: true,
          paymentStatus: true,
          commissionAmount: true,
          commissionStatus: true,
          paymentTerms: true,
          createdAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              nameZh: true,
              nameEn: true,
              nameVi: true,
              riskLevel: true,
              collectionsStatus: true,
              dunningLevel: true,
              creditHold: true,
              shipmentHold: true,
              nextActionAt: true,
              salesperson: { select: { username: true } },
            },
          },
        },
      }),
      CollectionService.getReceivablesSnapshot(req),
      AdjustmentService.getSummary({ domain: 'finance' }),
      prisma.adjustmentRecord.findMany({
        where: { domain: 'finance' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          adjustmentNo: true,
          domain: true,
          targetRef: true,
          reason: true,
          quantityDelta: true,
          amountDelta: true,
          status: true,
          createdAt: true,
          order: {
            select: {
              orderNo: true,
              customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
            },
          },
          productBatch: {
            select: {
              batchNo: true,
              productName: true,
            },
          },
        },
      }),
      prisma.paymentRecord.findMany({
        where: buildPaymentWhere(req, { status: 'verified' }),
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          amount: true,
          baseAmount: true,
          currency: true,
          exchangeRate: true,
          method: true,
          status: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
            },
          },
          milestone: {
            select: { title: true },
          },
        },
      }),
      prisma.paymentRecord.findMany({
        where: buildPaymentWhere(req),
        select: {
          amount: true,
          baseAmount: true,
          exchangeRate: true,
          status: true,
          date: true,
          createdAt: true,
        },
      }),
    ]);

    const orderMetrics = orders.map(order => {
      const totalAmount = toNumber(order.finalAmount);
      const effectiveReceivableAmount = Math.max(
        0,
        totalAmount - toNumber(order.receivableAdjustmentAmount),
      );
      const totalBaseAmount = resolveOrderBaseAmount({
        finalAmount: order.finalAmount,
        baseAmount: order.baseAmount,
        lockedExchangeRate: order.lockedExchangeRate,
      });
      const effectiveReceivableBaseAmount = resolvePortionBaseAmount({
        portionAmount: effectiveReceivableAmount,
        totalAmount: order.finalAmount,
        totalBaseAmount: order.baseAmount,
        exchangeRate: order.lockedExchangeRate,
      });
      const receivedBaseAmount = resolvePortionBaseAmount({
        portionAmount: order.paidAmount,
        totalAmount: order.finalAmount,
        totalBaseAmount: order.baseAmount,
        exchangeRate: order.lockedExchangeRate,
      });
      const outstandingBaseAmount = getOutstandingAmount(effectiveReceivableBaseAmount, receivedBaseAmount);

      return {
        order,
        totalAmount,
        totalBaseAmount,
        effectiveReceivableAmount,
        effectiveReceivableBaseAmount,
        receivedBaseAmount,
        outstandingBaseAmount,
      };
    });

    const totalRevenue = orderMetrics.reduce((sum, metric) => sum + metric.totalBaseAmount, 0);
    const totalReceived = orderMetrics.reduce((sum, metric) => sum + metric.receivedBaseAmount, 0);
    const totalReceivable = orderMetrics.reduce((sum, metric) => sum + metric.outstandingBaseAmount, 0);
    const commissionPendingAmount = orders.reduce((sum, order) => {
      const pending = order.commissionStatus !== 'paid' && Number(order.commissionAmount || 0) > 0;
      return sum + (pending ? Number(order.commissionAmount || 0) : 0);
    }, 0);

    const paymentStatusBreakdown = orderMetrics.reduce<Record<string, { count: number; amount: number }>>((acc, metric) => {
      const key = metric.order.paymentStatus || 'unpaid';
      acc[key] = acc[key] || { count: 0, amount: 0 };
      acc[key].count += 1;
      acc[key].amount += metric.outstandingBaseAmount;
      return acc;
    }, {});

    const monthlyKeys = buildMonthSeries(MONTHS_TO_SHOW);
    const trendMap = monthlyKeys.reduce<Record<string, FinanceMonthlyTrendRow>>((acc, period) => {
      acc[period] = { period, revenue: 0, received: 0, outstanding: 0, overdue: 0, orderCount: 0 };
      return acc;
    }, {});

    orderMetrics.forEach(metric => {
      const period = monthKey(metric.order.createdAt);
      if (!trendMap[period]) return;
      const overdueDays = getOverdueDays(metric.order.createdAt, metric.order.paymentTerms, now);
      trendMap[period].revenue += metric.totalBaseAmount;
      trendMap[period].outstanding += metric.outstandingBaseAmount;
      trendMap[period].overdue += overdueDays > 0 ? metric.outstandingBaseAmount : 0;
      trendMap[period].orderCount += 1;
    });

    paymentRecords.forEach(record => {
      const dt = record.date || record.createdAt;
      const period = monthKey(new Date(dt));
      if (!trendMap[period]) return;
      if (record.status === 'verified') {
        trendMap[period].received += resolveBaseAmount({
          amount: record.amount,
          baseAmount: record.baseAmount,
          exchangeRate: record.exchangeRate,
        });
      }
    });

    const customerMap = new Map<number, FinanceCustomerRow>();
    orderMetrics.forEach(metric => {
      const order = metric.order;
      const outstanding = metric.outstandingBaseAmount;
      const overdueDays = getOverdueDays(order.createdAt, order.paymentTerms, now);
      const overdue = overdueDays > 0 ? outstanding : 0;
      const entry = customerMap.get(order.customer.id) || {
        customerId: order.customer.id,
        customerName: order.customer.nameZh || order.customer.nameEn || order.customer.nameVi || order.customer.name,
        customerNameZh: order.customer.nameZh || null,
        customerNameEn: order.customer.nameEn || null,
        customerNameVi: order.customer.nameVi || null,
        salespersonName: order.customer.salesperson?.username || null,
        riskLevel: order.customer.riskLevel || null,
        collectionsStatus: order.customer.collectionsStatus,
        dunningLevel: order.customer.dunningLevel,
        revenue: 0,
        received: 0,
        receivable: 0,
        overdue: 0,
        paymentRate: 0,
        creditHold: order.customer.creditHold,
        shipmentHold: order.customer.shipmentHold,
        nextActionAt: order.customer.nextActionAt ? order.customer.nextActionAt.toISOString() : null,
      };

      entry.revenue += metric.totalBaseAmount;
      entry.received += metric.receivedBaseAmount;
      entry.receivable += outstanding;
      entry.overdue += overdue;
      entry.creditHold = entry.creditHold || order.customer.creditHold;
      entry.shipmentHold = entry.shipmentHold || order.customer.shipmentHold;
      entry.paymentRate = entry.revenue > 0 ? entry.received / entry.revenue : 0;
      customerMap.set(order.customer.id, entry);
    });

    const topCustomers = Array.from(customerMap.values())
      .sort((a, b) => {
        if (b.overdue !== a.overdue) return b.overdue - a.overdue;
        if (b.receivable !== a.receivable) return b.receivable - a.receivable;
        return b.revenue - a.revenue;
      })
      .slice(0, 10);

    const insights = [
      snapshot.overdueAmount > 0
        ? `当前逾期金额 ${snapshot.overdueAmount.toLocaleString()}，需要优先推进高风险客户回款。`
        : '当前账龄没有明显逾期压力，可以继续保持正常催收节奏。',
      snapshot.pendingVerificationCount > 0
        ? `有 ${snapshot.pendingVerificationCount} 笔待核销收款，建议财务优先完成核销。`
        : '当前没有待核销收款。',
    ];

    if (snapshot.openPromiseCount > 0) {
      insights.push(`存在 ${snapshot.openPromiseCount} 笔承诺付款，合计 ${snapshot.openPromiseAmount.toLocaleString()}，请持续跟进兑现。`);
    }

    if (financeAdjustmentSummary.total > 0) {
      insights.push(`财务调账共 ${financeAdjustmentSummary.total} 笔，净额 ${Number(financeAdjustmentSummary.amountDelta || 0).toLocaleString()}。`);
    }

    const monthlyTrend = monthlyKeys.map(period => trendMap[period]);

    return {
      overview: {
        totalRevenue,
        totalReceived,
        totalReceivable,
        overdueAmount: orderMetrics.reduce((sum, metric) => {
          const overdueDays = getOverdueDays(metric.order.createdAt, metric.order.paymentTerms, now);
          return sum + (overdueDays > 0 ? metric.outstandingBaseAmount : 0);
        }, 0),
        dueSoonAmount: orderMetrics.reduce((sum, metric) => {
          const outstanding = metric.outstandingBaseAmount;
          if (outstanding <= 0 || metric.order.paymentStatus === 'paid') {
            return sum;
          }
          const dueDate = getDueDate(metric.order.createdAt, metric.order.paymentTerms);
          const dueSoonLimit = new Date(now.getTime() + COLLECTION_DUE_SOON_DAYS * 24 * 60 * 60 * 1000);
          return dueDate.getTime() <= dueSoonLimit.getTime() ? sum + outstanding : sum;
        }, 0),
        paymentRate: totalRevenue > 0 ? totalReceived / totalRevenue : 0,
        commissionPendingAmount,
        pendingVerificationCount: snapshot.pendingVerificationCount,
        openPromiseCount: snapshot.openPromiseCount,
        openPromiseAmount: snapshot.openPromiseAmount,
        openDisputeCount: snapshot.openDisputeCount,
        creditHoldCustomerCount: snapshot.creditHoldCustomerCount,
        shipmentHoldOrderCount: snapshot.shipmentHoldOrderCount,
        adjustmentNetAmount: Number(financeAdjustmentSummary.amountDelta || 0),
        adjustmentCount: financeAdjustmentSummary.total,
      },
      paymentStatusBreakdown,
      agingBuckets: orderMetrics.reduce(
        (acc, metric) => {
          const overdueDays = getOverdueDays(metric.order.createdAt, metric.order.paymentTerms, now);
          if (overdueDays <= 0) {
            acc.current += metric.outstandingBaseAmount;
            return acc;
          }
          if (overdueDays <= 7) {
            acc['1_7'] += metric.outstandingBaseAmount;
            return acc;
          }
          if (overdueDays <= 15) {
            acc['8_15'] += metric.outstandingBaseAmount;
            return acc;
          }
          if (overdueDays <= 30) {
            acc['16_30'] += metric.outstandingBaseAmount;
            return acc;
          }
          if (overdueDays <= 60) {
            acc['31_60'] += metric.outstandingBaseAmount;
            return acc;
          }
          acc['60_plus'] += metric.outstandingBaseAmount;
          return acc;
        },
        { current: 0, '1_7': 0, '8_15': 0, '16_30': 0, '31_60': 0, '60_plus': 0 },
      ),
      monthlyTrend,
      topCustomers,
      recentPayments: recentPayments.map(record => ({
        id: record.id,
        amount: Number(record.amount),
        baseAmount: resolveBaseAmount({
          amount: record.amount,
          baseAmount: record.baseAmount,
          exchangeRate: record.exchangeRate,
        }),
        currency: record.currency,
        exchangeRate: Number(record.exchangeRate || 0),
        method: record.method,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
        orderNo: record.order.orderNo,
        customerName: record.order.customer.nameZh || record.order.customer.nameEn || record.order.customer.nameVi || record.order.customer.name,
        customerNameZh: record.order.customer.nameZh || null,
        customerNameEn: record.order.customer.nameEn || null,
        customerNameVi: record.order.customer.nameVi || null,
        milestoneTitle: record.milestone?.title || null,
      })),
      recentAdjustments: recentAdjustments.map(record => ({
        id: record.id,
        adjustmentNo: record.adjustmentNo,
        domain: record.domain,
        targetRef: record.targetRef || record.order?.orderNo || record.productBatch?.batchNo || null,
        customerName: record.order?.customer?.nameZh || record.order?.customer?.nameEn || record.order?.customer?.nameVi || record.order?.customer?.name || null,
        customerNameZh: record.order?.customer?.nameZh || null,
        customerNameEn: record.order?.customer?.nameEn || null,
        customerNameVi: record.order?.customer?.nameVi || null,
        orderNo: record.order?.orderNo || null,
        batchNo: record.productBatch?.batchNo || null,
        reason: record.reason,
        quantityDelta: record.quantityDelta,
        amountDelta: record.amountDelta,
        status: record.status,
        createdAt: record.createdAt.toISOString(),
      })),
      insights,
    };
  }
}
