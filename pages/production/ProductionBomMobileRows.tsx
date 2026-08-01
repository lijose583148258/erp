import React from 'react';
import { CopyPlus, Trash2 } from 'lucide-react';
import {
  CHEMICAL_ROLE_OPTIONS,
  DOSAGE_MODE_OPTIONS,
  formatDecimal,
  getPerUnitFromPercentage,
  normalizeDosageValue,
  normalizeRoleValue,
  toFiniteNumber,
  type BomItemDraft,
} from './productionBomLineModel';
import { MaterialLookupField } from './MaterialLookupField';

type Props = {
  items: BomItemDraft[];
  standardBatchSize: number;
  showAdvanced: boolean;
  activeRowIndex: number | null;
  setActiveRowIndex: (index: number) => void;
  updateItem: (index: number, patch: Partial<BomItemDraft>) => void;
  duplicateItem: (index: number) => void;
  removeItem: (index: number) => void;
};

const inputClass =
 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none transition-[border-color,box-shadow] duration-150 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

function MobileField({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-black text-slate-600 dark:text-slate-300">
        {label}
        {required ? <span className="text-rose-500">必填</span> : null}
      </span>
      {children}
    </label>
  );
}

export function ProductionBomMobileRows({
  items,
  standardBatchSize,
  showAdvanced,
  activeRowIndex,
  setActiveRowIndex,
  updateItem,
  duplicateItem,
  removeItem,
}: Props) {
  return (
 <div data-testid="production-bom-mobile-lines" data-mobile-card-list className="space-y-3 md:hidden">
      {items.map((item, index) => {
        const dosageMode = normalizeDosageValue(item.dosageMode);
        const percentage = toFiniteNumber(item.percentage);
        const autoUnitConsumption =
          dosageMode === 'percentage' && percentage > 0
            ? formatDecimal(getPerUnitFromPercentage(percentage))
            : '';
        const batchQuantity =
          dosageMode === 'percentage' && percentage > 0 && standardBatchSize > 0
            ? formatDecimal((standardBatchSize * percentage) / 100)
            : '';

        return (
          <section
            key={index}
            data-testid={`production-bom-mobile-row-${index}`}
            onFocusCapture={() => setActiveRowIndex(index)}
 className={`rounded-2xl border p-3 transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none ${
              activeRowIndex === index
                ? 'border-blue-300 bg-blue-50/60 ring-2 ring-blue-100 dark:border-blue-800 dark:bg-blue-950/20'
                : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60'
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-white">第 {index + 1} 条原料</div>
                <div className="text-xs font-semibold text-slate-400">本卡片字段只属于这一条明细</div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => duplicateItem(index)}
                  aria-label={`复制第 ${index + 1} 条原料`}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <CopyPlus size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  aria-label={`删除第 ${index + 1} 条原料`}
                  className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <MobileField label="原料代号 / 编码" required>
                  <MaterialLookupField
                    rowNumber={index + 1}
                    materialId={item.materialId ?? null}
                    materialCode={item.materialCode}
                    materialName={item.materialName}
                    onChange={(patch) => updateItem(index, patch)}
                    className={`${inputClass} border-blue-200 dark:border-blue-900/60`}
                    mobile
                  />
                </MobileField>
              </div>
              <div className="col-span-2">
                <MobileField label="原料名称（可稍后补）">
                  <input
                    aria-label={`移动端第 ${index + 1} 条原料的名称`}
                    value={item.materialName}
                    onChange={(event) => updateItem(index, { materialId: null, materialName: event.target.value })}
                    placeholder="保密配方可只填代号"
                    className={inputClass}
                  />
                </MobileField>
              </div>
              <MobileField label="配方角色">
                <select
                  aria-label={`移动端第 ${index + 1} 条原料的配方角色`}
                  value={normalizeRoleValue(item.ingredientRole)}
                  onChange={(event) => updateItem(index, { ingredientRole: normalizeRoleValue(event.target.value) })}
                  className={inputClass}
                >
                  {CHEMICAL_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </MobileField>
              <MobileField label="用量填写方式">
                <select
                  aria-label={`移动端第 ${index + 1} 条原料的用量填写方式`}
                  value={dosageMode}
                  onChange={(event) => updateItem(index, { dosageMode: normalizeDosageValue(event.target.value) })}
                  className={inputClass}
                >
                  {DOSAGE_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </MobileField>
              <MobileField label={dosageMode === 'percentage' ? '配方占比 %' : '每 1 单位成品用量'} required>
                <input
                  inputMode="decimal"
                  aria-label={`移动端第 ${index + 1} 条原料的用量值`}
                  value={dosageMode === 'percentage' ? item.percentage : item.quantityPerUnit}
                  onChange={(event) =>
                    updateItem(
                      index,
                      dosageMode === 'percentage'
                        ? { percentage: event.target.value }
                        : { quantityPerUnit: event.target.value },
                    )
                  }
                  placeholder={dosageMode === 'percentage' ? '例如 35' : '例如 0.35'}
                  className={`${inputClass} text-right font-mono`}
                />
              </MobileField>
              <MobileField label="用量单位">
                <input
                  aria-label={`移动端第 ${index + 1} 条原料的用量单位`}
                  value={item.unit}
                  onChange={(event) => updateItem(index, { unit: event.target.value })}
                  placeholder="kg"
                  className={inputClass}
                />
              </MobileField>
              <div className="col-span-2">
                <MobileField label="投料 / 工艺阶段">
                  <input
                    aria-label={`移动端第 ${index + 1} 条原料的工艺阶段`}
                    value={item.processStage}
                    onChange={(event) => updateItem(index, { processStage: event.target.value })}
                    placeholder="例如：预混、滴加、保温"
                    className={inputClass}
                  />
                </MobileField>
              </div>
            </div>

            {dosageMode === 'percentage' && percentage > 0 ? (
              <div className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
                系统换算：单位单耗 {autoUnitConsumption || '--'}
                {batchQuantity ? `；标准批量用量 ${batchQuantity} ${item.unit || 'kg'}` : ''}
              </div>
            ) : null}

            {showAdvanced ? (
              <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <summary className="cursor-pointer text-xs font-black text-slate-700 dark:text-slate-200">
                  本行高级字段
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {[
                    ['计划损耗 %', 'lossRate'],
                    ['允许偏差 %', 'allowedVarianceRate'],
                    ['替代组', 'substituteGroup'],
                    ['收率贡献 %', 'yieldContribution'],
                  ].map(([label, key]) => (
                    <MobileField key={key} label={label}>
                      <input
                        aria-label={`移动端第 ${index + 1} 条原料的${label}`}
                        value={String(item[key as keyof BomItemDraft] ?? '')}
                        onChange={(event) => updateItem(index, { [key]: event.target.value })}
                        className={inputClass}
                      />
                    </MobileField>
                  ))}
                  <div className="col-span-2">
                    <MobileField label="本行备注">
                      <input
                        aria-label={`移动端第 ${index + 1} 条原料的备注`}
                        value={item.notes}
                        onChange={(event) => updateItem(index, { notes: event.target.value })}
                        className={inputClass}
                      />
                    </MobileField>
                  </div>
                </div>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
