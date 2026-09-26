import React from 'react';
import { ArrowRightLeft } from 'lucide-react';
import type {
  AdjustmentDomain,
  AdjustmentRecord,
  AdjustmentStatus,
  AdjustmentTargetType,
} from '../../services/adjustment.service';
import type { AdjustmentFormState } from './adjustment.constants';

type AdjustmentCreatePayload = {
  domain: AdjustmentDomain;
  targetType: AdjustmentTargetType;
  targetId?: number;
  orderId?: number;
  batchId?: number;
  customerId?: number;
  targetRef?: string;
  quantityDelta?: number;
  amountDelta?: number;
  reason: string;
  reasonCategory?: string;
  lossType?: string;
  note?: string;
  status?: AdjustmentStatus;
};

export const buildAdjustmentPayload = (form: AdjustmentFormState): AdjustmentCreatePayload => {
  const payload: AdjustmentCreatePayload = {
    domain: form.domain,
    targetType: form.targetType,
    reason: form.reason,
    status: form.status,
  };

  const assignNumber = (key: keyof AdjustmentCreatePayload, value: string) => {
    if (value.trim()) {
      (payload as Record<string, string | number>)[key] = Number(value);
    }
  };

  const assignText = (key: keyof AdjustmentCreatePayload, value: string) => {
    if (value.trim()) {
      (payload as Record<string, string | number>)[key] = value.trim();
    }
  };

  assignNumber('targetId', form.targetId);
  assignNumber('orderId', form.orderId);
  assignNumber('batchId', form.batchId);
  assignNumber('customerId', form.customerId);
  assignNumber('quantityDelta', form.quantityDelta);
  assignNumber('amountDelta', form.amountDelta);
  assignText('targetRef', form.targetRef);
  assignText('reasonCategory', form.reasonCategory);
  assignText('lossType', form.lossType);
  assignText('note', form.note);

  return payload;
};

export const buildAdjustmentSearchText = (record: AdjustmentRecord) =>
  [
    record.adjustmentNo,
    record.reason,
    record.reasonCategory,
    record.lossType,
    record.targetRef,
    record.orderNo,
    record.batchNo,
    record.productName,
    record.customerDisplayName || record.customerNameZh || record.customerNameEn || record.customerNameVi || record.customerName,
    record.note,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export const renderAdjustmentDelta = (
  record: AdjustmentRecord,
  formatPrice: (value: number) => string
) => {
  if (record.domain === 'finance') {
    const value = Number(record.amountDelta || 0);
    return (
      <span
        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${
          value >= 0
            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
            : 'bg-rose-50 text-rose-700 border-rose-100'
        }`}
      >
        <ArrowRightLeft size={12} />
        {value >= 0 ? '+' : ''}
        {formatPrice(Math.abs(value))}
      </span>
    );
  }

  const value = Number(record.quantityDelta || 0);
  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border ${
        value >= 0
          ? 'bg-blue-50 text-blue-700 border-blue-100'
          : 'bg-rose-50 text-rose-700 border-rose-100'
      }`}
    >
      <ArrowRightLeft size={12} />
      {value >= 0 ? '+' : ''}
      {value}
    </span>
  );
};

export const getAdjustmentTargetLabel = (targetType: string) => {
  if (targetType === 'order') return '订单';
  if (targetType === 'productBatch') return '批次';
  return '手工';
};
