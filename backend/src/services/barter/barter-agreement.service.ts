import type { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { buildBusinessNo } from '../../utils/businessNo';
import { withDbRetry } from '../../utils/dbRetry';
import type { TransactionClient } from '../stock-movement.service';
import type {
  BarterAgreementListQuery,
  BarterCounterpartyType,
  BarterSettlementMode,
  CreateBarterAgreementInput,
  CreateBarterBatchInput,
} from './barter.types';
import { computeItemValue, previewBarterSettlement, roundMoney } from './barter.calculations';
import { determineAgreementStatus, toDisplayName } from './barter.formatters';
import { validateCounterpartyAndOrderLinks } from './barter-counterparty.service';
import { getBarterSettlement } from './barter-query.service';

export async function syncBarterAgreementProgress(agreementId: number, client: TransactionClient = prisma) {
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

export async function listBarterAgreements(query: BarterAgreementListQuery) {
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

export async function getBarterAgreement(id: number) {
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

export async function createBarterAgreement(input: CreateBarterAgreementInput) {
  const preview = previewBarterSettlement({ items: input.items, settlementMode: input.settlementMode });
  const { customerId, supplierId } = await validateCounterpartyAndOrderLinks(input);

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

  return getBarterAgreement(agreement.id);
}

export async function createBarterBatchForAgreement(agreementId: number, input: CreateBarterBatchInput) {
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

  await validateCounterpartyAndOrderLinks({
    counterpartyType: agreement.counterpartyType as BarterCounterpartyType,
    customerId: agreement.customerId,
    supplierId: agreement.supplierId,
    orderId: input.orderId ?? agreement.orderId ?? null,
  });

  const duplicateWindowStart = new Date(Date.now() - 15_000);
  const createdSettlement = await withDbRetry(() => prisma.$transaction(async (tx) => {
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

    const preview = previewBarterSettlement({ items: input.items, settlementMode: liveAgreement.settlementMode as BarterSettlementMode });
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

  return getBarterSettlement(createdSettlement.id);
}
