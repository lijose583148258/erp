import type {
  BarterItemInput,
  BarterPreviewResult,
  CreateBarterSettlementInput,
} from './barter.types';
import { addMoney, minMoney, multiplyMoney, roundMoney, subtractMoney } from '../../utils/money';

export { roundMoney };

export const computeItemValue = (item: BarterItemInput): number => {
  if (item.marketValue !== undefined && item.marketValue !== null) {
    return roundMoney(Number(item.marketValue));
  }

  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const qualityFactor = item.qualityFactor === undefined || item.qualityFactor === null ? 1 : Number(item.qualityFactor);
  const lossFactor = item.lossFactor === undefined || item.lossFactor === null ? 1 : Number(item.lossFactor);
  return multiplyMoney(quantity, unitPrice, qualityFactor, lossFactor);
};

export function previewBarterSettlement(
  input: Pick<CreateBarterSettlementInput, 'items' | 'settlementMode'>,
): BarterPreviewResult {
  const items = input.items.map((item) => ({
    ...item,
    marketValue: computeItemValue(item),
  }));
  const totalPartyAValue = addMoney(...items.filter(item => item.side === 'our').map(item => item.marketValue));
  const totalPartyBValue = addMoney(...items.filter(item => item.side === 'counterparty').map(item => item.marketValue));
  const cashDifference = subtractMoney(totalPartyAValue, totalPartyBValue);
  return {
    totalPartyAValue: roundMoney(totalPartyAValue),
    totalPartyBValue: roundMoney(totalPartyBValue),
    cashDifference,
    settlementMode: input.settlementMode || 'mixed',
    suggestedOffsetAmount: minMoney(totalPartyAValue, totalPartyBValue),
    items,
  };
}
