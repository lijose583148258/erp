import prisma from '../config/database';
import { CollectionStateService } from './collection-state.service';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { getOutstandingAmount } from './collection/collection.helpers';
import type { Prisma } from '@prisma/client';
import type { TransactionClient } from './stock-movement.service';
import type {
  BarterAgreementListQuery,
  BarterCounterpartyType,
  BarterListQuery,
  BarterPreviewResult,
  BarterSettlementMode,
  CreateBarterAgreementInput,
  CreateBarterBatchInput,
  CreateBarterSettlementInput,
} from './barter/barter.types';
import { computeItemValue, previewBarterSettlement, roundMoney } from './barter/barter.calculations';
import { parseBarterMetadata } from './barter/barter.formatters';
import {
  assertBarterApprovalTransition,
  assertBarterPostingTransition,
  assertBarterReversalTransition,
} from './barter/barter.transitions';
import { postBarterStockEntries, postBarterStockReversalEntries } from './barter/barter.stock';
import { validateCounterpartyAndOrderLinks } from './barter/barter-counterparty.service';
import {
  createBarterAgreement,
  createBarterBatchForAgreement,
  getBarterAgreement,
  listBarterAgreements,
  syncBarterAgreementProgress,
} from './barter/barter-agreement.service';
import {
  getBarterSettlement,
  getBarterSummary,
  listBarterSettlements,
} from './barter/barter-query.service';

export type {
  BarterAgreementListQuery,
  BarterAgreementStatus,
  BarterCounterpartyType,
  BarterItemInput,
  BarterListQuery,
  BarterPreviewResult,
  BarterSettlementMode,
  BarterSettlementStatus,
  BarterSide,
  CreateBarterAgreementInput,
  CreateBarterBatchInput,
  CreateBarterSettlementInput,
} from './barter/barter.types';

export class BarterService {
  static preview(input: Pick<CreateBarterSettlementInput, 'items' | 'settlementMode'>): BarterPreviewResult {
    return previewBarterSettlement(input);
  }

  static async syncAgreementProgress(agreementId: number, client: TransactionClient = prisma) {
    return syncBarterAgreementProgress(agreementId, client);
  }

  static async getSummary(where: Prisma.BarterSettlementWhereInput = {}) {
    return getBarterSummary(where);
  }

  static async listAgreements(query: BarterAgreementListQuery) {
    return listBarterAgreements(query);
  }

  static async getAgreement(id: number) {
    return getBarterAgreement(id);
  }

  static async createAgreement(input: CreateBarterAgreementInput) {
    return createBarterAgreement(input);
  }

  static async createBatchForAgreement(agreementId: number, input: CreateBarterBatchInput) {
    return createBarterBatchForAgreement(agreementId, input);
  }

  static async listSettlements(query: BarterListQuery) {
    return listBarterSettlements(query);
  }

  static async getSettlement(id: number) {
    return getBarterSettlement(id);
  }

  static async createSettlement(input: CreateBarterSettlementInput) {
    const preview = this.preview({ items: input.items, settlementMode: input.settlementMode });
    const { customerId, supplierId } = await validateCounterpartyAndOrderLinks(input);

    if (input.agreementId) {
      const agreement = await prisma.barterAgreement.findUnique({
        where: { id: input.agreementId },
        select: {
          id: true,
          customerId: true,
          supplierId: true,
          counterpartyType: true,
          status: true,
        },
      });

      if (!agreement) {
        throw new Error('Barter agreement not found');
      }

      if (agreement.status === 'closed' || agreement.status === 'terminated') {
        throw new Error(`Barter agreement status ${agreement.status} cannot create new execution batches`);
      }

      if (customerId && agreement.customerId && customerId !== agreement.customerId) {
        throw new Error('Settlement customer does not match barter agreement customer');
      }

      if (supplierId && agreement.supplierId && supplierId !== agreement.supplierId) {
        throw new Error('Settlement supplier does not match barter agreement supplier');
      }
    }

    const settlement = await prisma.barterSettlement.create({
      data: {
        settlementNo: buildBusinessNo('BT'),
        agreementId: input.agreementId ?? null,
        batchIndex: input.batchIndex ?? null,
        counterpartyType: input.counterpartyType,
        counterpartyName: input.counterpartyName,
        customerId,
        supplierId,
        orderId: input.orderId ?? null,
        settlementMode: input.settlementMode || 'mixed',
        totalPartyAValue: preview.totalPartyAValue,
        totalPartyBValue: preview.totalPartyBValue,
        cashDifference: preview.cashDifference,
        currency: input.currency || 'CNY',
        valuationDate: input.valuationDate || new Date(),
        note: input.note || null,
        createdBy: input.createdBy,
        status: 'quoted',
        items: {
          create: input.items.map(item => ({
            side: item.side,
            itemName: item.itemName,
            specification: item.specification || null,
            unit: item.unit,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            qualityFactor: item.qualityFactor ?? 1,
            lossFactor: item.lossFactor ?? 1,
            marketValue: computeItemValue(item),
            valuationMethod: item.valuationMethod || 'market',
            sourceDocument: item.sourceDocument || null,
            note: item.note || null,
          })),
        },
        valuationSnapshots: {
          create: input.items.map(item => ({
            itemName: item.itemName,
            referencePrice: Number(item.unitPrice),
            referenceSource: item.sourceDocument || null,
            marketArea: null,
            validUntil: null,
            note: item.note || null,
          })),
        },
      },
    });

    return this.getSettlement(settlement.id);
  }

  static async approveSettlement(id: number, approvedBy: number, note?: string) {
    const settlement = await prisma.barterSettlement.findUnique({ where: { id } });
    if (!settlement) {
      throw new Error('Barter settlement not found');
    }
    assertBarterApprovalTransition(settlement.status);

    const result = await prisma.barterSettlement.updateMany({
      where: { id, status: { in: ['draft', 'quoted'] } },
      data: {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
        note: note ? `${settlement.note ? `${settlement.note}\n` : ''}${note}` : settlement.note,
      },
    });

    if (result.count !== 1) {
      return this.getSettlement(id);
    }

    return this.getSettlement(id);
  }

  static async postSettlement(id: number, postedBy: number, payload: { orderId?: number | null; postingAmount?: number; offsetType?: string; note?: string | null }) {
    const settlement = await prisma.barterSettlement.findUnique({
      where: { id },
      include: {
        agreement: {
          select: {
            id: true,
            status: true,
            remainingOffsetAmount: true,
            agreedOffsetAmount: true,
          },
        },
        items: true,
      },
    });

    if (!settlement) {
      throw new Error('Barter settlement not found');
    }
    assertBarterPostingTransition(settlement.status);

    const orderId = payload.orderId ?? settlement.orderId ?? null;
    const maxOffsetAmount = roundMoney(Math.min(Number(settlement.totalPartyAValue), Number(settlement.totalPartyBValue)));
    const offsetAmount = roundMoney(payload.postingAmount ?? maxOffsetAmount);
    const offsetType = payload.offsetType || 'barter_offset';

    if (offsetAmount <= 0) {
      throw new Error('Posting amount must be greater than zero');
    }

    if (offsetAmount > maxOffsetAmount) {
      throw new Error(`Posting amount cannot exceed settlement offset cap ${maxOffsetAmount}`);
    }

    if (orderId) {
      const linkedOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          customerId: true,
          status: true,
          finalAmount: true,
          paidAmount: true,
          receivableAdjustmentAmount: true,
        },
      });

      if (!linkedOrder) {
        throw new Error('Linked order not found');
      }

      if (linkedOrder.status === 'cancelled') {
        throw new Error('Cancelled order cannot receive barter posting');
      }

      if (settlement.customerId && linkedOrder.customerId !== settlement.customerId) {
        throw new Error('Linked order does not belong to the settlement customer');
      }

      const outstandingAmount = roundMoney(getOutstandingAmount(
        Number(linkedOrder.finalAmount),
        Number(linkedOrder.paidAmount),
        Number(linkedOrder.receivableAdjustmentAmount),
      ));
      if (outstandingAmount <= 0) {
        throw new Error('Linked order has no outstanding receivable for barter posting');
      }

      if (offsetAmount > outstandingAmount) {
        throw new Error(`Posting amount cannot exceed linked order outstanding amount ${outstandingAmount}`);
      }
    }

    const paymentRecord = await withDbRetry(() => prisma.$transaction(async (tx) => {
      let createdPaymentRecord: { id: number } | null = null;
      const claim = await tx.barterSettlement.updateMany({
        where: { id: settlement.id, status: 'approved' },
        data: {
          status: 'posted',
          postedBy,
          postedAt: new Date(),
          orderId,
        },
      });

      if (claim.count !== 1) {
        const latest = await tx.barterSettlement.findUnique({
          where: { id: settlement.id },
          select: { id: true, status: true },
        });
        if (!latest) {
          throw new Error('Barter settlement not found');
        }
        if (latest.status === 'posted') {
          throw new Error('Barter settlement has already been posted. Please refresh before retrying.');
        }
        if (latest.status === 'reversed') {
          throw new Error('Barter settlement was reversed before posting. Please refresh before retrying.');
        }
        throw new Error(`Barter settlement status changed by another operation: ${settlement.status} -> ${latest.status}`);
      }

      if (settlement.agreementId) {
        const agreement = await tx.barterAgreement.findUnique({
          where: { id: settlement.agreementId },
          select: {
            id: true,
            status: true,
            agreedOffsetAmount: true,
          },
        });

        if (!agreement) {
          throw new Error('Barter agreement not found');
        }

        if (agreement.status === 'closed' || agreement.status === 'terminated') {
          throw new Error(`Barter agreement status ${agreement.status} cannot receive postings`);
        }

        const postedSettlements = await tx.barterSettlement.findMany({
          where: {
            agreementId: settlement.agreementId,
            status: 'posted',
            id: { not: settlement.id },
          },
          select: {
            offsetPostings: {
              select: {
                offsetAmount: true,
              },
            },
          },
        });

        const executedOffsetAmount = roundMoney(postedSettlements.reduce((sum, postedSettlement) => (
          sum + postedSettlement.offsetPostings.reduce((postingTotal, posting) => postingTotal + Number(posting.offsetAmount), 0)
        ), 0));
        const liveRemainingAmount = roundMoney(Math.max(Number(agreement.agreedOffsetAmount || 0) - executedOffsetAmount, 0));

        if (offsetAmount > liveRemainingAmount) {
          throw new Error(`Posting amount cannot exceed agreement remaining amount ${liveRemainingAmount}`);
        }
      }

      if (orderId && offsetAmount > 0) {
        const linkedOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            customerId: true,
            status: true,
            finalAmount: true,
            receivableAdjustmentAmount: true,
          },
        });

        if (!linkedOrder) {
          throw new Error('Linked order not found');
        }

        if (linkedOrder.status === 'cancelled') {
          throw new Error('Cancelled order cannot receive barter posting');
        }

        if (settlement.customerId && linkedOrder.customerId !== settlement.customerId) {
          throw new Error('Linked order does not belong to the settlement customer');
        }

        const verifiedPayments = await tx.paymentRecord.aggregate({
          where: {
            orderId,
            status: 'verified',
          },
          _sum: { amount: true },
        });
        const paidAmount = Number(verifiedPayments._sum.amount || 0);
        const liveOutstandingAmount = roundMoney(getOutstandingAmount(
          Number(linkedOrder.finalAmount),
          paidAmount,
          Number(linkedOrder.receivableAdjustmentAmount),
        ));
        if (liveOutstandingAmount <= 0) {
          throw new Error('Linked order has no outstanding receivable for barter posting');
        }
        if (offsetAmount > liveOutstandingAmount) {
          throw new Error(`Posting amount cannot exceed linked order outstanding amount ${liveOutstandingAmount}`);
        }

        createdPaymentRecord = await tx.paymentRecord.create({
          data: {
            orderId,
            amount: offsetAmount,
            method: 'barter',
            date: new Date(),
            payerName: settlement.counterpartyName,
            isProxy: false,
            note: payload.note || settlement.note || null,
            status: 'verified',
            barterMetadata: JSON.stringify(parseBarterMetadata({
              ...settlement,
              items: settlement.items,
            }, offsetAmount)),
            verifiedBy: postedBy,
          },
          select: { id: true },
        });
      }

      await postBarterStockEntries(settlement, tx, postedBy);

      await tx.barterOffsetPosting.create({
        data: {
          settlementId: settlement.id,
          paymentRecordId: createdPaymentRecord?.id ?? null,
          offsetAmount,
          offsetType,
          note: payload.note || settlement.note || null,
          postedBy,
        },
      });

      const updated = await tx.barterSettlement.update({
        where: { id: settlement.id },
        data: {
          status: 'posted',
          paymentRecordId: createdPaymentRecord?.id ?? settlement.paymentRecordId ?? null,
        },
      });

      if (settlement.agreementId) {
        await this.syncAgreementProgress(settlement.agreementId, tx);
      }

      return { settlement: updated, paymentRecordId: createdPaymentRecord?.id ?? null };
    }), { label: 'postBarterSettlement' });

    if (!paymentRecord.settlement) {
      return this.getSettlement(id);
    }

    if (orderId) {
      await CollectionStateService.recalculateOrderPaymentState(orderId);
    }

    if (settlement.agreementId) {
      await this.syncAgreementProgress(settlement.agreementId);
    }

    return this.getSettlement(paymentRecord.settlement.id);
  }

  static async reverseSettlement(id: number, reversedBy: number, reason: string) {
    const settlement = await prisma.barterSettlement.findUnique({
      where: { id },
      select: {
        id: true,
        settlementNo: true,
        agreementId: true,
        status: true,
        orderId: true,
        paymentRecordId: true,
      },
    });

    if (!settlement) {
      throw new Error('Barter settlement not found');
    }
    assertBarterReversalTransition(settlement.status);

    await withDbRetry(() => prisma.$transaction(async (tx) => {
      const claim = await tx.barterSettlement.updateMany({
        where: { id: settlement.id, status: settlement.status },
        data: {
          status: 'reversed',
          reversedAt: new Date(),
        },
      });

      if (claim.count !== 1) {
        const latest = await tx.barterSettlement.findUnique({
          where: { id: settlement.id },
          select: { id: true, status: true },
        });
        if (!latest) {
          throw new Error('Barter settlement not found');
        }
        if (latest.status === 'reversed') {
          return;
        }
        throw new Error(`Barter settlement status changed by another operation: ${settlement.status} -> ${latest.status}`);
      }

      if (settlement.paymentRecordId) {
        await tx.paymentRecord.update({
          where: { id: settlement.paymentRecordId },
          data: {
            status: 'reversed',
          },
        });
      }

      if (settlement.status === 'posted') {
        await postBarterStockReversalEntries(settlement, tx, reversedBy, reason);
      }

      await tx.barterReversalLog.create({
        data: {
          settlementId: settlement.id,
          originalStatus: settlement.status,
          reason,
          reversedBy,
        },
      });

      if (settlement.agreementId) {
        await this.syncAgreementProgress(settlement.agreementId, tx);
      }
    }), { label: 'reverseBarterSettlement' });

    if (settlement.orderId) {
      await CollectionStateService.recalculateOrderPaymentState(settlement.orderId);
    }

    if (settlement.agreementId) {
      await this.syncAgreementProgress(settlement.agreementId);
    }

    return this.getSettlement(settlement.id);
  }
}
