import type {
  BarterItemInput,
  BarterPreviewResult,
  CreateBarterSettlementInput,
} from './barter.types';
import {
  addMoney,
  calculateRatio,
  maxMoney,
  minMoney,
  multiplyMoney,
  roundMoney,
  subtractMoney,
  type DecimalInput,
} from '../../utils/money';

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

type BarterPostingAmount = { offsetAmount: DecimalInput };
type BarterFinancialSettlement = {
  status: string;
  cashDifference?: DecimalInput;
  offsetPostings: BarterPostingAmount[];
};

export const calculatePostedBarterTotals = (
  settlements: BarterFinancialSettlement[],
) => settlements.reduce((totals, settlement) => {
  if (settlement.status !== 'posted') return totals;
  return {
    totalOffset: addMoney(
      totals.totalOffset,
      ...settlement.offsetPostings.map(posting => posting.offsetAmount),
    ),
    totalCashDifference: addMoney(totals.totalCashDifference, settlement.cashDifference),
  };
}, { totalOffset: 0, totalCashDifference: 0 });

export const calculateBarterAgreementProgress = (
  agreedOffsetAmountInput: DecimalInput,
  settlements: BarterFinancialSettlement[],
) => {
  const agreedOffsetAmount = roundMoney(agreedOffsetAmountInput);
  const { totalOffset: executedOffsetAmount } = calculatePostedBarterTotals(settlements);
  const remainingOffsetAmount = maxMoney(0, subtractMoney(agreedOffsetAmount, executedOffsetAmount));
  return {
    agreedOffsetAmount,
    executedOffsetAmount,
    remainingOffsetAmount,
    completionRatio: Math.min(calculateRatio(executedOffsetAmount, agreedOffsetAmount), 1),
  };
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
