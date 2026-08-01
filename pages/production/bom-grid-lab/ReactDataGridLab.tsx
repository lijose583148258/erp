import React, { useMemo, useRef } from 'react';
import {
  DataGrid,
  renderTextEditor,
  type Column,
  type DataGridHandle,
  type PositionChangeArgs,
} from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
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

export function ReactDataGridLab({ rows, adapter }: Props) {
  const gridRef = useRef<DataGridHandle>(null);
  const selectionRef = useRef<GridSelection | null>(null);
  const columns = useMemo<Column<BomGridRow>[]>(() => (
    BOM_GRID_COLUMN_KEYS.map((key) => ({
      key,
      name: labels[key],
      width: key === 'materialName' ? 220 : key === 'notes' ? 260 : 130,
      minWidth: 90,
      resizable: true,
      frozen: key === 'materialCode',
      renderEditCell: renderTextEditor,
      cellClass: (row) => row.validationLevel === 'blocking'
        ? 'bom-grid-cell-blocking'
        : row.validationLevel === 'warning'
          ? 'bom-grid-cell-warning'
          : undefined,
    }))
  ), []);

  adapter.bindBridge({
    getSelection: () => selectionRef.current,
    focusCell: (rowKey, columnKey) => {
      const rowIdx = rows.findIndex((row) => row.rowKey === rowKey);
      const idx = columns.findIndex((column) => column.key === columnKey);
      if (rowIdx >= 0 && idx >= 0) {
        gridRef.current?.scrollToCell({ rowIdx, idx });
        gridRef.current?.setActivePosition({ rowIdx, idx });
      }
    },
  });

  const onActivePositionChange = (position: PositionChangeArgs<BomGridRow>) => {
    if (position.rowIdx < 0 || !position.column || !rows[position.rowIdx]) return;
    const columnKey = position.column.key as BomGridColumnKey;
    if (!BOM_GRID_COLUMN_KEYS.includes(columnKey)) return;
    const rowKey = rows[position.rowIdx].rowKey;
    selectionRef.current = {
      startRowKey: rowKey,
      endRowKey: rowKey,
      startColumnKey: columnKey,
      endColumnKey: columnKey,
    };
    adapter.setSelection(selectionRef.current);
  };
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    adapter.paste(text.replace(/\r/g, '').split('\n').filter(Boolean).map((line) => line.split('\t')));
  };

  return (
    <div
      onPasteCapture={handlePaste}
      className="h-[620px] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700"
      data-testid="bom-grid-lab-react-data-grid"
      data-row-count={rows.length}
      data-first-material-code={rows[0]?.materialCode || ''}
      data-last-loss-rate={rows.at(-1)?.lossRate || ''}
    >
      <DataGrid
        ref={gridRef}
        aria-label="React Data Grid BOM 实验"
        data-testid="bom-grid-lab-react-data-grid-table"
        columns={columns}
        rows={rows}
        rowKeyGetter={(row) => row.rowKey}
        onRowsChange={(nextRows) => adapter.replaceRows([...nextRows])}
        onActivePositionChange={onActivePositionChange}
        onFill={({ sourceRow, targetRow, columnKey }) => ({
          ...targetRow,
          [columnKey]: sourceRow[columnKey as BomGridColumnKey],
        })}
        rowHeight={36}
        headerRowHeight={42}
        className="rdg-light dark:rdg-dark"
      />
    </div>
  );
}
