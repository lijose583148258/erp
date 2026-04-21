import type { BarterAgreementStatus, BarterCounterpartyType } from './barter.types';

type BarterMetadataItem = {
  side: string;
  itemName: string;
  specification?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  qualityFactor?: number | null;
  lossFactor?: number | null;
  marketValue: number;
  valuationMethod?: string | null;
  sourceDocument?: string | null;
  note?: string | null;
};

type BarterMetadataSettlement = {
  id: number;
  settlementNo: string;
  counterpartyType: string;
  counterpartyName: string;
  settlementMode: string;
  totalPartyAValue: number;
  totalPartyBValue: number;
  cashDifference: number;
  currency: string;
  items?: BarterMetadataItem[];
};

export const parseBarterMetadata = (settlement: BarterMetadataSettlement, offsetAmount: number) => ({
  settlementNo: settlement.settlementNo,
  settlementId: settlement.id,
  counterpartyType: settlement.counterpartyType,
  counterpartyName: settlement.counterpartyName,
  settlementMode: settlement.settlementMode,
  totalPartyAValue: Number(settlement.totalPartyAValue),
  totalPartyBValue: Number(settlement.totalPartyBValue),
  cashDifference: Number(settlement.cashDifference),
  currency: settlement.currency,
  offsetAmount,
  items: settlement.items?.map(item => ({
    side: item.side,
    itemName: item.itemName,
    specification: item.specification,
    unit: item.unit,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    qualityFactor: Number(item.qualityFactor ?? 1),
    lossFactor: Number(item.lossFactor ?? 1),
    marketValue: Number(item.marketValue),
    valuationMethod: item.valuationMethod,
    sourceDocument: item.sourceDocument,
    note: item.note,
  })) ?? [],
});

export const toDisplayName = (
  entity: { name?: string | null; nameZh?: string | null; nameEn?: string | null; nameVi?: string | null } | null | undefined,
) => {
  if (!entity) return null;
  return entity.nameZh || entity.nameEn || entity.nameVi || entity.name || null;
};

export const resolveCounterpartyIds = (input: {
  counterpartyType: BarterCounterpartyType;
  customerId?: number | null;
  supplierId?: number | null;
}) => ({
  customerId: input.customerId ?? null,
  supplierId: input.supplierId ?? null,
});

export const determineAgreementStatus = (
  currentStatus: string,
  executedOffsetAmount: number,
  remainingOffsetAmount: number,
): BarterAgreementStatus => {
  if (currentStatus === 'closed' || currentStatus === 'terminated') {
    return currentStatus as BarterAgreementStatus;
  }
  if (executedOffsetAmount <= 0) {
    return 'active';
  }
  if (remainingOffsetAmount <= 0) {
    return 'completed';
  }
  return 'partial';
};
