import type {
  BarterItemInput,
  BarterPreviewResult,
  CreateBarterSettlementInput,
} from './barter.types';

export const roundMoney = (value: number) => Number(value.toFixed(2));

export const computeItemValue = (item: BarterItemInput): number => {
  if (item.marketValue !== undefined && item.marketValue !== null) {
    return roundMoney(Number(item.marketValue));
  }

  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const qualityFactor = item.qualityFactor === undefined || item.qualityFactor === null ? 1 : Number(item.qualityFactor);
  const lossFactor = item.lossFactor === undefined || item.lossFactor === null ? 1 : Number(item.lossFactor);
  return roundMoney(quantity * unitPrice * qualityFactor * lossFactor);
};

export function previewBarterSettlement(
  input: Pick<CreateBarterSettlementInput, 'items' | 'settlementMode'>,
): BarterPreviewResult {
  const items = input.items.map((item) => ({
    ...item,
    marketValue: computeItemValue(item),
  }));
  const totalPartyAValue = items.filter(item => item.side === 'our').reduce((sum, item) => sum + Number(item.marketValue), 0);
  const totalPartyBValue = items.filter(item => item.side === 'counterparty').reduce((sum, item) => sum + Number(item.marketValue), 0);
  const cashDifference = roundMoney(totalPartyAValue - totalPartyBValue);
  return {
    totalPartyAValue: roundMoney(totalPartyAValue),
    totalPartyBValue: roundMoney(totalPartyBValue),
    cashDifference,
    settlementMode: input.settlementMode || 'mixed',
    suggestedOffsetAmount: roundMoney(Math.min(totalPartyAValue || 0, totalPartyBValue || 0)),
    items,
  };
}
