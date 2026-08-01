import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';

export type ColumnVisibilityOption = {
  key: string;
  label: string;
};

type Props = {
  columns: ColumnVisibilityOption[];
  visibleColumnKeys: ReadonlySet<string>;
  onVisibilityChange: (key: string, visible: boolean) => void;
  onReset: () => void;
  className?: string;
};

type MenuPosition = {
  left: number;
  top: number;
};

const VIEWPORT_GAP = 8;
const MENU_WIDTH = 224;

export const ColumnVisibilityMenu: React.FC<Props> = ({
  columns,
  visibleColumnKeys,
  onVisibilityChange,
  onReset,
  className = '',
}) => {
  const generatedId = useId();
  const menuId = `column-visibility-${generatedId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ left: VIEWPORT_GAP, top: VIEWPORT_GAP });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.getBoundingClientRect().height || Math.min(320, 76 + columns.length * 36);
    const availableBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_GAP;
    const availableAbove = triggerRect.top - VIEWPORT_GAP;
    const openAbove = availableBelow < Math.min(menuHeight, 280) && availableAbove > availableBelow;
    const preferredTop = openAbove
      ? triggerRect.top - menuHeight - VIEWPORT_GAP
      : triggerRect.bottom + VIEWPORT_GAP;
    const top = Math.max(VIEWPORT_GAP, Math.min(preferredTop, window.innerHeight - menuHeight - VIEWPORT_GAP));
    const preferredLeft = triggerRect.right - MENU_WIDTH;
    const left = Math.max(VIEWPORT_GAP, Math.min(preferredLeft, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP));
    setPosition({ left, top });
  }, [columns.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleViewportChange = () => updatePosition();
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, updatePosition]);

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="dialog"
      aria-label="选择要显示的表格列"
      data-column-visibility-menu
      className="fixed z-[220] w-56 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      style={{ left: position.left, top: position.top }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-black text-slate-700 dark:text-slate-200">显示列</span>
        <button
          type="button"
          onClick={onReset}
          className="min-h-8 rounded-lg px-2 text-xs font-bold text-blue-600 transition-colors duration-150 hover:bg-blue-50 motion-reduce:transition-none dark:text-blue-300 dark:hover:bg-blue-950/40"
        >
          重置
        </button>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
        {columns.map(column => (
          <label key={column.key} className="flex min-h-9 items-center gap-2 rounded-xl px-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
            <input
              type="checkbox"
              checked={visibleColumnKeys.has(column.key)}
              onChange={event => onVisibilityChange(column.key, event.target.checked)}
              aria-label={`显示列：${column.label}`}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            />
            <span className="truncate" title={column.label}>{column.label}</span>
          </label>
        ))}
      </div>
    </div>
  ) : null;
  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    updatePosition();
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="显示或隐藏表格列"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggleMenu}
        className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-xs font-black tracking-[0.14em] text-slate-600 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 ${className}`}
      >
        <SlidersHorizontal size={14} />
        列
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </>
  );
};
