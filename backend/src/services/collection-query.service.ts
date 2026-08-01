import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import {
  COLLECTION_DAY_MS,
  COLLECTION_DEFAULT_PAGE_SIZE,
  COLLECTION_MAX_PAGE_SIZE,
  buildOrderWhere,
  buildPaymentWhere,
  getCollectionActionPlan,
  getDunningLevel,
  getDueDate,
  getOutstandingAmount,
} from './collection/collection.helpers';
import {
  addMoney,
  compareMoney,
  maxMoney,
  prorateMoney,
  roundMoney,
  subtractMoney,
  type DecimalInput,
} from '../utils/money';

export interface CollectionLedgerRecord {
  id: number;
  amount: number;
  method: string;
  status: string;
  date: Date;
  note: string | null;
  payerName: string | null;
  isProxy: boolean;
  createdAt: Date;
  verifiedBy: number | null;
  orderId: number;
  orderNo: string;
  contractNo: string | null;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  riskLevel: string;
  finalAmount: number;
  paidAmount: number;
  receivableAdjustmentAmount: number;
  paymentStatus: string;
  milestoneId: number | null;
  milestoneTitle: string | null;
  milestonePercentage: number | null;
}

export interface CollectionOverdueRecord {
  level: number;
  label: string;
  nextAction: string;
  channel: string;
  holdRecommended: boolean;
  orderId: number;
  orderNo: string;
  dueDate: Date;
  daysOverdue: number;
  outstanding: number;
  finalAmount: number;
  paidAmount: number;
  receivableAdjustmentAmount: number;
  paymentStatus: string;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  contactName: string | null;
  contactPhone: string | null;
  ownerName: string;
  riskLevel: string;
  overdueAmount: number;
  collectionsStatus: string;
  dunningLevel: number;
  nextActionAt: Date | null;
  reminderCount: number;
  lastReminderAt: Date | null;
  contractNo: string | null;
  contractTitle: string | null;
}

export interface CollectionMilestoneRecord {
  id: number;
  title: string;
  percentage: number;
  targetAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: Date | null;
  status: string;
  notes: string | null;
  contractId: number;
  contractNo: string;
  contractTitle: string;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
}

export interface CollectionQueryResult<T> {
  data: T[];
  meta?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

type CollectionOverdueQueryOptions = {
  page?: number;
  pageSize?: number;
  search?: string;
};

const normalizeSearchText = (value: unknown) => String(value ?? '').trim().toLowerCase();

const getOverdueSearchHaystack = (order: {
  orderNo: string;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  contactName: string | null;
  contactPhone: string | null;
  ownerName: string;
  riskLevel: string;
  paymentStatus: string;
  contractNo: string | null;
  contractTitle: string | null;
}) => [
  order.orderNo,
  order.customerName,
  order.customerNameZh,
  order.customerNameEn,
  order.customerNameVi,
  order.customerDisplayName,
  order.contactName,
  order.contactPhone,
  order.ownerName,
  order.riskLevel,
  order.paymentStatus,
  order.contractNo,
  order.contractTitle,
].map(normalizeSearchText).join(' ');

export const calculateMilestoneAmounts = (input: {
  explicitAmount: DecimalInput;
  contractTotalAmount: DecimalInput;
  percentage: DecimalInput;
  verifiedPayments: Array<{ amount: DecimalInput }>;
}) => {
  const targetAmount = input.explicitAmount !== null && input.explicitAmount !== undefined
    ? roundMoney(input.explicitAmount)
    : prorateMoney(input.contractTotalAmount, input.percentage, 100);
  const paidAmount = addMoney(...input.verifiedPayments.map(payment => payment.amount));
  return {
    targetAmount,
    paidAmount,
    remainingAmount: maxMoney(0, subtractMoney(targetAmount, paidAmount)),
  };
};

export class CollectionQueryService {
  static async getLedger(req: AuthRequest, options: { page?: number; pageSize?: number; status?: string; method?: string; customerId?: number }) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? COLLECTION_DEFAULT_PAGE_SIZE;
    const limit = Math.min(pageSize || COLLECTION_DEFAULT_PAGE_SIZE, COLLECTION_MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;

    const where = buildPaymentWhere(req, {});
    if (options.status) where.status = String(options.status);
    if (options.method) where.method = String(options.method);
    if (options.customerId) {
      where.order = {
        ...(where.order || {}),
        customerId: options.customerId,
      };
    }

    const [records, total] = await Promise.all([
      prisma.paymentRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          date: true,
          note: true,
          payerName: true,
          isProxy: true,
          createdAt: true,
          verifiedBy: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              finalAmount: true,
              paidAmount: true,
              receivableAdjustmentAmount: true,
              paymentStatus: true,
              customer: {
                select: {
                  id: true,
                  name: true,
                  nameZh: true,
                  nameEn: true,
                  nameVi: true,
                  riskLevel: true,
                },
              },
              contract: {
                select: {
                  id: true,
                  contractNo: true,
                },
              },
            },
          },
          milestone: {
            select: {
              id: true,
              title: true,
              percentage: true,
            },
          },
        },
      }),
      prisma.paymentRecord.count({ where }),
    ]);

    return {
      data: records.map(record => ({
        id: record.id,
        amount: Number(record.amount),
        method: record.method,
        status: record.status,
        date: record.date,
        note: record.note,
        payerName: record.payerName,
        isProxy: record.isProxy,
        createdAt: record.createdAt,
        verifiedBy: record.verifiedBy,
        orderId: record.order.id,
        orderNo: record.order.orderNo,
        contractNo: record.order.contract?.contractNo || null,
        customerId: record.order.customer.id,
        customerName: record.order.customer.name,
        customerNameZh: record.order.customer.nameZh || null,
        customerNameEn: record.order.customer.nameEn || null,
        customerNameVi: record.order.customer.nameVi || null,
        customerDisplayName: record.order.customer.nameZh || record.order.customer.nameEn || record.order.customer.nameVi || record.order.customer.name || null,
        riskLevel: record.order.customer.riskLevel,
        finalAmount: Number(record.order.finalAmount),
        paidAmount: Number(record.order.paidAmount),
        receivableAdjustmentAmount: Number(record.order.receivableAdjustmentAmount),
        paymentStatus: record.order.paymentStatus,
        milestoneId: record.milestone?.id || null,
        milestoneTitle: record.milestone?.title || null,
        milestonePercentage: record.milestone?.percentage || null,
      })) as CollectionLedgerRecord[],
      meta: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getOverdueOrders(req: AuthRequest, options: CollectionOverdueQueryOptions = {}) {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? COLLECTION_DEFAULT_PAGE_SIZE;
    const limit = Math.min(pageSize || COLLECTION_DEFAULT_PAGE_SIZE, COLLECTION_MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;
    const searchTerms = normalizeSearchText(options.search).split(/\s+/).filter(Boolean);
    const now = new Date();

    const orders = await prisma.order.findMany({
      where: buildOrderWhere(req, {
        paymentStatus: { not: 'paid' },
      }),
      select: {
        id: true,
        orderNo: true,
        finalAmount: true,
        paidAmount: true,
        receivableAdjustmentAmount: true,
        paymentTerms: true,
        paymentStatus: true,
        createdAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              nameZh: true,
              nameEn: true,
              nameVi: true,
              contactName: true,
              contactPhone: true,
              riskLevel: true,
            overdueAmount: true,
            collectionsStatus: true,
            dunningLevel: true,
            nextActionAt: true,
            salesperson: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        contract: {
          select: {
            id: true,
            contractNo: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const overdueOrders = orders
      .map(order => {
        const dueDate = getDueDate(order.createdAt, order.paymentTerms);
        const outstanding = getOutstandingAmount(
          Number(order.finalAmount),
          Number(order.paidAmount),
          Number(order.receivableAdjustmentAmount),
        );
        const daysOverdue = Math.max(0, Math.ceil((now.getTime() - dueDate.getTime()) / COLLECTION_DAY_MS));
        const actionPlan = getCollectionActionPlan(daysOverdue);

        return {
          ...actionPlan,
          orderId: order.id,
          orderNo: order.orderNo,
          dueDate,
          finalAmount: Number(order.finalAmount),
          paidAmount: Number(order.paidAmount),
          receivableAdjustmentAmount: Number(order.receivableAdjustmentAmount),
          paymentStatus: order.paymentStatus,
          outstanding,
          daysOverdue,
          customerId: order.customer.id,
          customerName: order.customer.name,
          customerNameZh: order.customer.nameZh || null,
          customerNameEn: order.customer.nameEn || null,
          customerNameVi: order.customer.nameVi || null,
          customerDisplayName: order.customer.nameZh || order.customer.nameEn || order.customer.nameVi || order.customer.name || null,
          contactName: order.customer.contactName,
          contactPhone: order.customer.contactPhone,
          ownerName: order.customer.salesperson?.username || '未分配',
          riskLevel: order.customer.riskLevel || 'medium',
          overdueAmount: Number(order.customer.overdueAmount),
          collectionsStatus: order.customer.collectionsStatus,
          dunningLevel: Math.max(order.customer.dunningLevel, getDunningLevel(daysOverdue)),
          nextActionAt: order.customer.nextActionAt,
          contractNo: order.contract?.contractNo || null,
          contractTitle: order.contract?.title || null,
        };
      })
      .filter(order => compareMoney(order.outstanding, 0) > 0 && order.daysOverdue > 0)
      .filter(order => {
        if (searchTerms.length === 0) return true;
        const haystack = getOverdueSearchHaystack(order);
        return searchTerms.every(term => haystack.includes(term));
      })
      .sort((a, b) => {
        if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
        if (compareMoney(b.outstanding, a.outstanding) !== 0) {
          return compareMoney(b.outstanding, a.outstanding);
        }
        return b.orderId - a.orderId;
      });

    const total = overdueOrders.length;
    const pageRows = overdueOrders.slice(offset, offset + limit);
    const orderIds = pageRows.map(order => order.orderId);
    const reminderLogs = orderIds.length > 0
      ? await prisma.auditLog.findMany({
        where: {
          resource: 'order',
          action: 'COLLECTION_REMINDER',
          resourceId: { in: orderIds },
        },
        select: {
          resourceId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      : [];

    const reminderMap = reminderLogs.reduce<Record<number, { count: number; lastReminderAt: Date | null }>>((acc, log) => {
      if (!log.resourceId) return acc;
      if (!acc[log.resourceId]) {
        acc[log.resourceId] = {
          count: 0,
          lastReminderAt: log.createdAt,
        };
      }
      acc[log.resourceId].count += 1;
      return acc;
    }, {});

    return {
      data: pageRows.map(order => ({
        level: order.level,
        label: order.label,
        nextAction: order.nextAction,
        channel: order.channel,
        holdRecommended: order.holdRecommended,
        orderId: order.orderId,
        orderNo: order.orderNo,
        dueDate: order.dueDate,
        daysOverdue: order.daysOverdue,
        outstanding: order.outstanding,
        finalAmount: order.finalAmount,
        paidAmount: order.paidAmount,
        receivableAdjustmentAmount: order.receivableAdjustmentAmount,
        paymentStatus: order.paymentStatus,
        customerId: order.customerId,
        customerName: order.customerName,
        customerNameZh: order.customerNameZh,
        customerNameEn: order.customerNameEn,
        customerNameVi: order.customerNameVi,
        customerDisplayName: order.customerDisplayName,
        contactName: order.contactName,
        contactPhone: order.contactPhone,
        ownerName: order.ownerName,
        riskLevel: order.riskLevel,
        overdueAmount: order.overdueAmount,
        collectionsStatus: order.collectionsStatus,
        dunningLevel: order.dunningLevel,
        nextActionAt: order.nextActionAt,
        reminderCount: reminderMap[order.orderId]?.count || 0,
        lastReminderAt: reminderMap[order.orderId]?.lastReminderAt || null,
        contractNo: order.contractNo,
        contractTitle: order.contractTitle,
      })) as CollectionOverdueRecord[],
      meta: {
        page,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getMilestones(req: AuthRequest, options: { status?: string } = {}) {
    const where: Record<string, any> = {};
    if (options.status) {
      where.status = String(options.status);
    }

    if (req.user?.role === 'sales') {
      where.contract = {
        customer: {
          salespersonId: req.user.userId,
        },
      };
    }

    const milestones = await prisma.contractMilestone.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        percentage: true,
        amount: true,
        dueDate: true,
        status: true,
        notes: true,
        createdAt: true,
        contract: {
          select: {
            id: true,
            contractNo: true,
            totalAmount: true,
            title: true,
            customer: {
              select: {
                id: true,
                name: true,
                nameZh: true,
                nameEn: true,
                nameVi: true,
                salespersonId: true,
              },
            },
          },
        },
        paymentRecords: {
          where: { status: 'verified' },
          select: {
            amount: true,
          },
        },
      },
    });

    return milestones.map(milestone => {
      const { targetAmount, paidAmount, remainingAmount } = calculateMilestoneAmounts({
        explicitAmount: milestone.amount,
        contractTotalAmount: milestone.contract.totalAmount,
        percentage: milestone.percentage,
        verifiedPayments: milestone.paymentRecords,
      });

      return {
        id: milestone.id,
        title: milestone.title,
        percentage: Number(milestone.percentage),
        targetAmount,
        paidAmount,
        remainingAmount,
        dueDate: milestone.dueDate,
        status: milestone.status,
        notes: milestone.notes,
        contractId: milestone.contract.id,
        contractNo: milestone.contract.contractNo,
        contractTitle: milestone.contract.title,
        customerId: milestone.contract.customer.id,
        customerName: milestone.contract.customer.name,
        customerNameZh: milestone.contract.customer.nameZh || null,
        customerNameEn: milestone.contract.customer.nameEn || null,
        customerNameVi: milestone.contract.customer.nameVi || null,
        customerDisplayName: milestone.contract.customer.nameZh || milestone.contract.customer.nameEn || milestone.contract.customer.nameVi || milestone.contract.customer.name || null,
      } as CollectionMilestoneRecord;
    });
  }
}
