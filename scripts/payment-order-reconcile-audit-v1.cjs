const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';

const { PrismaClient } = require(path.join(process.cwd(), 'backend', 'node_modules', '@prisma', 'client'));

const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'payment-order-reconcile-audit-v1.json');
const STRICT = process.env.AILAODA_RECONCILE_STRICT === '1';
const EPSILON = Number(process.env.AILAODA_PAYMENT_RECONCILE_EPSILON || 0.01);
const SAMPLE_LIMIT = Number(process.env.AILAODA_RECONCILE_SAMPLE_LIMIT || 20);
const FULL_SCAN_LIMIT = Number(process.env.AILAODA_RECONCILE_FULL_SCAN_LIMIT || 100000);

const report = {
  name: 'payment-order-reconcile-audit-v1',
  databaseUrl: process.env.DATABASE_URL,
  strict: STRICT,
  startedAt: new Date().toISOString(),
  status: 'running',
  summary: {},
  samples: {},
  failure: null,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport() {
  ensureDir(OUTPUT_DIR);
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'bigint' ? Number(value) : value,
  ]));
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function nearlyEqual(a, b) {
  return Math.abs(toNumber(a) - toNumber(b)) <= EPSILON;
}

function determinePaymentStatus(paidAmount, finalAmount, receivableAdjustmentAmount) {
  const effectiveReceivableAmount = Math.max(0, toNumber(finalAmount) - toNumber(receivableAdjustmentAmount));
  if (Math.round(toNumber(paidAmount) * 100) >= Math.round(effectiveReceivableAmount * 100)) return 'paid';
  if (toNumber(paidAmount) > 0) return 'partial';
  return 'unpaid';
}

function addSample(samples, key, row) {
  if (!samples[key]) samples[key] = [];
  if (samples[key].length < SAMPLE_LIMIT) samples[key].push(row);
}

function hasAuditEvidenceMarker(row) {
  return [
    row.customerName,
    row.customerNameZh,
    row.customerNameEn,
    row.paymentNoteMarkers,
    row.adjustmentReasonMarkers,
  ].some(value => /CONC-ORDER-CUST|Concurrency Order Customer|duplicate-payment|concurrency-audit-|AUDIT-DIRTY-DATA-REPAIR/i.test(String(value || '')));
}

function classifyRows(rows) {
  const counters = {
    totalScanned: rows.length,
    cleanCurrentPolicy: 0,
    verifiedPaymentMismatch: 0,
    legacyFinanceAdjustmentApplied: 0,
    legacyFinanceAdjustmentIgnoredByCurrentPolicy: 0,
    verifiedPaymentsExceedEffectiveReceivable: 0,
    paidAmountWithoutEvidence: 0,
    quarantinedAuditEvidenceRisk: 0,
    negativeLegacyFinanceWouldBelowZero: 0,
    paymentStatusDrift: 0,
    unresolvedDataDrift: 0,
  };
  const samples = {};

  for (const raw of rows.map(normalizeRow)) {
    const finalAmount = toNumber(raw.finalAmount);
    const paidAmount = toNumber(raw.orderPaidAmount);
    const receivableAdjustmentAmount = toNumber(raw.receivableAdjustmentAmount);
    const verifiedPaymentAmount = toNumber(raw.verifiedPaymentAmount);
    const financeAdjustmentAmount = toNumber(raw.financeAdjustmentAmount);
    const effectiveReceivableAmount = Math.max(0, finalAmount - receivableAdjustmentAmount);
    const currentPolicyDelta = roundMoney(paidAmount - verifiedPaymentAmount);
    const legacyPolicyDelta = roundMoney(paidAmount - verifiedPaymentAmount - financeAdjustmentAmount);
    const expectedStatus = determinePaymentStatus(paidAmount, finalAmount, receivableAdjustmentAmount);
    const row = {
      ...raw,
      finalAmount,
      orderPaidAmount: paidAmount,
      receivableAdjustmentAmount,
      effectiveReceivableAmount,
      verifiedPaymentAmount,
      financeAdjustmentAmount,
      currentPolicyDelta,
      legacyPolicyDelta,
      expectedStatus,
      explanation: null,
    };

    const matchesCurrentPolicy = nearlyEqual(currentPolicyDelta, 0);
    const matchesLegacyPolicy = nearlyEqual(legacyPolicyDelta, 0);
    const hasFinanceAdjustment = Math.abs(financeAdjustmentAmount) > EPSILON;
    const statusDrift = String(raw.paymentStatus || '') !== expectedStatus;
    const verifiedExceedsEffective = verifiedPaymentAmount - effectiveReceivableAmount > EPSILON;

    if (matchesCurrentPolicy) counters.cleanCurrentPolicy += 1;

    if (!matchesCurrentPolicy) {
      counters.verifiedPaymentMismatch += 1;
      row.explanation = 'orders.paid_amount does not match verified payment_records under the current collection policy.';
      addSample(samples, 'verifiedPaymentMismatch', row);
    }

    if (hasFinanceAdjustment && matchesLegacyPolicy && !matchesCurrentPolicy) {
      counters.legacyFinanceAdjustmentApplied += 1;
      addSample(samples, 'legacyFinanceAdjustmentApplied', {
        ...row,
        explanation: 'paid_amount matches verified payments plus posted finance adjustment_records. This is legacy paid-amount adjustment behavior and can be overwritten by current recalculation.',
      });
    }

    if (hasFinanceAdjustment && matchesCurrentPolicy && !matchesLegacyPolicy) {
      counters.legacyFinanceAdjustmentIgnoredByCurrentPolicy += 1;
      addSample(samples, 'legacyFinanceAdjustmentIgnoredByCurrentPolicy', {
        ...row,
        explanation: 'paid_amount matches verified payments, while posted finance adjustment_records are not reflected in paid_amount. This is expected under the current collection recalculation policy, but the old finance adjustment record remains in history.',
      });
    }

    if (verifiedExceedsEffective) {
      counters.verifiedPaymentsExceedEffectiveReceivable += 1;
      const quarantineCandidate = hasAuditEvidenceMarker(row);
      if (quarantineCandidate) counters.quarantinedAuditEvidenceRisk += 1;
      addSample(samples, 'verifiedPaymentsExceedEffectiveReceivable', {
        ...row,
        quarantineCandidate,
        explanation: quarantineCandidate
          ? 'Verified payment_records exceed effective receivable, but the row carries audit/concurrency markers. Quarantine from long-soak business conclusions unless explicitly whitelisted.'
          : 'Verified payment_records exceed effective receivable. This is a true historical consistency risk and should not be hidden by capping paid_amount.',
      });
    }

    if (
      !matchesCurrentPolicy
      && !matchesLegacyPolicy
      && Math.abs(verifiedPaymentAmount) <= EPSILON
      && Math.abs(financeAdjustmentAmount) <= EPSILON
      && paidAmount > EPSILON
    ) {
      counters.paidAmountWithoutEvidence += 1;
      addSample(samples, 'paidAmountWithoutEvidence', {
        ...row,
        explanation: 'paid_amount exists but no verified payment_records or posted finance adjustments explain it.',
      });
    }

    if (hasFinanceAdjustment && verifiedPaymentAmount + financeAdjustmentAmount < -EPSILON) {
      counters.negativeLegacyFinanceWouldBelowZero += 1;
      addSample(samples, 'negativeLegacyFinanceWouldBelowZero', {
        ...row,
        explanation: 'Legacy verified payments plus finance adjustments would push paid_amount below zero. Current service rejects this, so this is likely legacy or test data.',
      });
    }

    if (statusDrift) {
      counters.paymentStatusDrift += 1;
      addSample(samples, 'paymentStatusDrift', {
        ...row,
        explanation: `payment_status is ${raw.paymentStatus || 'null'}, but paid/final/receivable-adjustment imply ${expectedStatus}.`,
      });
    }

    if (
      !matchesCurrentPolicy
      && !matchesLegacyPolicy
      && !verifiedExceedsEffective
      && !(Math.abs(verifiedPaymentAmount) <= EPSILON && Math.abs(financeAdjustmentAmount) <= EPSILON && paidAmount > EPSILON)
    ) {
      counters.unresolvedDataDrift += 1;
      addSample(samples, 'unresolvedDataDrift', {
        ...row,
        explanation: 'The row does not match either current verified-payment policy or legacy finance-adjusted policy.',
      });
    }
  }

  return { counters, samples };
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const [
      ordersForClassification,
      verifiedPaymentGroups,
      paymentCountGroups,
      financeAdjustmentGroups,
      financeReasonGroups,
      paymentMarkerRows,
      adjustmentMarkerRows,
    ] = await Promise.all([
      prisma.order.findMany({
        orderBy: { id: 'asc' },
        take: FULL_SCAN_LIMIT,
        select: {
          id: true,
          orderNo: true,
          finalAmount: true,
          paidAmount: true,
          receivableAdjustmentAmount: true,
          paymentStatus: true,
          customer: {
            select: {
              name: true,
              nameZh: true,
              nameEn: true,
            },
          },
        },
      }),
      prisma.paymentRecord.groupBy({
        by: ['orderId'],
        where: { status: 'verified' },
        _sum: { amount: true, baseAmount: true },
        _count: { id: true },
      }),
      prisma.paymentRecord.groupBy({
        by: ['orderId'],
        _count: { id: true },
      }),
      prisma.adjustmentRecord.groupBy({
        by: ['orderId'],
        where: {
          orderId: { not: null },
          domain: 'finance',
          status: 'posted',
          amountDelta: { not: null },
        },
        _sum: { amountDelta: true },
        _count: { id: true },
      }),
      prisma.adjustmentRecord.groupBy({
        by: ['orderId', 'reasonCategory'],
        where: {
          orderId: { not: null },
          domain: 'finance',
          status: 'posted',
          amountDelta: { not: null },
        },
        _sum: { amountDelta: true },
        _count: { id: true },
      }),
      prisma.paymentRecord.findMany({
        where: {
          note: {
            contains: 'duplicate-payment',
          },
        },
        select: {
          orderId: true,
          note: true,
        },
      }),
      prisma.adjustmentRecord.findMany({
        where: {
          orderId: { not: null },
          OR: [
            { reason: { contains: 'AUDIT-DIRTY-DATA-REPAIR' } },
            { note: { contains: 'AUDIT-DIRTY-DATA-REPAIR' } },
          ],
        },
        select: {
          orderId: true,
          reason: true,
          note: true,
        },
      }),
    ]);

    const verifiedByOrderId = new Map(verifiedPaymentGroups.map(group => [
      group.orderId,
      {
        amount: toNumber(group._sum.amount),
        baseAmount: toNumber(group._sum.baseAmount),
        count: Number(group._count.id || 0),
      },
    ]));
    const paymentCountByOrderId = new Map(paymentCountGroups.map(group => [
      group.orderId,
      Number(group._count.id || 0),
    ]));
    const financeByOrderId = new Map(financeAdjustmentGroups.map(group => [
      group.orderId,
      {
        amount: toNumber(group._sum.amountDelta),
        count: Number(group._count.id || 0),
      },
    ]));
    const negativeFinanceCountByOrderId = new Map();
    const financeReasonByOrderId = new Map();
    for (const group of financeReasonGroups) {
      const orderId = group.orderId;
      const reason = group.reasonCategory || 'uncategorized';
      const amount = toNumber(group._sum.amountDelta);
      const existingReasons = financeReasonByOrderId.get(orderId) || [];
      existingReasons.push(reason);
      financeReasonByOrderId.set(orderId, existingReasons);
      if (amount < -EPSILON) {
        negativeFinanceCountByOrderId.set(
          orderId,
          Number(negativeFinanceCountByOrderId.get(orderId) || 0) + Number(group._count.id || 0),
        );
      }
    }
    const paymentMarkersByOrderId = new Map();
    for (const row of paymentMarkerRows) {
      const existing = paymentMarkersByOrderId.get(row.orderId) || [];
      if (row.note) existing.push(row.note);
      paymentMarkersByOrderId.set(row.orderId, existing);
    }
    const adjustmentMarkersByOrderId = new Map();
    for (const row of adjustmentMarkerRows) {
      const orderId = row.orderId;
      const existing = adjustmentMarkersByOrderId.get(orderId) || [];
      if (row.reason) existing.push(row.reason);
      if (row.note) existing.push(row.note);
      adjustmentMarkersByOrderId.set(orderId, existing);
    }
    const classificationRows = ordersForClassification.map(order => {
      const verified = verifiedByOrderId.get(order.id) || { amount: 0, baseAmount: 0, count: 0 };
      const finance = financeByOrderId.get(order.id) || { amount: 0, count: 0 };
      return {
        id: order.id,
        orderNo: order.orderNo,
        customerName: order.customer?.name || null,
        customerNameZh: order.customer?.nameZh || null,
        customerNameEn: order.customer?.nameEn || null,
        finalAmount: Number(order.finalAmount),
        orderPaidAmount: Number(order.paidAmount),
        receivableAdjustmentAmount: Number(order.receivableAdjustmentAmount || 0),
        paymentStatus: order.paymentStatus,
        verifiedPaymentAmount: verified.amount,
        verifiedPaymentBaseAmount: verified.baseAmount,
        paymentRecordCount: Number(paymentCountByOrderId.get(order.id) || 0),
        verifiedPaymentCount: verified.count,
        financeAdjustmentAmount: finance.amount,
        postedFinanceAdjustmentCount: finance.count,
        postedNegativeFinanceAdjustmentCount: Number(negativeFinanceCountByOrderId.get(order.id) || 0),
        financeReasonCategories: [...new Set(financeReasonByOrderId.get(order.id) || [])].join(','),
        paymentNoteMarkers: [...new Set(paymentMarkersByOrderId.get(order.id) || [])].join(' | '),
        adjustmentReasonMarkers: [...new Set(adjustmentMarkersByOrderId.get(order.id) || [])].join(' | '),
      };
    });

    const classification = classifyRows(classificationRows);

    const mismatchRows = await prisma.$queryRawUnsafe(`
      SELECT
        o.id,
        o.order_no AS orderNo,
        o.final_amount AS finalAmount,
        o.paid_amount AS orderPaidAmount,
        o.payment_status AS paymentStatus,
        COALESCE(SUM(CASE WHEN p.status = 'verified' THEN p.amount ELSE 0 END), 0) AS verifiedPaymentAmount,
        COALESCE(SUM(CASE WHEN p.status = 'verified' THEN p.base_amount ELSE 0 END), 0) AS verifiedPaymentBaseAmount,
        COUNT(p.id) AS paymentRecordCount,
        SUM(CASE WHEN p.status = 'verified' THEN 1 ELSE 0 END) AS verifiedPaymentCount
      FROM orders o
      LEFT JOIN payment_records p ON p.order_id = o.id
      GROUP BY o.id
      HAVING ABS(COALESCE(o.paid_amount, 0) - COALESCE(SUM(CASE WHEN p.status = 'verified' THEN p.amount ELSE 0 END), 0)) > ${EPSILON}
      ORDER BY ABS(COALESCE(o.paid_amount, 0) - COALESCE(SUM(CASE WHEN p.status = 'verified' THEN p.amount ELSE 0 END), 0)) DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const countRows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) AS mismatchCount
      FROM (
        SELECT o.id
        FROM orders o
        LEFT JOIN payment_records p ON p.order_id = o.id
        GROUP BY o.id
        HAVING ABS(COALESCE(o.paid_amount, 0) - COALESCE(SUM(CASE WHEN p.status = 'verified' THEN p.amount ELSE 0 END), 0)) > ${EPSILON}
      ) mismatches;
    `);

    const adjustedMismatchRows = await prisma.$queryRawUnsafe(`
      WITH verified AS (
        SELECT order_id, SUM(amount) AS verified_amount
        FROM payment_records
        WHERE status = 'verified'
        GROUP BY order_id
      ),
      finance_adjustments AS (
        SELECT order_id, SUM(amount_delta) AS finance_adjustment_amount
        FROM adjustment_records
        WHERE order_id IS NOT NULL
          AND domain = 'finance'
          AND status = 'posted'
          AND amount_delta IS NOT NULL
        GROUP BY order_id
      )
      SELECT
        o.id,
        o.order_no AS orderNo,
        o.final_amount AS finalAmount,
        o.paid_amount AS orderPaidAmount,
        o.payment_status AS paymentStatus,
        COALESCE(v.verified_amount, 0) AS verifiedPaymentAmount,
        COALESCE(a.finance_adjustment_amount, 0) AS financeAdjustmentAmount,
        COALESCE(v.verified_amount, 0) + COALESCE(a.finance_adjustment_amount, 0) AS expectedPaidAmount,
        COALESCE(o.paid_amount, 0) - (COALESCE(v.verified_amount, 0) + COALESCE(a.finance_adjustment_amount, 0)) AS unexplainedDelta
      FROM orders o
      LEFT JOIN verified v ON v.order_id = o.id
      LEFT JOIN finance_adjustments a ON a.order_id = o.id
      WHERE ABS(COALESCE(o.paid_amount, 0) - (COALESCE(v.verified_amount, 0) + COALESCE(a.finance_adjustment_amount, 0))) > ${EPSILON}
      ORDER BY ABS(unexplainedDelta) DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const adjustedCountRows = await prisma.$queryRawUnsafe(`
      WITH verified AS (
        SELECT order_id, SUM(amount) AS verified_amount
        FROM payment_records
        WHERE status = 'verified'
        GROUP BY order_id
      ),
      finance_adjustments AS (
        SELECT order_id, SUM(amount_delta) AS finance_adjustment_amount
        FROM adjustment_records
        WHERE order_id IS NOT NULL
          AND domain = 'finance'
          AND status = 'posted'
          AND amount_delta IS NOT NULL
        GROUP BY order_id
      )
      SELECT COUNT(*) AS unexplainedMismatchCount
      FROM orders o
      LEFT JOIN verified v ON v.order_id = o.id
      LEFT JOIN finance_adjustments a ON a.order_id = o.id
      WHERE ABS(COALESCE(o.paid_amount, 0) - (COALESCE(v.verified_amount, 0) + COALESCE(a.finance_adjustment_amount, 0))) > ${EPSILON};
    `);

    const overpaidRows = await prisma.$queryRawUnsafe(`
      SELECT id, order_no AS orderNo, final_amount AS finalAmount, paid_amount AS paidAmount, payment_status AS paymentStatus
      FROM orders
      WHERE COALESCE(paid_amount, 0) - COALESCE(final_amount, 0) > ${EPSILON}
      ORDER BY COALESCE(paid_amount, 0) - COALESCE(final_amount, 0) DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const statusRows = await prisma.$queryRawUnsafe(`
      SELECT id, order_no AS orderNo, final_amount AS finalAmount, paid_amount AS paidAmount, payment_status AS paymentStatus
      FROM orders
      WHERE
        (payment_status = 'paid' AND COALESCE(paid_amount, 0) + ${EPSILON} < COALESCE(final_amount, 0))
        OR (payment_status = 'unpaid' AND COALESCE(paid_amount, 0) > ${EPSILON})
        OR (payment_status = 'partial' AND (COALESCE(paid_amount, 0) <= ${EPSILON} OR COALESCE(paid_amount, 0) + ${EPSILON} >= COALESCE(final_amount, 0)))
      ORDER BY updated_at DESC
      LIMIT ${SAMPLE_LIMIT};
    `);

    const mismatchCount = Number(normalizeRow(countRows[0] || {}).mismatchCount || 0);
    const unexplainedMismatchCount = Number(normalizeRow(adjustedCountRows[0] || {}).unexplainedMismatchCount || 0);
    const rawPotentialRiskCount = classification.counters.verifiedPaymentsExceedEffectiveReceivable
      + classification.counters.paidAmountWithoutEvidence
      + classification.counters.paymentStatusDrift
      + classification.counters.unresolvedDataDrift;
    const quarantinedAuditEvidenceRiskCount = classification.counters.quarantinedAuditEvidenceRisk;
    const actionableTrueRiskCount = Math.max(0, rawPotentialRiskCount - quarantinedAuditEvidenceRiskCount);
    report.summary = {
      verifiedOnlyMismatchCount: mismatchCount,
      legacyPolicyMismatchCount: unexplainedMismatchCount,
      classifiedCurrentPolicyMismatchCount: classification.counters.verifiedPaymentMismatch,
      legacyFinanceAdjustmentAppliedCount: classification.counters.legacyFinanceAdjustmentApplied,
      legacyFinanceAdjustmentIgnoredByCurrentPolicyCount: classification.counters.legacyFinanceAdjustmentIgnoredByCurrentPolicy,
      verifiedPaymentsExceedEffectiveReceivableCount: classification.counters.verifiedPaymentsExceedEffectiveReceivable,
      paidAmountWithoutEvidenceCount: classification.counters.paidAmountWithoutEvidence,
      quarantinedAuditEvidenceRiskCount,
      actionableTrueRiskCount,
      negativeLegacyFinanceWouldBelowZeroCount: classification.counters.negativeLegacyFinanceWouldBelowZero,
      overpaidCountInSample: overpaidRows.length,
      statusDriftCount: classification.counters.paymentStatusDrift,
      unresolvedDataDriftCount: classification.counters.unresolvedDataDrift,
      rawPotentialRiskCount,
      trueRiskCount: actionableTrueRiskCount,
      deprecatedTrueRiskCountBeforeQuarantine: rawPotentialRiskCount,
      epsilon: EPSILON,
      accountingPolicy: 'current policy: orders.paid_amount equals verified payment_records; receivable reductions use orders.receivable_adjustment_amount. Legacy finance adjustment_records may exist and are classified separately.',
      verdict: actionableTrueRiskCount > 0 || overpaidRows.length > 0
        ? 'classified_historical_risk_requires_review'
        : quarantinedAuditEvidenceRiskCount > 0
          ? 'passed_with_quarantined_audit_evidence'
        : 'clean',
    };
    report.samples = {
      verifiedOnlyDifferences: mismatchRows.map(normalizeRow),
      legacyPolicyDifferences: adjustedMismatchRows.map(normalizeRow),
      classifications: classification.samples,
      overpaidOrders: overpaidRows.map(normalizeRow),
      legacyStatusDriftQuery: statusRows.map(normalizeRow),
    };

    if (report.summary.verdict === 'clean' || report.summary.verdict === 'passed_with_quarantined_audit_evidence') {
      report.status = 'passed';
    } else {
      report.status = STRICT ? 'failed' : 'warning';
      if (STRICT) process.exitCode = 1;
    }
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      stack: error?.stack || null,
    };
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
    writeReport();
    console.log(JSON.stringify({
      status: report.status,
      strict: STRICT,
      reportPath: REPORT_PATH,
      summary: report.summary,
      failure: report.failure,
    }, null, 2));
  }
})();
