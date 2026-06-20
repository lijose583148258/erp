import type { ComponentType, ReactNode } from 'react';
import { BadgeDollarSign, Factory, Package2 } from 'lucide-react';
import { getStatusBorderBadgeClassName } from '../../components/ui/statusBadgeLogic';
import type {
  AdjustmentDomain,
  AdjustmentStatus,
  AdjustmentTargetType,
} from '../../services/adjustment.service';

export interface AdjustmentFormState {
  domain: AdjustmentDomain;
  targetType: AdjustmentTargetType;
  targetId: string;
  orderId: string;
  batchId: string;
  customerId: string;
  targetRef: string;
  quantityDelta: string;
  amountDelta: string;
  reason: string;
  reasonCategory: string;
  lossType: string;
  note: string;
  status: AdjustmentStatus;
}

export interface AdjustmentTemplate {
  id: string;
  label: string;
  helperText: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  patch: Partial<AdjustmentFormState>;
}

export interface AdjustmentStatCounts {
  total: number;
  posted: number;
  pending: number;
  reversed: number;
}

export type AdjustmentDomainMeta = Record<
  AdjustmentDomain,
  { label: string; className: string; icon: ReactNode }
>;

export type AdjustmentStatusMeta = Record<
  AdjustmentStatus,
  { label: string; className: string }
>;

export const emptyAdjustmentForm: AdjustmentFormState = {
  domain: 'finance',
  targetType: 'order',
  targetId: '',
  orderId: '',
  batchId: '',
  customerId: '',
  targetRef: '',
  quantityDelta: '',
  amountDelta: '',
  reason: '',
  reasonCategory: '',
  lossType: '',
  note: '',
  status: 'posted',
};

export const adjustmentTemplates = [
  {
    id: 'finance',
    label: '\u6536\u6b3e\u66f4\u6b63',
    helperText: '\u53ea\u4fee\u6b63\u5df2\u6536\u91d1\u989d\uff0c\u51cf\u514d\u002f\u574f\u8d26\u8d70\u5e94\u6536\u8c03\u6574',
    icon: BadgeDollarSign,
    patch: {
      domain: 'finance' as AdjustmentDomain,
      targetType: 'order' as AdjustmentTargetType,
      amountDelta: '1000',
      reason: '\u7ebf\u4e0b\u5230\u8d26\u6216\u6536\u6b3e\u66f4\u6b63',
      reasonCategory: 'cash_receipt_correction',
    },
  },
  {
    id: 'production',
    label: '\u751f\u4ea7\u635f\u8017',
    helperText: '\u8bb0\u5f55\u751f\u4ea7\u635f\u8017\u4e0e\u62a5\u635f',
    icon: Factory,
    patch: {
      domain: 'production' as AdjustmentDomain,
      targetType: 'productBatch' as AdjustmentTargetType,
      quantityDelta: '-1',
      reason: '\u751f\u4ea7\u635f\u8017\u8c03\u6574',
      reasonCategory: 'production_loss',
      lossType: 'loss',
    },
  },
  {
    id: 'inventory',
    label: '\u5e93\u5b58\u76d8\u5dee',
    helperText: '\u76d8\u70b9\u5dee\u5f02\u4fee\u6b63',
    icon: Package2,
    patch: {
      domain: 'inventory' as AdjustmentDomain,
      targetType: 'productBatch' as AdjustmentTargetType,
      quantityDelta: '1',
      reason: '\u5e93\u5b58\u76d8\u70b9\u4fee\u6b63',
      reasonCategory: 'inventory_discrepancy',
      lossType: 'count_difference',
    },
  },
] as const satisfies readonly AdjustmentTemplate[];

export const adjustmentDomainMeta: AdjustmentDomainMeta = {
  finance: {
    label: '\u8d22\u52a1',
    className: 'bg-blue-50 text-blue-700 border-blue-100',
    icon: <BadgeDollarSign size={13} />,
  },
  production: {
    label: '\u751f\u4ea7',
    className: 'bg-amber-50 text-amber-700 border-amber-100',
    icon: <Factory size={13} />,
  },
  inventory: {
    label: '\u5e93\u5b58',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    icon: <Package2 size={13} />,
  },
};

export const adjustmentStatusMeta: AdjustmentStatusMeta = {
  pending: { label: '\u5f85\u5904\u7406', className: getStatusBorderBadgeClassName('pending') },
  posted: { label: '\u5df2\u751f\u6548', className: getStatusBorderBadgeClassName('posted') },
  reversed: { label: '\u5df2\u51b2\u9500', className: getStatusBorderBadgeClassName('reversed') },
  rejected: { label: '\u5df2\u9a73\u56de', className: getStatusBorderBadgeClassName('rejected') },
};
