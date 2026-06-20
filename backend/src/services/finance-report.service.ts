import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { buildPaymentWhere } from './collection/collection.helpers';

export interface FinanceLedgerRow {
  entryNo: string;
  voucherType: string;
  sourceType: 'payment' | 'adjustment';
  sourceStatus: string;
  postingDate: string;
  customerName: string | null;
  customerNameZh: string | null;
  customerNameEn: string | null;
  customerNameVi: string | null;
  orderNo: string | null;
  batchNo: string | null;
  sourceRef: string | null;
  amount: number;
  impactAmount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export interface FinanceLedgerSummary {
  totalCount: number;
  postedCount: number;
  pendingCount: number;
  totalInflow: number;
  totalOutflow: number;
  netAmount: number;
  rows: FinanceLedgerRow[];
}

export interface FinanceCashflowRow {
  period: string;
  inflow: number;
  outflow: number;
  net: number;
  receiptCount: number;
  adjustmentCount: number;
  pendingReceiptAmount: number;
}

export interface FinanceCashflowSummary {
  totalInflow: number;
  totalOutflow: number;
  netCashflow: number;
  pendingReceiptAmount: number;
  rows: FinanceCashflowRow[];
}

const MONTHS_TO_SHOW = 6;

const monthKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;

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

const toIso = (value: Date | null | undefined) => (value ? value.toISOString() : new Date(0).toISOString());

const sortByPostingDate = (a: FinanceLedgerRow, b: FinanceLedgerRow) => {
  const left = new Date(a.postingDate).getTime();
  const right = new Date(b.postingDate).getTime();
  if (left !== right) return left - right;
  const leftCreated = new Date(a.createdAt).getTime();
  const rightCreated = new Date(b.createdAt).getTime();
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  return a.entryNo.localeCompare(b.entryNo);
};

export class FinanceReportService {
  static async getLedger(req: AuthRequest): Promise<FinanceLedgerSummary> {
    const [payments, adjustments] = await Promise.all([
      prisma.paymentRecord.findMany({
        where: buildPaymentWhere(req),
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          date: true,
          note: true,
          createdAt: true,
          order: {
            select: {
              orderNo: true,
              customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
            },
          },
          milestone: {
            select: { title: true },
          },
        },
      }),
      prisma.adjustmentRecord.findMany({
        where: { domain: 'finance' },
        orderBy: [{ appliedAt: 'asc' }, { approvedAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          adjustmentNo: true,
          amountDelta: true,
          status: true,
          targetRef: true,
          reason: true,
          note: true,
          createdAt: true,
          appliedAt: true,
          approvedAt: true,
          customerId: true,
          order: {
            select: {
              orderNo: true,
              customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
            },
          },
          productBatch: {
            select: {
              batchNo: true,
            },
          },
        },
      }),
    ]);

    const customerIds = Array.from(
      new Set(
        adjustments
          .map(item => item.customerId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );

    const customers = customerIds.length
      ? await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true },
      })
      : [];

    const customerMap = new Map(customers.map(customer => [customer.id, customer.nameZh || customer.nameEn || customer.nameVi || customer.name]));

    const paymentRows: FinanceLedgerRow[] = payments.map(record => {
      const amount = Number(record.amount || 0);
      const posted = record.status === 'verified';
      const postingDate = record.date || record.createdAt;

      return {
        entryNo: `RCPT-${String(record.id).padStart(6, '0')}`,
        voucherType: posted ? '收款凭证' : '待核销收款',
        sourceType: 'payment',
        sourceStatus: record.status,
        postingDate: toIso(postingDate),
        customerName: record.order.customer.nameZh || record.order.customer.nameEn || record.order.customer.nameVi || record.order.customer.name,
        customerNameZh: record.order.customer.nameZh || null,
        customerNameEn: record.order.customer.nameEn || null,
        customerNameVi: record.order.customer.nameVi || null,
        orderNo: record.order.orderNo,
        batchNo: null,
        sourceRef: record.milestone?.title || record.method,
        amount,
        impactAmount: posted ? amount : 0,
        balanceAfter: 0,
        note: record.note || null,
        createdAt: record.createdAt.toISOString(),
      };
    });

    const adjustmentRows: FinanceLedgerRow[] = adjustments.map(record => {
      const amount = Number(record.amountDelta || 0);
      const postingDate = record.appliedAt || record.approvedAt || record.createdAt;
      const effectiveCustomerName = record.order?.customer?.name || (record.customerId ? customerMap.get(record.customerId) || null : null);

      return {
        entryNo: record.adjustmentNo,
        voucherType: '财务调账',
        sourceType: 'adjustment',
        sourceStatus: record.status,
        postingDate: toIso(postingDate),
        customerName: effectiveCustomerName,
        customerNameZh: record.order?.customer?.nameZh || (record.customerId ? customers.find(customer => customer.id === record.customerId)?.nameZh || null : null),
        customerNameEn: record.order?.customer?.nameEn || (record.customerId ? customers.find(customer => customer.id === record.customerId)?.nameEn || null : null),
        customerNameVi: record.order?.customer?.nameVi || (record.customerId ? customers.find(customer => customer.id === record.customerId)?.nameVi || null : null),
        orderNo: record.order?.orderNo || null,
        batchNo: record.productBatch?.batchNo || null,
        sourceRef: record.targetRef || record.reason,
        amount: Math.abs(amount),
        impactAmount: record.status === 'pending' ? 0 : amount,
        balanceAfter: 0,
        note: record.note || null,
        createdAt: record.createdAt.toISOString(),
      };
    });

    const rows = [...paymentRows, ...adjustmentRows].sort(sortByPostingDate);

    let runningBalance = 0;
    const normalizedRows = rows.map(row => {
      runningBalance += row.impactAmount;
      return {
        ...row,
        balanceAfter: runningBalance,
      };
    });

    const summary = normalizedRows.reduce<FinanceLedgerSummary>((acc, row) => {
      const effective = row.impactAmount;
      if (effective > 0) {
        acc.totalInflow += effective;
      } else if (effective < 0) {
        acc.totalOutflow += Math.abs(effective);
      }

      if (row.sourceStatus === 'pending') {
        acc.pendingCount += 1;
      } else {
        acc.postedCount += 1;
      }

      acc.totalCount += 1;
      acc.netAmount += effective;
      acc.rows.push(row);
      return acc;
    }, {
      totalCount: 0,
      postedCount: 0,
      pendingCount: 0,
      totalInflow: 0,
      totalOutflow: 0,
      netAmount: 0,
      rows: [],
    });

    return summary;
  }

  static async getCashflow(req: AuthRequest): Promise<FinanceCashflowSummary> {
    const [payments, adjustments] = await Promise.all([
      prisma.paymentRecord.findMany({
        where: buildPaymentWhere(req),
        select: {
          amount: true,
          status: true,
          date: true,
          createdAt: true,
        },
      }),
      prisma.adjustmentRecord.findMany({
        where: { domain: 'finance' },
        select: {
          amountDelta: true,
          status: true,
          appliedAt: true,
          approvedAt: true,
          createdAt: true,
        },
      }),
    ]);

    const monthSeries = buildMonthSeries();
    const rows = monthSeries.reduce<Record<string, FinanceCashflowRow>>((acc, period) => {
      acc[period] = {
        period,
        inflow: 0,
        outflow: 0,
        net: 0,
        receiptCount: 0,
        adjustmentCount: 0,
        pendingReceiptAmount: 0,
      };
      return acc;
    }, {});

    let totalInflow = 0;
    let totalOutflow = 0;
    let pendingReceiptAmount = 0;

    payments.forEach(record => {
      const dt = record.date || record.createdAt;
      const period = monthKey(new Date(dt));
      const bucket = rows[period];
      if (!bucket) return;

      const amount = Number(record.amount || 0);
      if (record.status === 'verified') {
        bucket.inflow += amount;
        bucket.receiptCount += 1;
        totalInflow += amount;
      } else {
        bucket.pendingReceiptAmount += amount;
        pendingReceiptAmount += amount;
      }
    });

    adjustments.forEach(record => {
      const dt = record.appliedAt || record.approvedAt || record.createdAt;
      const period = monthKey(new Date(dt));
      const bucket = rows[period];
      if (!bucket) return;

      const amount = Number(record.amountDelta || 0);
      if (record.status === 'pending' || amount === 0) {
        return;
      }

      bucket.adjustmentCount += 1;
      if (amount > 0) {
        bucket.inflow += amount;
        totalInflow += amount;
      } else {
        const outflow = Math.abs(amount);
        bucket.outflow += outflow;
        totalOutflow += outflow;
      }
    });

    const rowsList = monthSeries.map(period => {
      const row = rows[period];
      row.net = row.inflow - row.outflow;
      return row;
    });

    return {
      totalInflow,
      totalOutflow,
      netCashflow: totalInflow - totalOutflow,
      pendingReceiptAmount,
      rows: rowsList,
    };
  }
}

