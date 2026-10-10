import type { PaymentRecord } from '../../types';

/** Unknown states never acquire the actionable pending state on read-back. */
export const mapPaymentRecordStatus = (value: unknown): PaymentRecord['status'] => {
  const status = typeof value === 'string' ? value.toLowerCase() : '';
  return status === 'pending' || status === 'verified' || status === 'reversed' ? status : 'unknown';
};
