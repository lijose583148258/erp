import type { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import type { BarterListQuery } from './barter.types';
import { roundMoney } from './barter.calculations';
import { toDisplayName } from './barter.formatters';

export async function getBarterSummary(where: Prisma.BarterSettlementWhereInput = {}) {
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

export async function listBarterSettlements(query: BarterListQuery) {
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

export async function getBarterSettlement(id: number) {
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
