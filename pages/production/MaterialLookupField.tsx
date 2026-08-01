import React, { useEffect, useId, useState } from 'react';
import { CheckCircle2, Link2, LoaderCircle, Search, Unlink } from 'lucide-react';
import { materialService, type MaterialMaster } from '../../services/material.service';

type Props = {
  rowNumber: number;
  materialId: number | null;
  materialCode: string;
  materialName: string;
  onChange: (patch: {
    materialId?: number | null;
    materialCode?: string;
    materialName?: string;
    unit?: string;
  }) => void;
  className: string;
  mobile?: boolean;
};

export function MaterialLookupField({
  rowNumber,
  materialId,
  materialCode,
  materialName,
  onChange,
  className,
  mobile = false,
}: Props) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MaterialMaster[]>([]);
  const [message, setMessage] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectableResults = results.filter(material => material.status !== 'blocked' && material.status !== 'retired');

  useEffect(() => {
    if (!open || materialCode.trim().length < 1 || materialId) {
      setResults([]);
      setActiveIndex(-1);
      setMessage('');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setMessage('');
      try {
        const data = await materialService.search(materialCode.trim(), { signal: controller.signal });
        setResults(data.items || []);
        setActiveIndex(-1);
        if (!data.items?.length) setMessage('未找到统一物料；草稿可继续使用临时文本，正式发布前必须完成归档。');
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setMessage('物料查询失败，可继续填写草稿；请勿在未关联状态下发布配方。');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [materialCode, materialId, open]);

  const selectMaterial = (material: MaterialMaster) => {
    onChange({
      materialId: material.id,
      materialCode: material.code,
      materialName: material.nameZh,
      unit: material.baseUnit,
    });
    setOpen(false);
    setResults([]);
    setActiveIndex(-1);
    setMessage('');
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          data-testid={`${mobile ? 'production-bom-mobile' : 'production-bom'}-row-${rowNumber - 1}-material-code`}
          role="combobox"
          aria-label={`${mobile ? '移动端' : ''}第 ${rowNumber} 条原料的统一物料编码或搜索词`}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          value={materialCode}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange({ materialId: null, materialCode: event.target.value });
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              setActiveIndex(-1);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(index => Math.min(index + 1, selectableResults.length - 1));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => Math.max(0, index - 1));
              return;
            }
            if (event.key === 'Enter' && activeIndex >= 0 && selectableResults[activeIndex]) {
              event.preventDefault();
              selectMaterial(selectableResults[activeIndex]);
            }
          }}
          placeholder="编码 / 名称 / CAS"
          className={`${className} pl-9 pr-9`}
        />
        {loading ? (
          <LoaderCircle size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />
        ) : materialId ? (
          <CheckCircle2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />
        ) : null}
      </div>

      <div className="mt-1 flex items-center gap-1 text-xs font-bold">
        {materialId ? (
          <>
            <Link2 size={12} className="text-emerald-500" />
            <span className="text-emerald-700 dark:text-emerald-300">已关联统一物料 #{materialId}</span>
            <button
              type="button"
              onClick={() => onChange({ materialId: null })}
              className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-rose-500"
            >
              <Unlink size={11} /> 解除
            </button>
          </>
        ) : (
          <span className="text-amber-600 dark:text-amber-300">
            {materialCode || materialName ? '临时文本，尚未关联主数据' : '输入编码、名称或CAS查找'}
          </span>
        )}
      </div>

      {open && !materialId && (results.length > 0 || message) ? (
        <div
          id={listboxId}
          role="listbox"
          className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {results.map(material => {
            const unavailable = material.status === 'blocked' || material.status === 'retired';
            const selectableIndex = selectableResults.findIndex(item => item.id === material.id);
            return (
              <button
                id={selectableIndex >= 0 ? `${listboxId}-option-${selectableIndex}` : undefined}
                key={material.id}
                type="button"
                role="option"
                disabled={unavailable}
                aria-selected={selectableIndex === activeIndex}
                onMouseEnter={() => { if (selectableIndex >= 0) setActiveIndex(selectableIndex); }}
                onClick={() => selectMaterial(material)}
                className="flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-950/30"
              >
                <span>
                  <span className="block text-sm font-black text-slate-800 dark:text-slate-100">{material.code} · {material.nameZh}</span>
                  <span className="block text-xs font-semibold text-slate-400">
                    {[material.nameEn, material.nameVi, material.casNumber, material.specification].filter(Boolean).join(' · ') || '暂无补充名称或规格'}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-black ${
                  material.status === 'active' && !material.isTemporary
                    ? 'bg-emerald-100 text-emerald-700'
                    : unavailable
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700'
                }`}>
                  {unavailable ? '不可用' : material.isTemporary ? '临时' : material.status === 'active' ? '已启用' : '草稿'}
                </span>
              </button>
            );
          })}
          {message ? <div className="px-3 py-2 text-xs font-bold leading-5 text-amber-600">{message}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
