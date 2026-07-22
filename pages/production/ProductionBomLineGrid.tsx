import React, { useState } from 'react';
import { ClipboardPaste, CopyPlus, Plus, Rows4, Trash2 } from 'lucide-react';
import { ActionToolbar } from '../../components/ui';
import { getBomOperatingMetrics, getBomOperatingSummary, ProductionBomOperatingFields } from './ProductionBomOperatingFields';
import {
  CHEMICAL_ROLE_OPTIONS,
  DOSAGE_MODE_OPTIONS,
  GLUE_FORMULA_SKELETON,
  cloneItem,
  createEmptyItem,
  formatDecimal,
  getEffectiveBomQuantityPerUnit,
  getPerUnitFromPercentage,
  hasItemIdentity,
  isEffectiveBomItemDraft,
  normalizeDosageValue,
  normalizeRoleValue,
  parseBomPasteText,
  toFiniteNumber,
  type BomItemDraft,
} from './productionBomLineModel';

export {
  getEffectiveBomQuantityPerUnit,
  isEffectiveBomItemDraft,
} from './productionBomLineModel';
export type { BomItemDraft } from './productionBomLineModel';
type Props = {
  items: BomItemDraft[];
  setItems: React.Dispatch<React.SetStateAction<BomItemDraft[]>>;
  standardBatchSize: number;
};
const baseInputClass =
  'w-full bg-transparent px-2 py-1 text-xs font-bold outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-100 dark:focus:bg-slate-900 border-none';
const commonInputClass = 'w-full rounded-md border border-slate-200/80 bg-white px-2 py-1.5 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-900/30';
const commonSelectClass = 'w-full rounded-md border border-slate-200/80 bg-white px-1 py-1.5 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-blue-900/30 cursor-pointer';
export const ProductionBomLineGrid: React.FC<Props> = ({ items, setItems, standardBatchSize }) => {
  const [pasteText, setPasteText] = useState('');
  const [showPastePanel, setShowPastePanel] = useState(false);
  const [pasteImportNotice, setPasteImportNotice] = useState('');
  const filledLineCount = items.filter(hasItemIdentity).length;
  const effectiveLineCount = items.filter(isEffectiveBomItemDraft).length;
  const invalidDraftLineCount = Math.max(0, filledLineCount - effectiveLineCount);
  const effectiveItems = items.filter(isEffectiveBomItemDraft);
  const percentageTotal = effectiveItems.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
  const hasPercentageRows = effectiveItems.some((item) => normalizeDosageValue(item.dosageMode) === 'percentage');
  const lineCountWarning = effectiveLineCount < 10;
  const percentageWarning = hasPercentageRows && Math.abs(percentageTotal - 100) > 0.01;
  const materialCodeCounts = new Map<string, number>();
  items.forEach((item) => {
    const code = item.materialCode.trim();
    if (code) materialCodeCounts.set(code, (materialCodeCounts.get(code) || 0) + 1);
  });
  const operatingSummary = getBomOperatingSummary(items, {
    standardBatchSize,
    materialCodeCounts,
    hasItemIdentity,
    getEffectiveQuantity: getEffectiveBomQuantityPerUnit,
  });
  const updateItem = (index: number, patch: Partial<BomItemDraft>) => {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const addItem = () => {
    setItems((prev) => [...prev, createEmptyItem()]);
  };
  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((_, i) => i !== index));
    }
  };
  const duplicateItem = (index: number) => {
    setItems((prev) => {
      const clone = { ...prev[index] };
      const next = [...prev];
      next.splice(index + 1, 0, clone);
      return next;
    });
  };
  const applyGlueSkeleton = () => {
    setItems((prev) => {
      const filledRows = prev.filter(hasItemIdentity);
      if (filledRows.length >= 10) return filledRows;
      const usedRoles = new Set(filledRows.map((item) => normalizeRoleValue(item.ingredientRole)));
      const missingSkeletonRows = GLUE_FORMULA_SKELETON
        .filter((item) => !usedRoles.has(normalizeRoleValue(item.ingredientRole)))
        .slice(0, 10 - filledRows.length)
        .map(cloneItem);
      const mergedRows = [...filledRows, ...missingSkeletonRows];
      return mergedRows.length > 0 ? mergedRows : GLUE_FORMULA_SKELETON.map(cloneItem);
    });
  };
  const ensureTenRows = () => {
    setItems((prev) => {
      if (prev.length >= 10) return prev;
      return [...prev, ...Array.from({ length: 10 - prev.length }, createEmptyItem)];
    });
  };
  const handlePasteImport = () => {
    const { importedItems, conversionNotices } = parseBomPasteText(pasteText, standardBatchSize);
    if (importedItems.length > 0) {
      const hasRealRows = items.some((item) => item.materialName.trim() || item.materialCode.trim());
      if (!hasRealRows) {
        setItems(importedItems);
      } else {
        setItems((prev) => [...prev, ...importedItems]);
      }
    }
    setPasteImportNotice(conversionNotices.join('；'));
    setPasteText('');
  };
  return (
    <div className="app-card p-6">
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">配方原料明细</h3>
          <p className="mt-2 text-sm text-slate-400">
            胶水/树脂/涂料建议按“原料代号 + 配方占比 + 单位单耗 + 工艺阶段”录入。计划配方在这里维护，实际投料在工单完工时确认，避免把计划量误当实耗。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              有效明细 {effectiveLineCount} 行
            </span>
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${lineCountWarning ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
              胶水建议 {'>='} 10 行有效明细
            </span>
            {invalidDraftLineCount > 0 ? (
              <span className="rounded-full bg-rose-100 px-3 py-1 text-[11px] font-black text-rose-700 dark:bg-rose-900/30 dark:text-rose-200">
                {invalidDraftLineCount} 行会被保存过滤：需补单耗或百分比
              </span>
            ) : null}
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${percentageWarning ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'}`}>
              百分比合计 {percentageTotal.toFixed(2)}%
            </span>
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${operatingSummary.riskLineCount ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
              风险行 {operatingSummary.riskLineCount}
            </span>
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${operatingSummary.shortageLineCount ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200'}`}>
              缺料行 {operatingSummary.shortageLineCount}
            </span>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white dark:bg-white dark:text-slate-900">
              理论成本 {operatingSummary.totalCost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
            </span>
            {standardBatchSize > 0 ? (
              <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white dark:bg-white dark:text-slate-900">
                标准批量 {standardBatchSize}
              </span>
            ) : null}
          </div>
        </div>
        <ActionToolbar
          className="w-full"
          actions={[
            { label: '填充明细模板', onClick: applyGlueSkeleton, tone: 'success', testId: 'production-bom-apply-glue-skeleton' },
            { label: '补齐空行到10', onClick: ensureTenRows, tone: 'neutral', testId: 'production-bom-ensure-ten-rows' },
            { label: '新增明细行', onClick: addItem, tone: 'primary', icon: <Plus size={14} />, testId: 'production-bom-add-line' },
            { label: '粘贴明细行', onClick: () => setShowPastePanel((prev) => !prev), tone: 'neutral', icon: <ClipboardPaste size={14} />, testId: 'production-bom-open-paste-panel' },
          ]}
        />
      </div>
      {showPastePanel && (
        <div className="mb-5 rounded-[24px] border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-900/10">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
            <Rows4 size={14} />
            当前 BOM 草稿明细粘贴区
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            建议按以下顺序粘贴：物料名、保密代号/编码、角色、剂量模式、百分比、单位单耗、单位、损耗率、允许偏差%、工艺阶段、替代组、收率、备注。百分比配方若粘贴的是标准批量用量，系统会按标准批量自动换算成单位单耗。
          </p>
          <textarea
            data-testid="production-bom-paste-textarea"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'\tR-001\tmain_resin\tpercentage\t35\t350\tkg\t2\t3\t预混\t\t\t保密原料可只填代号'}
            className="mt-3 h-28 w-full rounded-[20px] border border-blue-100 bg-white px-4 py-3 font-mono text-xs outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
          />
          {pasteImportNotice ? (
            <div data-testid="production-bom-paste-notice" className="mt-3 rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold leading-6 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-200 whitespace-pre-line">
              {pasteImportNotice}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPastePanel(false)}
              className="rounded-[16px] bg-white px-4 py-2 text-xs font-black tracking-[0.16em] text-slate-500 dark:bg-slate-800 dark:text-slate-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handlePasteImport}
              data-testid="production-bom-apply-paste"
              className="rounded-[16px] bg-blue-600 px-4 py-2 text-xs font-black tracking-[0.16em] text-white"
            >
              导入明细行到当前 BOM 草稿
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-[24px] border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
        <table data-testid="production-bom-line-grid" className="w-full min-w-max border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">#</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">物料名</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">保密代号/编码*</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">角色</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">剂量模式</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">百分比%</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">单位单耗</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">单位</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">损耗率%</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">允许偏差%</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">工艺阶段</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">替代组</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">收率%</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400">备注</th>
              <th className="sticky top-0 z-20 bg-slate-50/95 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm dark:bg-slate-800/95 dark:text-slate-400 min-w-[280px]">库存/成本/风险状态</th>
              <th className="sticky right-0 top-0 z-30 bg-slate-50/95 px-2 py-3 text-center text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm shadow-[-10px_0_16px_-14px_rgba(15,23,42,0.55)] dark:bg-slate-800/95 dark:text-slate-400 w-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item, index) => {
              const roleValue = normalizeRoleValue(item.ingredientRole);
              const dosageValue = normalizeDosageValue(item.dosageMode);
              const percentageValue = toFiniteNumber(item.percentage);
              const hasIdentity = hasItemIdentity(item);
              const effectiveQuantity = getEffectiveBomQuantityPerUnit(item);
              const isInvalidDraftLine = hasIdentity && effectiveQuantity <= 0;
              const autoUnitConsumption =
                dosageValue === 'percentage' && percentageValue > 0
                  ? formatDecimal(getPerUnitFromPercentage(percentageValue))
                  : '';
              const standardBatchQuantity =
                dosageValue === 'percentage' && percentageValue > 0 && standardBatchSize > 0
                  ? formatDecimal((standardBatchSize * percentageValue) / 100)
                  : '';
              const materialCode = item.materialCode.trim();
              const operatingMetrics = getBomOperatingMetrics({
                item,
                standardBatchSize,
                effectiveQuantity,
                isInvalidDraftLine,
                materialCodeCount: materialCode ? materialCodeCounts.get(materialCode) || 0 : 0,
              });
              const displayQuantityPerUnit = dosageValue === 'percentage' && percentageValue > 0 ? autoUnitConsumption : item.quantityPerUnit;
              return (
                <tr
                  key={index}
                  data-testid={`production-bom-line-row-${index}`}
                  className={`group transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/30 ${isInvalidDraftLine ? 'bg-rose-50/50 dark:bg-rose-950/20' : 'bg-white dark:bg-slate-900/40'}`}
                >
                  <td className="px-2 py-2.5 align-middle text-xs font-black text-slate-400">{index + 1}</td>
                  <td className="px-2 py-2.5 align-top min-w-[140px] max-w-[200px]">
                    <input
                      data-testid={`production-bom-row-${index}-material-name`}
                      value={item.materialName}
                      onChange={(e) => updateItem(index, { materialName: e.target.value })}
                      placeholder="物料名(可选)"
                      className={commonInputClass}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[130px] max-w-[180px]">
                    <input
                      data-testid={`production-bom-row-${index}-material-code`}
                      value={item.materialCode}
                      onChange={(e) => updateItem(index, { materialCode: e.target.value })}
                      placeholder="代号 *"
                      className={`${commonInputClass} border-blue-200 focus:border-blue-500 dark:border-blue-900/50`}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[110px]">
                    <select
                      data-testid={`production-bom-row-${index}-ingredient-role`}
                      aria-label={`BOM 第 ${index + 1} 行原料角色`}
                      title={`BOM 第 ${index + 1} 行原料角色`}
                      value={roleValue}
                      onChange={(e) => updateItem(index, { ingredientRole: normalizeRoleValue(e.target.value) })}
                      className={commonSelectClass}
                    >
                      {CHEMICAL_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[100px]">
                    <select
                      data-testid={`production-bom-row-${index}-dosage-mode`}
                      aria-label={`BOM 第 ${index + 1} 行用量模式`}
                      title={`BOM 第 ${index + 1} 行用量模式`}
                      value={dosageValue}
                      onChange={(e) => {
                        const newMode = normalizeDosageValue(e.target.value);
                        updateItem(index, { dosageMode: newMode });
                      }}
                      className={commonSelectClass}
                    >
                      {DOSAGE_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[90px]">
                    <div className="relative">
                      <input
                        data-testid={`production-bom-row-${index}-percentage`}
                        value={item.percentage}
                        onChange={(e) => updateItem(index, { percentage: e.target.value })}
                        onBlur={() => {
                          if (dosageValue === 'percentage' && percentageValue > 0) {
                            updateItem(index, { quantityPerUnit: getPerUnitFromPercentage(percentageValue).toString() });
                          }
                        }}
                        placeholder="%"
                        disabled={dosageValue !== 'percentage'}
                        className={`${commonInputClass} text-right font-mono ${dosageValue !== 'percentage' ? 'bg-slate-50 opacity-40 cursor-not-allowed dark:bg-slate-800' : 'bg-blue-50/30 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800'}`}
                      />
                      {dosageValue === 'percentage' ? (
                        <div className="mt-1 text-[10px] font-bold leading-4 text-blue-600 dark:text-blue-300">
                          配方占比 %
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[100px]">
                    <input
                      data-testid={`production-bom-row-${index}-quantity-per-unit`}
                      value={displayQuantityPerUnit}
                      onChange={(e) => updateItem(index, { quantityPerUnit: e.target.value })}
                      placeholder="单耗"
                      disabled={dosageValue === 'percentage'}
                      className={`${commonInputClass} text-right font-mono ${dosageValue === 'percentage' ? 'bg-slate-50/80 border-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400' : ''}`}
                      title={dosageValue === 'percentage' ? '按百分比自动计算，禁止手动修改' : undefined}
                    />
                      {dosageValue === 'percentage' ? (
                        <>
                          <div className="text-[10px] font-bold leading-4 text-slate-500 dark:text-slate-400">
                            按百分比自动计算，不需要手填
                          </div>
                          <div className="text-[10px] font-bold leading-4 text-blue-600 dark:text-blue-300">
                            自动单位单耗 {autoUnitConsumption || '--'} / 标准批量用量 {standardBatchQuantity ? `${standardBatchQuantity} ${item.unit || 'kg'}` : '--'}
                          </div>
                        </>
                      ) : null}
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[70px]">
                    <input
                      data-testid={`production-bom-row-${index}-unit`}
                      value={item.unit}
                      onChange={(e) => updateItem(index, { unit: e.target.value })}
                      placeholder="单位"
                      className={`${commonInputClass} text-center`}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[80px]">
                    <input
                      data-testid={`production-bom-row-${index}-loss-rate`}
                      value={item.lossRate}
                      onChange={(e) => updateItem(index, { lossRate: e.target.value })}
                      placeholder="%"
                      className={`${commonInputClass} text-right font-mono`}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[80px]">
                    <input
                      data-testid={`production-bom-row-${index}-allowed-variance-rate`}
                      value={item.allowedVarianceRate}
                      onChange={(e) => updateItem(index, { allowedVarianceRate: e.target.value })}
                      placeholder="%"
                      className={`${commonInputClass} text-right font-mono`}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[100px]">
                    <input
                      data-testid={`production-bom-row-${index}-process-stage`}
                      value={item.processStage}
                      onChange={(e) => updateItem(index, { processStage: e.target.value })}
                      placeholder="工序"
                      className={commonInputClass}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[90px]">
                    <input
                      data-testid={`production-bom-row-${index}-substitute-group`}
                      value={item.substituteGroup}
                      onChange={(e) => updateItem(index, { substituteGroup: e.target.value })}
                      placeholder="替代组"
                      className={commonInputClass}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[80px]">
                    <input
                      data-testid={`production-bom-row-${index}-yield-contribution`}
                      value={item.yieldContribution}
                      onChange={(e) => updateItem(index, { yieldContribution: e.target.value })}
                      placeholder="%"
                      className={`${commonInputClass} text-right font-mono`}
                    />
                  </td>
                  <td className="px-2 py-2.5 align-top min-w-[120px]">
                    <input
                      data-testid={`production-bom-row-${index}-notes`}
                      value={item.notes}
                      onChange={(e) => updateItem(index, { notes: e.target.value })}
                      placeholder="备注"
                      className={commonInputClass}
                    />
                  </td>
                  <ProductionBomOperatingFields
                    rowIndex={index}
                    item={item}
                    inputClassName={baseInputClass} // Keep base class for the tiny inputs inside
                    metrics={operatingMetrics}
                    onChange={(patch) => updateItem(index, patch)}
                  />
                  <td className="sticky right-0 z-10 bg-white px-2 py-2.5 align-middle text-center shadow-[-8px_0_15px_-10px_rgba(0,0,0,0.1)] dark:bg-slate-900">
                    <div className="flex justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => duplicateItem(index)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-all dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        title="复制一行"
                      >
                        <CopyPlus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="rounded-lg p-2 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
                        title="删除一行"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
