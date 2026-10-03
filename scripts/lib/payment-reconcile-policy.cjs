const cents = value => Math.round(Number(value || 0) * 100);
const money = value => cents(value) / 100;
const marker = row => [row.customerName, row.customerNameZh, row.customerNameEn, row.paymentNoteMarkers, row.adjustmentReasonMarkers]
  .some(value => /CONC-ORDER-CUST|Concurrency Order Customer|duplicate-payment|concurrency-audit-|AUDIT-DIRTY-DATA-REPAIR/i.test(String(value || '')));

function classifyPaymentLedgerRows(rows, { epsilon = 0.005, sampleLimit = 20 } = {}) {
  const counters = { totalScanned: rows.length, cleanCurrentPolicy: 0, verifiedPaymentMismatch: 0,
    legacyFinanceAdjustmentApplied: 0, legacyFinanceAdjustmentIgnoredByCurrentPolicy: 0,
    verifiedPaymentsExceedEffectiveReceivable: 0, paidAmountWithoutEvidence: 0,
    quarantinedAuditEvidenceRisk: 0, negativeLegacyFinanceWouldBelowZero: 0, paymentStatusDrift: 0, unresolvedDataDrift: 0 };
  const samples = {}, add = (key, row) => { (samples[key] ||= []); if (samples[key].length < sampleLimit) samples[key].push(row); };
  for (const raw of rows) {
    const finalAmount = money(raw.finalAmount), paidAmount = money(raw.orderPaidAmount);
    const verifiedPaymentAmount = money(raw.verifiedPaymentAmount), financeAdjustmentAmount = money(raw.financeAdjustmentAmount);
    const receivableAdjustmentAmount = money(raw.receivableAdjustmentAmount);
    const effectiveReceivableAmount = Math.max(0, finalAmount - receivableAdjustmentAmount);
    const expectedPaidAmount = money(verifiedPaymentAmount + financeAdjustmentAmount);
    const currentPolicyDelta = money(paidAmount - expectedPaidAmount), legacyPolicyDelta = money(paidAmount - verifiedPaymentAmount);
    const expectedStatus = cents(paidAmount) >= cents(effectiveReceivableAmount) ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
    const matches = Math.abs(currentPolicyDelta) <= epsilon, cashOnlyMatches = Math.abs(legacyPolicyDelta) <= epsilon;
    const hasAdjustment = Math.abs(financeAdjustmentAmount) > epsilon;
    const over = expectedPaidAmount - effectiveReceivableAmount > epsilon;
    const row = { ...raw, finalAmount, orderPaidAmount: paidAmount, verifiedPaymentAmount, financeAdjustmentAmount,
      receivableAdjustmentAmount, effectiveReceivableAmount, expectedPaidAmount, currentPolicyDelta, legacyPolicyDelta, expectedStatus };
    if (matches) counters.cleanCurrentPolicy++;
    else { counters.verifiedPaymentMismatch++; add('verifiedPaymentMismatch', { ...row, explanation: 'Paid amount differs from verified payments plus the net applied finance ledger.' }); }
    // Historical report field names retained for consumers; "applied" is now
    // canonical, while "ignored" is an actionable loss of an applied effect.
    if (hasAdjustment && matches && !cashOnlyMatches) {
      counters.legacyFinanceAdjustmentApplied++;
      add('legacyFinanceAdjustmentApplied', { ...row, explanation: 'Applied finance contributions are correctly retained in the canonical paid amount.' });
    }
    if (hasAdjustment && cashOnlyMatches && !matches) {
      counters.legacyFinanceAdjustmentIgnoredByCurrentPolicy++;
      add('legacyFinanceAdjustmentIgnoredByCurrentPolicy', { ...row, explanation: 'Applied finance contributions were erased by a cash-only rebuild; review and correct with auditable evidence.' });
    }
    if (over) {
      counters.verifiedPaymentsExceedEffectiveReceivable++;
      const quarantineCandidate = marker(row); if (quarantineCandidate) counters.quarantinedAuditEvidenceRisk++;
      add('verifiedPaymentsExceedEffectiveReceivable', { ...row, quarantineCandidate, explanation: 'Canonical cash plus net applied finance contributions exceed effective receivable; do not cap or delete facts.' });
    }
    const noEvidence = !matches && Math.abs(verifiedPaymentAmount) <= epsilon && Math.abs(financeAdjustmentAmount) <= epsilon && paidAmount > epsilon;
    if (noEvidence) { counters.paidAmountWithoutEvidence++; add('paidAmountWithoutEvidence', row); }
    if (expectedPaidAmount < -epsilon) { counters.negativeLegacyFinanceWouldBelowZero++; add('negativeLegacyFinanceWouldBelowZero', row); }
    if (String(raw.paymentStatus || '') !== expectedStatus) { counters.paymentStatusDrift++; add('paymentStatusDrift', row); }
    if (!matches && !over && !noEvidence) { counters.unresolvedDataDrift++; add('unresolvedDataDrift', row); }
  }
  return { counters, samples };
}
module.exports = { classifyPaymentLedgerRows };
