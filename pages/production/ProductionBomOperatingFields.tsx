import React from 'react';
import type { BomItemDraft } from './productionBomLineModel';

type BomOperatingMetrics = {
  effectiveBatchQuantity: number;
  shortageQuantity: number;
  lineCost: number;
  riskCodes: string[];
};

type SummaryOptions = {
  standardBatchSize: number;
  materialCodeCounts: Map<string, number>;
  hasItemIdentity: (item: BomItemDraft) => boolean;
  getEffectiveQuantity: (item: BomItemDraft) => number;
};

type MetricsOptions = {
  item: BomItemDraft;
  standardBatchSize: number;
  effectiveQuantity: number;
  isInvalidDraftLine: boolean;
  materialCodeCount: number;
};

type Props = {
  rowIndex: number;
  item: BomItemDraft;
  inputClassName: string;
  metrics: BomOperatingMetrics;
  onChange: (patch: Partial<BomItemDraft>) => void;
};

const RISK_LABELS: Record<string, string> = {
  missing_quantity: '缺少单耗',
  high_loss: '损耗高',
  high_variance: '偏差高',
  stock_shortage: '库存不足',
  missing_stage: '缺少工序',
  duplicate_code: '编码重复',
};

const toFiniteNumber = (value: string | number | null | undefined) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value: number, precision: number) => Number(value.toFixed(precision)).toLocaleString();

export const getBomOperatingMetrics = ({
  item,
  standardBatchSize,
  effectiveQuantity,
  isInvalidDraftLine,
  materialCodeCount,
}: MetricsOptions): BomOperatingMetrics => {
  const lossRate = toFiniteNumber(item.lossRate);
  const varianceRate = toFiniteNumber(item.allowedVarianceRate);
  const batchQuantity = effectiveQuantity > 0 && standardBatchSize > 0 ? effectiveQuantity * standardBatchSize : 0;
  const effectiveBatchQuantity = batchQuantity * (1 + Math.max(0, lossRate) / 100);
  const availableStock = Math.max(0, toFiniteNumber(item.availableStock) - toFiniteNumber(item.lockedStock));
  const shortageQuantity = Math.max(0, effectiveBatchQuantity - availableStock);
  const unitCost = Math.max(0, toFiniteNumber(item.unitCost));
  const lineCost = effectiveBatchQuantity * unitCost;
  const hasIdentity = Boolean(item.materialName.trim() || item.materialCode.trim());
  const riskCodes = [
    isInvalidDraftLine ? 'missing_quantity' : '',
    lossRate > 8 ? 'high_loss' : '',
    varianceRate > 5 ? 'high_variance' : '',
    hasIdentity && effectiveBatchQuantity > 0 && shortageQuantity > 0 ? 'stock_shortage' : '',
    hasIdentity && !item.processStage.trim() ? 'missing_stage' : '',
    item.materialCode.trim() && materialCodeCount > 1 ? 'duplicate_code' : '',
  ].filter(Boolean);

  return { effectiveBatchQuantity, shortageQuantity, lineCost, riskCodes };
};

export const getBomOperatingSummary = (items: BomItemDraft[], options: SummaryOptions) =>
  items.reduce(
    (summary, item) => {
      if (!options.hasItemIdentity(item)) return summary;
      const code = item.materialCode.trim();
      const metrics = getBomOperatingMetrics({
        item,
        standardBatchSize: options.standardBatchSize,
        effectiveQuantity: options.getEffectiveQuantity(item),
        isInvalidDraftLine: false,
        materialCodeCount: code ? options.materialCodeCounts.get(code) || 0 : 0,
      });
      return {
        riskLineCount: summary.riskLineCount + (metrics.riskCodes.length ? 1 : 0),
        shortageLineCount: summary.shortageLineCount + (metrics.shortageQuantity > 0 ? 1 : 0),
        totalCost: summary.totalCost + metrics.lineCost,
      };
    },
    { riskLineCount: 0, shortageLineCount: 0, totalCost: 0 },
  );

export const ProductionBomOperatingFields: React.FC<Props> = ({
  rowIndex,
  item,
  inputClassName,
  metrics,
  onChange,
}) => (
  <td className="px-2 py-2 align-top">
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-3 gap-1">
        <input
          data-testid={`production-bom-row-${rowIndex}-available-stock`}
          aria-label={`BOM 第 ${rowIndex + 1} 行可用库存`}
          title={`BOM 第 ${rowIndex + 1} 行可用库存`}
          value={item.availableStock || ''}
          onChange={(e) => onChange({ availableStock: e.target.value })}
          placeholder="可用"
          className={`${inputClassName} min-h-8 rounded-lg border border-slate-200 bg-white text-right dark:border-slate-700 dark:bg-slate-900`}
        />
        <input
          data-testid={`production-bom-row-${rowIndex}-locked-stock`}
          aria-label={`BOM 第 ${rowIndex + 1} 行锁定库存`}
          title={`BOM 第 ${rowIndex + 1} 行锁定库存`}
          value={item.lockedStock || ''}
          onChange={(e) => onChange({ lockedStock: e.target.value })}
          placeholder="锁定"
          className={`${inputClassName} min-h-8 rounded-lg border border-slate-200 bg-white text-right dark:border-slate-700 dark:bg-slate-900`}
        />
        <input
          data-testid={`production-bom-row-${rowIndex}-unit-cost`}
          aria-label={`BOM 第 ${rowIndex + 1} 行单位成本`}
          title={`BOM 第 ${rowIndex + 1} 行单位成本`}
          value={item.unitCost || ''}
          onChange={(e) => onChange({ unitCost: e.target.value })}
          placeholder="单价"
          className={`${inputClassName} min-h-8 rounded-lg border border-slate-200 bg-white text-right dark:border-slate-700 dark:bg-slate-900`}
        />
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs font-black">
        <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          批量 {formatNumber(metrics.effectiveBatchQuantity, 4)}
        </span>
        <span className={`rounded-lg px-2 py-1 ${metrics.shortageQuantity > 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
          缺口 {formatNumber(metrics.shortageQuantity, 4)}
        </span>
        <span className="rounded-lg bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
          成本 {formatNumber(metrics.lineCost, 2)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {metrics.riskCodes.length ? metrics.riskCodes.map((code) => (
          <span key={code} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
            {RISK_LABELS[code] || code}
          </span>
        )) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">正常</span>
        )}
      </div>
    </div>
  </td>
);
