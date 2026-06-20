import type { Prisma } from '@prisma/client';

export type BarterSide = 'our' | 'counterparty';
export type BarterCounterpartyType = 'customer' | 'supplier' | 'other';
export type BarterSettlementMode = 'barter' | 'mixed' | 'cash_top_up' | 'cash_refund';
export type BarterSettlementStatus = 'draft' | 'quoted' | 'approved' | 'posted' | 'reversed' | 'closed';
export type BarterAgreementStatus = 'draft' | 'active' | 'partial' | 'completed' | 'closed' | 'terminated';

export interface BarterItemInput {
  side: BarterSide;
  itemName: string;
  specification?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  qualityFactor?: number | null;
  lossFactor?: number | null;
  marketValue?: number | null;
  valuationMethod?: string | null;
  sourceDocument?: string | null;
  note?: string | null;
}

export interface CreateBarterSettlementInput {
  agreementId?: number | null;
  batchIndex?: number | null;
  counterpartyType: BarterCounterpartyType;
  counterpartyName: string;
  customerId?: number | null;
  supplierId?: number | null;
  orderId?: number | null;
  settlementMode?: BarterSettlementMode;
  currency?: string | null;
  valuationDate?: Date | null;
  note?: string | null;
  items: BarterItemInput[];
  createdBy: number;
}

export interface CreateBarterAgreementInput {
  counterpartyType: BarterCounterpartyType;
  counterpartyName: string;
  customerId?: number | null;
  supplierId?: number | null;
  orderId?: number | null;
  settlementMode?: BarterSettlementMode;
  currency?: string | null;
  agreementDate?: Date | null;
  valuationDate?: Date | null;
  note?: string | null;
  items: BarterItemInput[];
  createdBy: number;
}

export interface CreateBarterBatchInput {
  orderId?: number | null;
  valuationDate?: Date | null;
  note?: string | null;
  items: BarterItemInput[];
  createdBy: number;
}

export interface BarterPreviewResult {
  totalPartyAValue: number;
  totalPartyBValue: number;
  cashDifference: number;
  settlementMode: BarterSettlementMode;
  suggestedOffsetAmount: number;
  items: Array<BarterItemInput & { marketValue: number }>;
}

export interface BarterListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  counterpartyType?: string;
  where?: Prisma.BarterSettlementWhereInput;
}

export interface BarterAgreementListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  counterpartyType?: string;
  where?: Prisma.BarterAgreementWhereInput;
}
