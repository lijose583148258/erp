import { AppError, ErrorCode } from '../middleware/errorHandler';
import { controlledPurchaseReceiptSubmissionSchema, normalizeControlledPurchaseReceipt, readControlledPurchaseReceiptSubmission,
  type StoredControlledReceipt } from '../domain/purchase-controlled-receipt';
import type { TransactionClient } from './stock-movement.types';

export async function requireCommittedPurchaseReceipt(tx: TransactionClient, receipt: StoredControlledReceipt & Record<string, unknown>) {
  let raw: unknown;
  try { raw = JSON.parse(receipt.submissionJson || ''); } catch { raw = null; }
  const parsed = controlledPurchaseReceiptSubmissionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('PURCHASE_SOURCE_HISTORY_UNRECONCILED', 409, ErrorCode.CONFLICT);
  const audit = await tx.auditLog.findUnique({ where: { id: parsed.data.auditId } });
  return readControlledPurchaseReceiptSubmission(receipt, normalizeControlledPurchaseReceipt(receipt), audit);
}
