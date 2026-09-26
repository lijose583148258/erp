import {
  determineReceivablePaymentStatus,
  getEffectiveReceivableAmount,
  getOutstandingAmount,
} from './collection.helpers';

describe('collection money calculations', () => {
  it('keeps receivable subtraction exact at currency precision', () => {
    expect(getEffectiveReceivableAmount(1000, 333.33)).toBe(666.67);
    expect(getOutstandingAmount(1000, 333.33, 666.67)).toBe(0);
  });

  it('determines payment status after half-up currency quantization', () => {
    expect(determineReceivablePaymentStatus(0, 0.004)).toBe('paid');
    expect(determineReceivablePaymentStatus(10.004, 10)).toBe('paid');
    expect(determineReceivablePaymentStatus(0.01, 10)).toBe('partial');
    expect(determineReceivablePaymentStatus(0, 10)).toBe('unpaid');
  });
});
