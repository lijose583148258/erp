import React, { useEffect, useMemo, useRef } from 'react';
import { defineCustomElements } from '@revolist/revogrid/loader';
import type { ColumnRegular } from '@revolist/revogrid';
import {
  BOM_GRID_COLUMN_KEYS,
  type BomGridColumnKey,
  type BomGridRow,
  type GovernedBomGridAdapter,
  type GridSelection,
} from './bomGridContract';

type Props = {
  rows: BomGridRow[];
  adapter: GovernedBomGridAdapter;
};

type RevoGridElement = HTMLElement & {
  columns: ColumnRegular[];
  source: BomGridRow[];
  range: boolean;
  resize: boolean;
  readonly: boolean;
  theme: string;
  getFocused(): Promise<{ rowIndex: number; column?: { prop?: string } } | null>;
  setCellEdit(rowIndex: number, columnKey: string): Promise<void>;
};

let elementsDefined = false;
const ensureRevoGridDefined = () => {
  if (elementsDefined || typeof window === 'undefined') return;
  defineCustomElements(window);
  elementsDefined = true;
};

const labels: Record<BomGridColumnKey, string> = {
  processStage: '阶段',
  materialCode: '物料编码',
  materialName: '物料名称',
  ingredientRole: '角色',
  dosageMode: '剂量模式',
  percentage: '配比 %',
  quantityPerUnit: '标准用量',
  unit: '单位',
  lossRate: '损耗 %',
  allowedVarianceRate: '允许偏差 %',
  substituteGroup: '替代组',
  yieldContribution: '收率贡献',
  notes: '备注',
};

export function RevoGridLab({ rows, adapter }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<RevoGridElement | null>(null);
  const selectionRef = useRef<GridSelection | null>(null);
  const columns = useMemo<ColumnRegular[]>(() => (
    BOM_GRID_COLUMN_KEYS.map((key) => ({
      prop: key,
      name: labels[key],
      size: key === 'materialName' ? 220 : key === 'notes' ? 260 : 130,
      readonly: false,
      pin: key === 'materialCode' ? 'colPinStart' : undefined,
    }))
  ), []);

  useEffect(() => {
    ensureRevoGridDefined();
    const host = hostRef.current;
    if (!host) return;
    const grid = document.createElement('revo-grid') as unknown as RevoGridElement;
    grid.setAttribute('data-testid', 'bom-grid-lab-revogrid-table');
    grid.style.height = '620px';
    grid.style.width = '100%';
    grid.columns = columns;
    grid.source = rows;
    grid.range = true;
    grid.resize = true;
    grid.readonly = false;
    grid.theme = document.documentElement.classList.contains('dark') ? 'darkMaterial' : 'compact';

    const handleAfterEdit = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const rowIndex = Number(detail.rowIndex ?? detail.rgRow ?? detail.row);
      const prop = String(detail.prop ?? '');
      const value = detail.val ?? detail.value;
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || !BOM_GRID_COLUMN_KEYS.includes(prop as BomGridColumnKey)) return;
      const next = adapter.getRows();
      if (!next[rowIndex]) return;
      next[rowIndex] = {
        ...next[rowIndex],
        [prop]: String(value ?? ''),
        dirtyFields: Array.from(new Set([...next[rowIndex].dirtyFields, prop])),
      };
      adapter.replaceRows(next);
    };
    const handleAfterFocus = async () => {
      const focused = await grid.getFocused();
      if (!focused) return;
      const rowIndex = Number(focused.rowIndex);
      const columnKey = String(focused.column?.prop ?? '') as BomGridColumnKey;
      if (!rows[rowIndex] || !BOM_GRID_COLUMN_KEYS.includes(columnKey)) return;
      selectionRef.current = {
        startRowKey: rows[rowIndex].rowKey,
        endRowKey: rows[rowIndex].rowKey,
        startColumnKey: columnKey,
        endColumnKey: columnKey,
      };
      adapter.setSelection(selectionRef.current);
    };

    grid.addEventListener('afteredit', handleAfterEdit);
    grid.addEventListener('afterfocus', handleAfterFocus);
    host.replaceChildren(grid);
    gridRef.current = grid;

    adapter.bindBridge({
      getSelection: () => selectionRef.current,
      focusCell: (rowKey, columnKey) => {
        const rowIndex = rows.findIndex((row) => row.rowKey === rowKey);
        if (rowIndex >= 0) void grid.setCellEdit(rowIndex, columnKey);
      },
    });

    return () => {
      grid.removeEventListener('afteredit', handleAfterEdit);
      grid.removeEventListener('afterfocus', handleAfterFocus);
      grid.remove();
      gridRef.current = null;
    };
  }, [adapter, columns]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.source = rows;
  }, [rows]);

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    adapter.paste(text.replace(/\r/g, '').split('\n').filter(Boolean).map((line) => line.split('\t')));
  };

  return (
    <div
      ref={hostRef}
      onPasteCapture={handlePaste}
      className="h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      data-testid="bom-grid-lab-revogrid"
      data-row-count={rows.length}
      data-first-material-code={rows[0]?.materialCode || ''}
      data-last-loss-rate={rows.at(-1)?.lossRate || ''}
    />
  );
}
