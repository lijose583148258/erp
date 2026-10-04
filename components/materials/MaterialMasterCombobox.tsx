import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, LoaderCircle, Search, X } from 'lucide-react';
import { materialService, type MaterialCategory, type MaterialMaster } from '../../services/material.service';

type Props = {
  value: string;
  selectedMaterialId: number | null;
  onTextChange: (value: string) => void;
  onSelect: (material: MaterialMaster) => void;
  onClearSelection: () => void;
  error?: string;
  dataTestId?: string;
  label?: string;
  required?: boolean;
  hideLabel?: boolean;
  compactStatus?: boolean;
  allowedCategories?: MaterialCategory[];
};

export function MaterialMasterCombobox({
  value,
  selectedMaterialId,
  onTextChange,
  onSelect,
  onClearSelection,
  error,
  dataTestId = 'material-master-combobox',
  label = '采购物料',
  required = true,
  hideLabel = false,
  compactStatus = false,
  allowedCategories,
}: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MaterialMaster[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const [queryFailed, setQueryFailed] = useState(false);

  const eligibleResults = results.filter(item => (
    item.status === 'active'
    && !item.isTemporary
    && (!allowedCategories?.length || allowedCategories.includes(item.category))
  ));

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const positionPopup = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const targetWidth = Math.min(Math.max(rect.width, 320), window.innerWidth - margin * 2);
      const roomBelow = window.innerHeight - rect.bottom - margin;
      const roomAbove = rect.top - margin;
      const placeBelow = roomBelow >= 180 || roomBelow >= roomAbove;
      const available = Math.max(96, (placeBelow ? roomBelow : roomAbove) - margin);
      const maxHeight = Math.min(288, available);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - targetWidth - margin));
      const top = placeBelow
        ? rect.bottom + margin
        : Math.max(margin, rect.top - maxHeight - margin);
      setPopupStyle({ left, top, width: targetWidth, maxHeight });
    };
    positionPopup();
    window.addEventListener('resize', positionPopup);
    window.addEventListener('scroll', positionPopup, true);
    return () => {
      window.removeEventListener('resize', positionPopup);
      window.removeEventListener('scroll', positionPopup, true);
    };
  }, [open, results.length]);

  useEffect(() => {
    if (!open || selectedMaterialId || !value.trim()) {
      setResults([]);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setQueryFailed(false);
      try {
        const response = await materialService.search(value.trim(), { signal: controller.signal });
        if (!controller.signal.aborted) {
          setResults(response.items || []);
          setActiveIndex(-1);
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setQueryFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, selectedMaterialId, value]);

  const choose = (material: MaterialMaster) => {
    onSelect(material);
    setOpen(false);
    setResults([]);
    setActiveIndex(-1);
  };

  return (
    <div ref={rootRef} className="relative">
      {!hideLabel ? (
        <label htmlFor={`${listboxId}-input`} className="mb-1.5 block text-xs font-black text-slate-700 dark:text-slate-200">
          {label} {required ? <span className="text-rose-500">*</span> : null}
        </label>
      ) : null}
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          data-testid={dataTestId}
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-busy={loading}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          value={value}
          title={value || undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            if (selectedMaterialId) onClearSelection();
            onTextChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(index => Math.min(index + 1, eligibleResults.length - 1));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex(index => Math.max(index - 1, 0));
              return;
            }
            if (event.key === 'Enter' && activeIndex >= 0 && eligibleResults[activeIndex]) {
              event.preventDefault();
              choose(eligibleResults[activeIndex]);
            }
          }}
          placeholder="输入物料编码、名称或 CAS 号"
          className={`app-control w-full pl-9 pr-10 text-sm font-bold ${
            error ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-200' : ''
          }`}
        />
        {loading ? (
          <LoaderCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-500 motion-reduce:animate-none" />
        ) : selectedMaterialId ? (
          <button
            type="button"
            aria-label="解除统一物料关联"
            onClick={onClearSelection}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-emerald-600 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-1 text-xs font-bold text-rose-600">{error}</p> : null}
      <div aria-live="polite" className={`mt-1.5 flex items-center gap-1.5 font-bold ${compactStatus ? 'text-[10px] leading-4' : 'text-xs'} ${selectedMaterialId ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
        {selectedMaterialId ? <CheckCircle2 size={13} /> : null}
        {selectedMaterialId
          ? (compactStatus ? `已关联 #${selectedMaterialId}` : `已关联统一物料 #${selectedMaterialId}；名称和单位随主数据锁定`)
          : (compactStatus ? '未关联：按历史文本保存' : '尚未关联主数据；历史兼容模式可保存，但收货前建议完成归档')}
      </div>

      {open && !selectedMaterialId && value.trim() ? createPortal((
        <div
          ref={popupRef}
          id={listboxId}
          role="listbox"
          style={popupStyle}
          className="fixed z-[100] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          {eligibleResults.map((material, index) => (
            <button
              id={`${listboxId}-option-${index}`}
              key={material.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(material)}
              className={`flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                index === activeIndex ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-slate-900 dark:text-white">
                  {material.code} · {material.nameZh}
                </span>
                <span className="mt-1 block truncate text-xs font-semibold text-slate-500">
                  {[material.specification, material.casNumber].filter(Boolean).join(' · ') || '无补充规格'}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                {material.baseUnit}
              </span>
            </button>
          ))}
          {!loading && queryFailed ? (
            <div role="status" className="px-3 py-4 text-xs font-bold leading-5 text-rose-600 dark:text-rose-300">
              物料查询暂时失败。输入内容仍保留，请稍后重试；不要凭记忆选择相似物料。
            </div>
          ) : !loading && eligibleResults.length === 0 ? (
            <div className="px-3 py-4 text-xs font-bold leading-5 text-slate-500">
              没有可用的正式物料。请换关键词，或先到“统一物料”完成启用与单位确认。
            </div>
          ) : null}
        </div>
      ), document.body) : null}
    </div>
  );
}
