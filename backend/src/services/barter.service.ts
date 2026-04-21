import prisma from '../config/database';
import { CollectionStateService } from './collection-state.service';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
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
import {
  determineAgreementStatus,
  parseBarterMetadata,
  resolveCounterpartyIds,
  toDisplayName,
} from './barter/barter.formatters';
import {
  assertBarterApprovalTransition,
  assertBarterPostingTransition,
  assertBarterReversalTransition,
} from './barter/barter.transitions';
import { postBarterStockEntries, postBarterStockReversalEntries } from './barter/barter.stock';

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

  private static async validateCounterpartyAndOrderLinks(input: {
    counterpartyType: BarterCounterpartyType;
    customerId?: number | null;
    supplierId?: number | null;
    orderId?: number | null;
  }) {
    const { customerId, supplierId } = resolveCounterpartyIds(input);

    if (input.counterpartyType === 'customer' && !customerId) {
      throw new Error('Customer is required for customer barter settlement');
    }

    if (input.counterpartyType === 'supplier' && !supplierId) {
      throw new Error('Supplier is required for supplier barter settlement');
    }

    if (customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });

      if (!customer) {
        throw new Error('Customer not found for barter settlement');
      }
    }

    if (supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true },
      });

      if (!supplier) {
        throw new Error('Supplier not found for barter settlement');
      }
    }

    if (input.orderId) {
      const linkedOrder = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          customerId: true,
          status: true,
        },
      });

      if (!linkedOrder) {
        throw new Error('Linked order not found');
      }

      if (linkedOrder.status === 'cancelled') {
        throw new Error('Cancelled order cannot be linked to barter settlement');
      }

      if (customerId && linkedOrder.customerId !== customerId) {
        throw new Error('Linked order does not belong to the selected customer');
      }
    }

    return { customerId, supplierId };
  }

  static async syncAgreementProgress(agreementId: number, client: TransactionClient = prisma) {
    const agreement = await client.barterAgreement.findUnique({
      where: { id: agreementId },
      select: {
        id: true,
        agreedOffsetAmount: true,
        status: true,
      },
    });

    if (!agreement) {
      throw new Error('Barter agreement not found');
    }

    const settlements = await client.barterSettlement.findMany({
      where: { agreementId },
      select: {
        status: true,
        offsetPostings: {
          select: {
            offsetAmount: true,
          },
        },
      },
    });

    const executedOffsetAmount = roundMoney(settlements.reduce((sum, settlement) => {
      if (settlement.status !== 'posted') {
        return sum;
      }
      return sum + settlement.offsetPostings.reduce((postingTotal, posting) => postingTotal + Number(posting.offsetAmount), 0);
    }, 0));
    const agreedOffsetAmount = roundMoney(Number(agreement.agreedOffsetAmount || 0));
    const remainingOffsetAmount = roundMoney(Math.max(agreedOffsetAmount - executedOffsetAmount, 0));
    const completionRatio = agreedOffsetAmount <= 0 ? 0 : roundMoney(Math.min(executedOffsetAmount / agreedOffsetAmount, 1));
    const status = determineAgreementStatus(String(agreement.status || 'active'), executedOffsetAmount, remainingOffsetAmount);

    return client.barterAgreement.update({
      where: { id: agreementId },
      data: {
        executedOffsetAmount,
        remainingOffsetAmount,
        completionRatio,
        status,
      },
    });
  }

  static async getSummary(where: Prisma.BarterSettlementWhereInput = {}) {
    const settlements = await prisma.barterSettlement.findMany({
      where,
      select: {
        status: true,
        totalPartyAValue: true,
        totalPartyBValue: true,
        cashDifference: true,
        offsetPostings: { select: { offsetAmount: true } },
      },
    });

    const settlementCount = settlements.length;
    const quotedCount = settlements.filter(item => item.status === 'draft' || item.status === 'quoted').length;
    const approvedCount = settlements.filter(item => item.status === 'approved').length;
    const postedCount = settlements.filter(item => item.status === 'posted').length;
    const reversedCount = settlements.filter(item => item.status === 'reversed').length;

    const totalOffset = settlements.reduce((sum, settlement) => {
      const postingSum = settlement.offsetPostings.reduce((postingTotal, posting) => postingTotal + Number(posting.offsetAmount), 0);
      return sum + postingSum;
    }, 0);

    const totalCashDifference = settlements.reduce((sum, settlement) => sum + Number(settlement.cashDifference), 0);

    return {
      settlementCount,
      quotedCount,
      approvedCount,
      postedCount,
      reversedCount,
      totalOffset: roundMoney(totalOffset),
      totalCashDifference: roundMoney(totalCashDifference),
    };
  }

  static async listAgreements(query: BarterAgreementListQuery) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 10)));
    const where: Prisma.BarterAgreementWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.counterpartyType) {
      where.counterpartyType = query.counterpartyType;
    }

    if (query.search) {
      const normalizedSearch = String(query.search).trim();
      where.OR = [
        { agreementNo: { contains: normalizedSearch } },
        { counterpartyName: { contains: normalizedSearch } },
      ];
    }
    const finalWhere: Prisma.BarterAgreementWhereInput = query.where && Object.keys(query.where).length > 0
      ? { AND: [where, query.where] }
      : where;

    const [total, items] = await Promise.all([
      prisma.barterAgreement.count({ where: finalWhere }),
      prisma.barterAgreement.findMany({
        where: finalWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          agreementNo: true,
          counterpartyType: true,
          counterpartyName: true,
          settlementMode: true,
          totalPartyAValue: true,
          totalPartyBValue: true,
          agreedOffsetAmount: true,
          executedOffsetAmount: true,
          remainingOffsetAmount: true,
          completionRatio: true,
          currency: true,
          status: true,
          agreementDate: true,
          valuationDate: true,
          createdAt: true,
          updatedAt: true,
          customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
          supplier: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
          order: { select: { orderNo: true } },
          _count: { select: { settlements: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map(item => ({
        ...item,
        customerDisplayName: toDisplayName(item.customer),
        supplierDisplayName: toDisplayName(item.supplier),
        batchCount: Number(item._count?.settlements || 0),
      })),
    };
  }

  static async getAgreement(id: number) {
    const agreement = await prisma.barterAgreement.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, username: true } },
        customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
        supplier: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
        order: { select: { id: true, orderNo: true } },
        items: { orderBy: { id: 'asc' } },
        settlements: {
          orderBy: [{ batchIndex: 'desc' }, { createdAt: 'desc' }],
          include: {
            items: { orderBy: { id: 'asc' } },
            offsetPostings: { orderBy: { id: 'asc' } },
            reversalLogs: { orderBy: { id: 'asc' } },
            paymentRecord: { select: { id: true, amount: true, status: true, method: true, date: true } },
          },
        },
      },
    });

    if (!agreement) {
      throw new Error('Barter agreement not found');
    }

    return {
      ...agreement,
      customerDisplayName: toDisplayName(agreement.customer),
      supplierDisplayName: toDisplayName(agreement.supplier),
    };
  }

  static async createAgreement(input: CreateBarterAgreementInput) {
    const preview = this.preview({ items: input.items, settlementMode: input.settlementMode });
    const { customerId, supplierId } = await this.validateCounterpartyAndOrderLinks(input);

    const agreement = await prisma.barterAgreement.create({
      data: {
        agreementNo: buildBusinessNo('BTA'),
        counterpartyType: input.counterpartyType,
        counterpartyName: input.counterpartyName,
        customerId,
        supplierId,
        orderId: input.orderId ?? null,
        settlementMode: input.settlementMode || 'mixed',
        totalPartyAValue: preview.totalPartyAValue,
        totalPartyBValue: preview.totalPartyBValue,
        agreedOffsetAmount: preview.suggestedOffsetAmount,
        executedOffsetAmount: 0,
        remainingOffsetAmount: preview.suggestedOffsetAmount,
        completionRatio: 0,
        currency: input.currency || 'CNY',
        agreementDate: input.agreementDate || new Date(),
        valuationDate: input.valuationDate || input.agreementDate || new Date(),
        note: input.note || null,
        createdBy: input.createdBy,
        status: 'active',
        items: {
          create: input.items.map((item) => ({
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
      },
    });

    return this.getAgreement(agreement.id);
  }

  static async createBatchForAgreement(agreementId: number, input: CreateBarterBatchInput) {
    const agreement = await prisma.barterAgreement.findUnique({
      where: { id: agreementId },
      select: {
        id: true,
        counterpartyType: true,
        customerId: true,
        supplierId: true,
        orderId: true,
      },
    });

    if (!agreement) {
      throw new Error('Barter agreement not found');
    }

    await this.validateCounterpartyAndOrderLinks({
      counterpartyType: agreement.counterpartyType as BarterCounterpartyType,
      customerId: agreement.customerId,
      supplierId: agreement.supplierId,
      orderId: input.orderId ?? agreement.orderId ?? null,
    });

    const duplicateWindowStart = new Date(Date.now() - 15_000);
    const createdSettlement = await withDbRetry(() => prisma.$transaction(async (tx) => {
      // Touching the parent agreement serializes concurrent batch creation in SQLite,
      // so two identical clicks cannot both compute the same next batch index.
      await tx.barterAgreement.update({
        where: { id: agreementId },
        data: { updatedAt: new Date() },
      });

      const liveAgreement = await tx.barterAgreement.findUnique({
        where: { id: agreementId },
        include: {
          settlements: {
            select: {
              id: true,
              batchIndex: true,
            },
            orderBy: { batchIndex: 'desc' },
            take: 1,
          },
        },
      });

      if (!liveAgreement) {
        throw new Error('Barter agreement not found');
      }

      if (liveAgreement.status === 'closed' || liveAgreement.status === 'terminated') {
        throw new Error(`Barter agreement status ${liveAgreement.status} cannot create new execution batches`);
      }

      if (Number(liveAgreement.remainingOffsetAmount || 0) <= 0) {
        throw new Error('Barter agreement has no remaining offset amount');
      }

      const preview = this.preview({ items: input.items, settlementMode: liveAgreement.settlementMode as BarterSettlementMode });
      if (preview.suggestedOffsetAmount > Number(liveAgreement.remainingOffsetAmount || 0)) {
        throw new Error(`Batch offset amount cannot exceed agreement remaining amount ${liveAgreement.remainingOffsetAmount}`);
      }

      const duplicateBatch = await tx.barterSettlement.findFirst({
        where: {
          agreementId: liveAgreement.id,
          createdBy: input.createdBy,
          note: input.note || null,
          status: { in: ['quoted', 'approved', 'posted'] },
          totalPartyAValue: preview.totalPartyAValue,
          totalPartyBValue: preview.totalPartyBValue,
          cashDifference: preview.cashDifference,
          createdAt: { gte: duplicateWindowStart },
        },
        select: { id: true },
      });

      if (duplicateBatch) {
        const error = new Error('Duplicate barter batch submission detected. Please refresh settlement batches before submitting again.');
        throw error;
      }

      const batchIndex = Number(liveAgreement.settlements[0]?.batchIndex || 0) + 1;
      return tx.barterSettlement.create({
        data: {
          settlementNo: buildBusinessNo('BT'),
          agreementId: liveAgreement.id,
          batchIndex,
          counterpartyType: liveAgreement.counterpartyType,
          counterpartyName: liveAgreement.counterpartyName,
          customerId: liveAgreement.customerId,
          supplierId: liveAgreement.supplierId,
          orderId: input.orderId ?? liveAgreement.orderId ?? null,
          settlementMode: liveAgreement.settlementMode,
          totalPartyAValue: preview.totalPartyAValue,
          totalPartyBValue: preview.totalPartyBValue,
          cashDifference: preview.cashDifference,
          currency: liveAgreement.currency,
          valuationDate: input.valuationDate || liveAgreement.valuationDate || new Date(),
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
        select: { id: true },
      });
    }), { label: 'createBarterBatchForAgreement' });

    return this.getSettlement(createdSettlement.id);
  }

  static async listSettlements(query: BarterListQuery) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 10)));
    const where: Prisma.BarterSettlementWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.counterpartyType) {
      where.counterpartyType = query.counterpartyType;
    }

    if (query.search) {
      const normalizedSearch = String(query.search).trim();
      where.OR = [
        { settlementNo: { contains: normalizedSearch } },
        { counterpartyName: { contains: normalizedSearch } },
      ];
    }
    const finalWhere: Prisma.BarterSettlementWhereInput = query.where && Object.keys(query.where).length > 0
      ? { AND: [where, query.where] }
      : where;

    const [total, items] = await Promise.all([
      prisma.barterSettlement.count({ where: finalWhere }),
      prisma.barterSettlement.findMany({
        where: finalWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          settlementNo: true,
          agreementId: true,
          batchIndex: true,
          counterpartyType: true,
          counterpartyName: true,
          settlementMode: true,
          totalPartyAValue: true,
          totalPartyBValue: true,
          cashDifference: true,
          currency: true,
          status: true,
          valuationDate: true,
          createdAt: true,
          approvedAt: true,
          postedAt: true,
          reversedAt: true,
          agreement: { select: { agreementNo: true } },
          customer: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
          supplier: { select: { name: true, nameZh: true, nameEn: true, nameVi: true } },
          order: { select: { orderNo: true } },
          items: {
            select: {
              id: true,
              side: true,
              itemName: true,
              specification: true,
              unit: true,
              quantity: true,
              unitPrice: true,
              qualityFactor: true,
              lossFactor: true,
              marketValue: true,
              valuationMethod: true,
            },
            orderBy: { id: 'asc' },
          },
          valuationSnapshots: {
            select: {
              id: true,
              itemName: true,
              referencePrice: true,
              referenceSource: true,
              marketArea: true,
              validUntil: true,
              appraisedAt: true,
            },
            orderBy: { id: 'asc' },
          },
          offsetPostings: {
            select: {
              id: true,
              offsetAmount: true,
              offsetType: true,
              postedAt: true,
              paymentRecordId: true,
            },
            orderBy: { id: 'asc' },
          },
          reversalLogs: {
            select: {
              id: true,
              originalStatus: true,
              reason: true,
              reversedAt: true,
            },
            orderBy: { id: 'asc' },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map(item => ({
        ...item,
        agreementNo: item.agreement?.agreementNo || null,
        customerDisplayName: toDisplayName(item.customer),
        supplierDisplayName: toDisplayName(item.supplier),
      })),
    };
  }

  static async getSettlement(id: number) {
    const settlement = await prisma.barterSettlement.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, username: true } },
        agreement: { select: { id: true, agreementNo: true, status: true, agreedOffsetAmount: true, executedOffsetAmount: true, remainingOffsetAmount: true } },
        customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
        supplier: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
        order: { select: { id: true, orderNo: true } },
        paymentRecord: { select: { id: true, amount: true, method: true, status: true, date: true, barterMetadata: true } },
        items: { orderBy: { id: 'asc' } },
        valuationSnapshots: { orderBy: { id: 'asc' } },
        offsetPostings: { orderBy: { id: 'asc' } },
        reversalLogs: { orderBy: { id: 'asc' } },
      },
    });

    if (!settlement) {
      throw new Error('Barter settlement not found');
    }

    return {
      ...settlement,
      agreementNo: settlement.agreement?.agreementNo || null,
      customerDisplayName: toDisplayName(settlement.customer),
      supplierDisplayName: toDisplayName(settlement.supplier),
    };
  }

  static async createSettlement(input: CreateBarterSettlementInput) {
    const preview = this.preview({ items: input.items, settlementMode: input.settlementMode });
    const { customerId, supplierId } = await this.validateCounterpartyAndOrderLinks(input);

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

      const outstandingAmount = roundMoney(Number(linkedOrder.finalAmount) - Number(linkedOrder.paidAmount));
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
        throw new Error('Barter settlement has already been posted. Please refresh before retrying.');
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
        const liveOutstandingAmount = roundMoney(Number(linkedOrder.finalAmount) - paidAmount);
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
        where: { id: settlement.id, status: { in: ['approved', 'posted'] } },
        data: {
          status: 'reversed',
          reversedAt: new Date(),
        },
      });

      if (claim.count !== 1) {
        return;
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
