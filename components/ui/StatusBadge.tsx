import React from 'react';
import {
  getBadgeText,
  getStatusBadgeClassName,
  getStatusLabel,
  isHighRiskStatus,
  normalizeStatus,
} from './statusBadgeLogic';

type Props = {
  status: unknown;
  label?: React.ReactNode;
  className?: string;
};

export const StatusBadge: React.FC<Props> = ({ status, label, className = '' }) => {
  const key = normalizeStatus(status || 'unknown');
  const toneClass = getStatusBadgeClassName(key);
  const text = label === undefined ? getStatusLabel(key) : getBadgeText(label, status || 'unknown');
  const riskClass = isHighRiskStatus(key) ? 'ring-2 ring-offset-1 ring-offset-white dark:ring-offset-slate-900' : 'ring-1';

  return (
    <span
      title={typeof text === 'string' ? text : undefined}
      aria-label={typeof text === 'string' ? `状态：${text}` : undefined}
      data-status={key}
      data-risk={isHighRiskStatus(key) ? 'high' : undefined}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-black tracking-[0.12em] ${riskClass} ${toneClass} ${className}`}
    >
      {text}
    </span>
  );
};
