import type { CollectionActionMode, CollectionActionTarget } from './CollectionActionModal';

export type CollectionActionTemplateId =
  | 'promise_standard'
  | 'promise_wechat'
  | 'promise_onsite'
  | 'dispute_billing'
  | 'dispute_delivery'
  | 'dispute_quality'
  | 'dispute_contract';

export interface CollectionActionTemplate {
  id: CollectionActionTemplateId;
  mode: CollectionActionMode;
  label: string;
  description: string;
  notePrefix: string;
  channel?: 'phone' | 'wechat' | 'email' | 'onsite';
  promisedAtOffsetDays?: number;
  promisedAtHour?: number;
  promisedAtMinute?: number;
  reasonCategory?: 'billing' | 'delivery' | 'quality' | 'contract';
  reason?: string;
}

export interface CollectionActionDraft {
  promisedAmount: number;
  promisedAt: string;
  channel: 'phone' | 'wechat' | 'email' | 'onsite';
  contactName: string;
  contactPhone: string;
  reasonCategory: 'billing' | 'delivery' | 'quality' | 'contract';
  reason: string;
  note: string;
}

const toDateTimeLocalValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const buildPromiseAt = (offsetDays: number, hour = 17, minute = 0) => {
  const date = new Date(Date.now() + offsetDays * 86400000);
  date.setHours(hour, minute, 0, 0);
  return toDateTimeLocalValue(date);
};

export const collectionActionTemplates: CollectionActionTemplate[] = [
  {
    id: 'promise_standard',
    mode: 'promise',
    label: '标准电话催款',
    description: '7 天后电话回访，适合常规追款',
    notePrefix: '标准电话催款模板',
    channel: 'phone',
    promisedAtOffsetDays: 7,
    promisedAtHour: 17,
  },
  {
    id: 'promise_wechat',
    mode: 'promise',
    label: '微信提醒',
    description: '3 天后微信跟进，适合轻度提醒',
    notePrefix: '微信提醒模板',
    channel: 'wechat',
    promisedAtOffsetDays: 3,
    promisedAtHour: 10,
  },
  {
    id: 'promise_onsite',
    mode: 'promise',
    label: '上门约谈',
    description: '1 天内上门或当面确认，适合重点客户',
    notePrefix: '上门约谈模板',
    channel: 'onsite',
    promisedAtOffsetDays: 1,
    promisedAtHour: 14,
  },
  {
    id: 'dispute_billing',
    mode: 'dispute',
    label: '账单差异复核',
    description: '对账单、金额或开票内容存在差异',
    notePrefix: '账单差异复核模板',
    reasonCategory: 'billing',
    reason: '客户提出账单或开票金额存在差异，需复核对账明细',
  },
  {
    id: 'dispute_delivery',
    mode: 'dispute',
    label: '交付问题',
    description: '交付时间、收货或运输条件存在争议',
    notePrefix: '交付问题模板',
    reasonCategory: 'delivery',
    reason: '客户反馈交付进度或收货结果存在争议，需核对交付记录',
  },
  {
    id: 'dispute_quality',
    mode: 'dispute',
    label: '质量异议',
    description: '货品质检、批次或验收结果存在问题',
    notePrefix: '质量异议模板',
    reasonCategory: 'quality',
    reason: '客户反馈产品质量或验收结果存在异议，需核对批次与质检记录',
  },
  {
    id: 'dispute_contract',
    mode: 'dispute',
    label: '合同条款争议',
    description: '对付款条款、违约责任或约定存在争议',
    notePrefix: '合同条款争议模板',
    reasonCategory: 'contract',
    reason: '客户对合同付款条款或约定内容存在争议，需复核合同条款',
  },
];

export const getCollectionActionTemplates = (mode: CollectionActionMode) =>
  collectionActionTemplates.filter((item) => item.mode === mode);

export const getDefaultCollectionActionTemplateId = (mode: CollectionActionMode): CollectionActionTemplateId =>
  mode === 'promise' ? 'promise_standard' : 'dispute_billing';

export const getCollectionActionTemplateById = (templateId: CollectionActionTemplateId) =>
  collectionActionTemplates.find((item) => item.id === templateId) || null;

export const buildCollectionActionDraft = (
  mode: CollectionActionMode,
  target: CollectionActionTarget,
  templateId: CollectionActionTemplateId | 'custom'
): CollectionActionDraft => {
  const base: CollectionActionDraft = {
    promisedAmount: target.outstanding,
    promisedAt: buildPromiseAt(7, 17, 0),
    channel: 'phone',
    contactName: target.contactName || '',
    contactPhone: target.contactPhone || '',
    reasonCategory: 'billing',
    reason: '客户提出对账差异，待复核',
    note: '',
  };

  if (templateId === 'custom') {
    return base;
  }

  const template = getCollectionActionTemplateById(templateId);
  if (!template || template.mode !== mode) {
    return base;
  }

  if (mode === 'promise') {
    return {
      ...base,
      promisedAt: buildPromiseAt(template.promisedAtOffsetDays ?? 7, template.promisedAtHour ?? 17, template.promisedAtMinute ?? 0),
      channel: template.channel ?? 'phone',
      note: `${template.notePrefix}：订单 ${target.orderNo}`,
    };
  }

  return {
    ...base,
    reasonCategory: template.reasonCategory ?? 'billing',
    reason: template.reason ?? base.reason,
    note: `${template.notePrefix}：订单 ${target.orderNo}`,
  };
};
