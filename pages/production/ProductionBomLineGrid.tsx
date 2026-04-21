import React, { useState } from 'react';
import { ChevronRight, ClipboardPaste, CopyPlus, Plus, Rows4, Trash2 } from 'lucide-react';
import { ActionToolbar } from '../../components/ui';

export type BomItemDraft = {
  materialName: string;
  materialCode: string;
  ingredientRole: string;
  dosageMode: string;
  percentage: string;
  quantityPerUnit: string;
  unit: string;
  lossRate: string;
  allowedVarianceRate: string;
  processStage: string;
  substituteGroup: string;
  yieldContribution: string;
  notes: string;
};

type Props = {
  items: BomItemDraft[];
  setItems: React.Dispatch<React.SetStateAction<BomItemDraft[]>>;
  standardBatchSize: number;
};

const baseInputClass =
  'w-full bg-transparent px-2 py-1 text-xs font-bold outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-100 dark:focus:bg-slate-900 border-none';
const baseSelectClass =
  'w-full bg-transparent px-2 py-1 text-xs font-bold outline-none border-none cursor-pointer';

const CHEMICAL_ROLE_OPTIONS = [
  { value: 'main_resin', label: '主树脂' },
  { value: 'modifier_resin', label: '改性树脂' },
  { value: 'tackifier', label: '增粘剂' },
  { value: 'curing_agent', label: '固化剂' },
  { value: 'crosslinker', label: '交联剂' },
  { value: 'solvent', label: '溶剂' },
  { value: 'diluent', label: '稀释剂/水' },
  { value: 'pigment', label: '颜填料' },
  { value: 'surfactant', label: '润湿/分散剂' },
  { value: 'defoamer', label: '消泡剂' },
  { value: 'thickener', label: '增稠/流变剂' },
  { value: 'preservative', label: '防腐/稳定剂' },
  { value: 'ph_adjuster', label: 'pH调节剂' },
  { value: 'catalyst', label: '催化/引发剂' },
  { value: 'additive', label: '助剂' },
  { value: 'recycled', label: '回用料' },
  { value: 'package', label: '包材' },
  { value: 'other', label: '其他' },
] as const;

const DOSAGE_MODE_OPTIONS = [
  { value: 'fixed', label: '固定单耗' },
  { value: 'percentage', label: '按百分比' },
] as const;

type ChemicalRoleValue = (typeof CHEMICAL_ROLE_OPTIONS)[number]['value'];
type DosageModeValue = (typeof DOSAGE_MODE_OPTIONS)[number]['value'];

const ROLE_VALUE_SET = new Set(CHEMICAL_ROLE_OPTIONS.map((option) => option.value));
const DOSAGE_VALUE_SET = new Set(DOSAGE_MODE_OPTIONS.map((option) => option.value));

const ROLE_VALUE_ALIASES: Record<string, ChemicalRoleValue> = {
  主树脂: 'main_resin',
  改性树脂: 'modifier_resin',
  增粘剂: 'tackifier',
  增粘树脂: 'tackifier',
  固化剂: 'curing_agent',
  交联剂: 'crosslinker',
  溶剂: 'solvent',
  稀释剂: 'diluent',
  水: 'diluent',
  颜填料: 'pigment',
  颜料: 'pigment',
  填料: 'pigment',
  润湿剂: 'surfactant',
  分散剂: 'surfactant',
  表面活性剂: 'surfactant',
  消泡剂: 'defoamer',
  增稠剂: 'thickener',
  流变剂: 'thickener',
  防腐剂: 'preservative',
  稳定剂: 'preservative',
  pH调节剂: 'ph_adjuster',
  酸碱调节: 'ph_adjuster',
  催化剂: 'catalyst',
  引发剂: 'catalyst',
  助剂: 'additive',
  回用料: 'recycled',
  包材: 'package',
  包装: 'package',
  其他: 'other',
};

const DOSAGE_VALUE_ALIASES: Record<string, DosageModeValue> = {
  固定: 'fixed',
  固定单耗: 'fixed',
  固定量: 'fixed',
  百分比: 'percentage',
  按百分比: 'percentage',
};

const normalizeRoleValue = (value?: string): ChemicalRoleValue => {
  const raw = (value || '').trim();
  if (!raw) return 'other';
  if (ROLE_VALUE_SET.has(raw as ChemicalRoleValue)) return raw as ChemicalRoleValue;
  const alias = ROLE_VALUE_ALIASES[raw];
  return alias || 'other';
};

const normalizeDosageValue = (value?: string): DosageModeValue => {
  const raw = (value || '').trim();
  if (!raw) return 'fixed';
  if (DOSAGE_VALUE_SET.has(raw as DosageModeValue)) return raw as DosageModeValue;
  const alias = DOSAGE_VALUE_ALIASES[raw];
  return alias || 'fixed';
};

const createEmptyItem = (): BomItemDraft => ({
  materialName: '',
  materialCode: '',
  ingredientRole: 'main_resin',
  dosageMode: 'fixed',
  percentage: '',
  quantityPerUnit: '',
  unit: 'kg',
  lossRate: '',
  allowedVarianceRate: '',
  processStage: '',
  substituteGroup: '',
  yieldContribution: '',
  notes: '',
});

const GLUE_FORMULA_SKELETON: BomItemDraft[] = [
  { ...createEmptyItem(), ingredientRole: 'main_resin', processStage: '预混', notes: '主体成膜/粘结原料，填写具体牌号' },
  { ...createEmptyItem(), ingredientRole: 'modifier_resin', processStage: '预混', notes: '改性树脂或共聚体系，按实际配方填写' },
  { ...createEmptyItem(), ingredientRole: 'tackifier', processStage: '预混', notes: '提升初粘/持粘，若不用可留空' },
  { ...createEmptyItem(), ingredientRole: 'diluent', processStage: '稀释', notes: '水、溶剂或活性稀释剂' },
  { ...createEmptyItem(), ingredientRole: 'curing_agent', processStage: '后添加', notes: '固化剂，注意适用期和投料时点' },
  { ...createEmptyItem(), ingredientRole: 'crosslinker', processStage: '后添加', notes: '交联剂，可与固化剂分开管理' },
  { ...createEmptyItem(), ingredientRole: 'pigment', processStage: '分散', notes: '填料/颜料/粉体，关注分散和沉降' },
  { ...createEmptyItem(), ingredientRole: 'surfactant', processStage: '分散', notes: '润湿、分散或乳化助剂' },
  { ...createEmptyItem(), ingredientRole: 'defoamer', processStage: '调漆', notes: '消泡剂，通常小比例后添加' },
  { ...createEmptyItem(), ingredientRole: 'thickener', processStage: '调粘', notes: '增稠/流变控制，影响施工手感' },
];

const getPasteLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0);

export const ProductionBomLineGrid: React.FC<Props> = ({ items, setItems, standardBatchSize }) => {
  const [pasteText, setPasteText] = useState('');
  const [showPastePanel, setShowPastePanel] = useState(false);
  const filledLineCount = items.filter((item) => item.materialName.trim() || item.materialCode.trim()).length;
  const percentageTotal = items.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
  const hasPercentageRows = items.some((item) => normalizeDosageValue(item.dosageMode) === 'percentage');
  const lineCountWarning = filledLineCount > 0 && filledLineCount < 10;
  const percentageWarning = hasPercentageRows && Math.abs(percentageTotal - 100) > 0.01;

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
      const hasRealRows = prev.some((item) => item.materialName.trim() || item.materialCode.trim());
      return hasRealRows ? [...prev, ...GLUE_FORMULA_SKELETON] : GLUE_FORMULA_SKELETON.map((item) => ({ ...item }));
    });
  };

  const ensureTenRows = () => {
    setItems((prev) => {
      if (prev.length >= 10) return prev;
      return [...prev, ...Array.from({ length: 10 - prev.length }, createEmptyItem)];
    });
  };

  const handlePasteImport = () => {
    const lines = getPasteLines(pasteText);
    const importedItems: BomItemDraft[] = lines.map((line) => {
      const parts = line.split('\t').map((part) => part.trim());
      return {
        materialName: parts[0] || '',
        materialCode: parts[1] || '',
        ingredientRole: normalizeRoleValue(parts[2]),
        dosageMode: normalizeDosageValue(parts[3]),
        percentage: parts[4] || '',
        quantityPerUnit: parts[5] || '',
        unit: parts[6] || 'kg',
        lossRate: parts[7] || '',
        allowedVarianceRate: parts[8] || '',
        processStage: parts[9] || '',
        substituteGroup: parts[10] || '',
        yieldContribution: parts[11] || '',
        notes: parts[12] || '',
      };
    });

    if (importedItems.length > 0) {
      const hasRealRows = items.some((item) => item.materialName.trim() || item.materialCode.trim());
      if (!hasRealRows) {
        setItems(importedItems);
      } else {
        setItems((prev) => [...prev, ...importedItems]);
      }
    }

    setPasteText('');
    setShowPastePanel(false);
  };

  return (
    <div className="app-card p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">BOM 原料明细（双行网格）</h3>
          <p className="mt-2 text-sm text-slate-400">
            胶水/树脂/涂料建议按“至少 10 类原料 + 工艺阶段 + 损耗率”录入；保密原料可只填代号，不必暴露真实名称。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              已填 {filledLineCount} 种原料
            </span>
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${lineCountWarning ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
              胶水建议 {'>='} 10 种
            </span>
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${percentageWarning ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'}`}>
              百分比合计 {percentageTotal.toFixed(2)}%
            </span>
            {standardBatchSize > 0 ? (
              <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white dark:bg-white dark:text-slate-900">
                标准批量 {standardBatchSize}
              </span>
            ) : null}
          </div>
        </div>
        <ActionToolbar
          className="xl:flex-none"
          actions={[
            { label: '胶水10原料骨架', onClick: applyGlueSkeleton, tone: 'success', testId: 'production-bom-apply-glue-skeleton' },
            { label: '补齐10行', onClick: ensureTenRows, tone: 'neutral', testId: 'production-bom-ensure-ten-rows' },
            { label: '新增明细', onClick: addItem, tone: 'primary', icon: <Plus size={14} />, testId: 'production-bom-add-line' },
            { label: '粘贴 Excel', onClick: () => setShowPastePanel((prev) => !prev), tone: 'neutral', icon: <ClipboardPaste size={14} />, testId: 'production-bom-open-paste-panel' },
          ]}
        />
      </div>

      {showPastePanel && (
        <div className="mb-5 rounded-[24px] border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-900/10">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
            <Rows4 size={14} />
            Excel 粘贴区
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            建议按以下顺序粘贴：物料名、保密代号/编码、角色、剂量模式、百分比、单耗、单位、损耗率、允许偏差%、工艺阶段、替代组、收率、备注。若物料名留空，系统会用代号保存该行。
          </p>
          <textarea
            data-testid="production-bom-paste-textarea"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'\tR-001\tmain_resin\tpercentage\t35\t350\tkg\t2\t3\t预混\t\t\t保密原料可只填代号'}
            className="mt-3 h-28 w-full rounded-[20px] border border-blue-100 bg-white px-4 py-3 font-mono text-xs outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900"
          />
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
              智能导入
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-[24px] border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
        <table data-testid="production-bom-line-grid" className="min-w-[1180px] w-full border-collapse">
          <thead>
            <tr>
              <th className="w-10 whitespace-nowrap border-b border-slate-200 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:border-slate-700">#</th>
              <th className="whitespace-nowrap border-b border-slate-200 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:border-slate-700">复合明细（双行布局）</th>
              <th className="w-44 whitespace-nowrap border-b border-slate-200 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:border-slate-700">百分比 / 单耗 / 单位</th>
              <th className="w-32 whitespace-nowrap border-b border-slate-200 px-2 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:border-slate-700">损耗 / 偏差 %</th>
              <th className="w-24 whitespace-nowrap border-b border-slate-200 px-2 py-3 text-center text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:border-slate-700">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const roleValue = normalizeRoleValue(item.ingredientRole);
              const dosageValue = normalizeDosageValue(item.dosageMode);
              const percentageValue = Number(item.percentage || 0);
              const derivedQuantity =
                standardBatchSize > 0 && dosageValue === 'percentage' && percentageValue > 0
                  ? ((standardBatchSize * percentageValue) / 100).toFixed(4)
                  : '';

              return (
                <tr
                  key={index}
                  data-testid={`production-bom-line-row-${index}`}
                  className="group border-b border-slate-200 transition-colors hover:bg-white dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <td className="px-2 py-3 align-top text-xs font-black text-slate-400">{index + 1}</td>
                  <td className="px-2 py-2">
                    <div className="flex w-full flex-col gap-1">
                      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white transition-all focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 dark:border-slate-700 dark:bg-slate-900">
                        <div className="w-1/2 border-r border-slate-100 dark:border-slate-800">
                          <input
                            value={item.materialName}
                            onChange={(e) => updateItem(index, { materialName: e.target.value })}
                            placeholder="物料名称（可留空）"
                            className={baseInputClass}
                          />
                        </div>
                        <div className="w-1/4 border-r border-slate-100 dark:border-slate-800">
                          <input
                            value={item.materialCode}
                            onChange={(e) => updateItem(index, { materialCode: e.target.value })}
                            placeholder="代号/编码 *"
                            className={baseInputClass}
                          />
                        </div>
                        <div className="w-1/4">
                          <select
                            value={roleValue}
                            onChange={(e) => updateItem(index, { ingredientRole: normalizeRoleValue(e.target.value) })}
                            className={baseSelectClass}
                          >
                            {CHEMICAL_ROLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 opacity-70 transition-opacity group-hover:opacity-100">
                        <ChevronRight size={12} className="flex-shrink-0 text-slate-400" />
                        <select
                          value={dosageValue}
                          onChange={(e) => updateItem(index, { dosageMode: normalizeDosageValue(e.target.value) })}
                          className="w-24 rounded-md bg-transparent px-1 py-1 text-[11px] font-bold outline-none focus:bg-white focus:text-blue-600 dark:focus:bg-slate-900 dark:focus:text-blue-400"
                        >
                          {DOSAGE_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={item.processStage}
                          onChange={(e) => updateItem(index, { processStage: e.target.value })}
                          placeholder="工艺阶段"
                          className="w-24 bg-transparent text-[11px] outline-none text-slate-500 focus:text-blue-600 dark:focus:text-blue-400"
                        />
                        <input
                          value={item.substituteGroup}
                          onChange={(e) => updateItem(index, { substituteGroup: e.target.value })}
                          placeholder="替代组"
                          className="w-20 bg-transparent text-[11px] outline-none text-slate-500 focus:text-blue-600 dark:focus:text-blue-400"
                        />
                        <input
                          value={item.yieldContribution}
                          onChange={(e) => updateItem(index, { yieldContribution: e.target.value })}
                          placeholder="收率贡献%"
                          className="w-20 bg-transparent text-[11px] outline-none text-slate-500 focus:text-blue-600 dark:focus:text-blue-400"
                        />
                        <input
                          value={item.notes}
                          onChange={(e) => updateItem(index, { notes: e.target.value })}
                          placeholder="备注"
                          className="min-w-[150px] flex-1 bg-transparent text-[11px] outline-none text-slate-500 focus:text-blue-600 dark:focus:text-blue-400"
                        />
                      </div>
                    </div>
                  </td>

                  <td className="px-2 py-2 align-top">
                    <div className="flex flex-col gap-1">
                      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                        <input
                          value={item.percentage}
                          onChange={(e) => updateItem(index, { percentage: e.target.value })}
                          placeholder={dosageValue === 'percentage' ? '百分比' : '比例/备用'}
                          className={`${baseInputClass} w-16 border-r border-slate-100 text-center dark:border-slate-800`}
                        />
                        <input
                          value={item.quantityPerUnit}
                          onChange={(e) => updateItem(index, { quantityPerUnit: e.target.value })}
                          placeholder="单耗"
                          className={`${baseInputClass} flex-1 border-r border-slate-100 text-center dark:border-slate-800`}
                        />
                        <input
                          value={item.unit}
                          onChange={(e) => updateItem(index, { unit: e.target.value })}
                          placeholder="单位"
                          className={`${baseInputClass} w-12 text-center`}
                        />
                      </div>
                      {dosageValue === 'percentage' && standardBatchSize > 0 && percentageValue > 0 && (
                        <button
                          type="button"
                          onClick={() => updateItem(index, { quantityPerUnit: derivedQuantity })}
                          className="rounded bg-blue-50 px-2 py-1 text-left text-[10px] text-blue-500 hover:text-blue-700 dark:bg-blue-900/30"
                        >
                          按批量换算单耗 {derivedQuantity}
                        </button>
                      )}
                    </div>
                  </td>

                  <td className="px-2 py-2 align-top">
                    <div className="flex flex-col gap-1">
                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                        <input
                          value={item.lossRate}
                          onChange={(e) => updateItem(index, { lossRate: e.target.value })}
                          placeholder="损耗"
                          className={`${baseInputClass} text-center`}
                        />
                      </div>
                      <div className="overflow-hidden rounded-lg border border-emerald-100 bg-white p-0.5 dark:border-emerald-900/40 dark:bg-slate-900">
                      <input
                        value={item.allowedVarianceRate}
                        onChange={(e) => updateItem(index, { allowedVarianceRate: e.target.value })}
                        placeholder="偏差"
                        className={`${baseInputClass} text-center`}
                      />
                      </div>
                      <div className="px-1 text-[10px] font-bold text-slate-400">留空按角色默认</div>
                    </div>
                  </td>

                  <td className="px-2 py-3 align-top text-center">
                    <div className="flex justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => duplicateItem(index)}
                        className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        title="复制一行"
                      >
                        <CopyPlus size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="rounded-xl border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/20"
                        title="删除一行"
                      >
                        <Trash2 size={14} />
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
