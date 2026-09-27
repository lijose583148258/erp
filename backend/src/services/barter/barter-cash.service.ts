import prisma from '../../config/database';
import { compareMoney, roundMoney } from '../../utils/money';
import { withDbRetry } from '../../utils/dbRetry';
import type { TransactionClient } from '../stock-movement.service';

type CashSettlement = { id: number; cashDifference: number; currency: string; counterpartyName: string };
export async function createBarterCashObligation(tx: TransactionClient, settlement: CashSettlement, ownerId: number) {
  if (compareMoney(settlement.cashDifference, 0) >= 0) return;
  const currency = settlement.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('货抵差额币种无效，请核对原单。');
  return tx.barterCashObligation.create({ data: {
    settlementId: settlement.id, amount: roundMoney(-settlement.cashDifference), currency,
    counterpartyName: settlement.counterpartyName, ownerId, status: 'open',
  } });
}

export async function voidBarterCashObligation(tx: TransactionClient, settlementId: number, userId: number, required = false) {
  const row = await tx.barterCashObligation.findUnique({ where: { settlementId } });
  if (!row) {
    if (required) throw new Error('缺少历史退款责任，请先核对，不能直接冲销。');
    return;
  }
  if (row.status !== 'open') throw new Error('退款责任已处理或需要历史核对，禁止直接冲销原批次。');
  const changed = await tx.barterCashObligation.updateMany({ where: { id: row.id, status: 'open' },
    data: { status: 'void', voidedBy: userId, voidedAt: new Date() } });
  if (changed.count !== 1) throw new Error('退款责任状态已变化，请刷新核对。');
}

export type RecordBarterRefund = {
  amount: number; currency: string; requestKey: string; paymentReference: string; paymentDate: string; note: string;
};

// Records an externally completed full refund. This does not execute a bank payment.
export async function recordBarterRefund(settlementId: number, userId: number, input: RecordBarterRefund) {
  return withDbRetry(() => prisma.$transaction(async tx => {
    // Same lock order as reversal: parent settlement first, then the obligation.
    const claim = await tx.barterSettlement.updateMany({ where: { id: settlementId, status: 'posted' },
      data: { status: 'posted' } });
    if (claim.count !== 1) throw new Error('仅已过账且未冲销的批次可以登记退款。');
    const row = await tx.barterCashObligation.findUnique({ where: { settlementId } });
    if (!row) throw new Error('未找到退款责任，请刷新核对。');
    if (row.currency !== input.currency || compareMoney(row.amount, input.amount) !== 0) {
      throw new Error('本入口只支持原币种全额退款，金额和币种必须与待退款责任一致。');
    }
    if (row.status === 'settled' && row.requestKey === input.requestKey) {
      if (row.paymentReference !== input.paymentReference || row.paymentDate !== input.paymentDate
        || row.resolutionNote !== input.note || row.resolvedBy !== userId) {
        throw new Error('同一请求键不能对应不同退款凭证或操作人。');
      }
      return row;
    }
    if (row.status !== 'open') throw new Error('退款责任已处理或需要历史核对，请勿重复登记。');
    const changed = await tx.barterCashObligation.updateMany({ where: { id: row.id, status: 'open' }, data: {
      status: 'settled', requestKey: input.requestKey, paymentReference: input.paymentReference,
      paymentDate: input.paymentDate, resolutionNote: input.note, resolvedBy: userId, resolvedAt: new Date(),
    } });
    if (changed.count !== 1) throw new Error('退款责任被其他操作更新，请刷新核对。');
    await tx.auditLog.create({ data: { userId, action: 'RECORD_BARTER_REFUND', resource: 'barter_cash_obligation', resourceId: row.id,
      details: JSON.stringify({ settlementId, amount: row.amount, currency: row.currency,
        paymentReference: input.paymentReference, paymentDate: input.paymentDate, requestKey: input.requestKey, note: input.note }) } });
    return tx.barterCashObligation.findUniqueOrThrow({ where: { id: row.id } });
  }), { label: 'recordBarterRefund' });
}
