import Decimal from 'decimal.js';
import { z } from 'zod';
import type { BomItemDraft } from '../productionBomLineModel';

export const BOM_GRID_COLUMN_KEYS = [
  'processStage',
  'materialCode',
  'materialName',
  'ingredientRole',
  'dosageMode',
  'percentage',
  'quantityPerUnit',
  'unit',
  'lossRate',
  'allowedVarianceRate',
  'substituteGroup',
  'yieldContribution',
  'notes',
] as const;

export type BomGridColumnKey = (typeof BOM_GRID_COLUMN_KEYS)[number];
export type ValidationLevel = 'normal' | 'warning' | 'blocking';

export type BomGridRow = BomItemDraft & {
  rowKey: string;
  sequenceNo: number;
  validationLevel: ValidationLevel;
  validationMessages: string[];
  dirtyFields: string[];
};

export type GridSelection = {
  startRowKey: string;
  endRowKey: string;
  startColumnKey: BomGridColumnKey;
  endColumnKey: BomGridColumnKey;
};

export type PasteResult = {
  insertedRowCount: number;
  updatedCellCount: number;
  rejectedCellCount: number;
  messages: string[];
};

export type BomValidationIssue = {
  rowKey: string;
  sequenceNo: number;
  columnKey?: BomGridColumnKey;
  level: Exclude<ValidationLevel, 'normal'>;
  message: string;
};

export type BomValidationResult = {
  valid: boolean;
  blockingCount: number;
  warningCount: number;
  percentageTotal: string;
  totalQuantityPerUnit: string;
  issues: BomValidationIssue[];
};

export interface BomGridAdapter {
  getRows(): BomGridRow[];
  replaceRows(rows: BomGridRow[]): void;
  insertRows(index: number, rows: BomGridRow[]): void;
  deleteRows(rowKeys: string[]): void;
  getSelection(): GridSelection;
  focusCell(rowKey: string, columnKey: string): void;
  paste(matrix: string[][]): PasteResult;
  copy(): string[][];
  fillDown(): void;
  undo(): void;
  redo(): void;
  validate(): BomValidationResult;
  exportDraft(): BomItemDraft[];
}

type GridBridge = {
  getSelection?: () => GridSelection | null;
  focusCell?: (rowKey: string, columnKey: BomGridColumnKey) => void;
};

const decimalText = z.union([z.string(), z.number()]).transform((value) => String(value).trim());

export const bomGridDraftSchema = z.object({
  materialId: z.number().int().positive().nullable().optional(),
  materialName: z.string().trim().max(160),
  materialCode: z.string().trim().max(80),
  ingredientRole: z.string().trim().max(64),
  dosageMode: z.enum(['fixed', 'percentage']),
  percentage: decimalText,
  quantityPerUnit: decimalText,
  unit: z.string().trim().min(1).max(24),
  lossRate: decimalText,
  allowedVarianceRate: decimalText,
  processStage: z.string().trim().max(80),
  substituteGroup: z.string().trim().max(80),
  yieldContribution: decimalText,
  notes: z.string().trim().max(1000),
  availableStock: z.string().optional(),
  lockedStock: z.string().optional(),
  unitCost: z.string().optional(),
  currency: z.string().optional(),
});

const cloneRow = (row: BomGridRow): BomGridRow => ({
  ...row,
  validationMessages: [...row.validationMessages],
  dirtyFields: [...row.dirtyFields],
});
const cloneRows = (rows: BomGridRow[]) => rows.map(cloneRow);
const toDecimal = (value: unknown) => {
  try {
    return new Decimal(String(value ?? '').trim() || '0');
  } catch {
    return new Decimal(0);
  }
};

export const createRowKey = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `bom-row-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

export const toBomGridRow = (
  draft: BomItemDraft,
  sequenceNo: number,
  rowKey = createRowKey(),
): BomGridRow => ({
  ...draft,
  rowKey,
  sequenceNo,
  validationLevel: 'normal',
  validationMessages: [],
  dirtyFields: [],
});

const emptySelection = (rows: BomGridRow[]): GridSelection => ({
  startRowKey: rows[0]?.rowKey || '',
  endRowKey: rows[0]?.rowKey || '',
  startColumnKey: 'materialCode',
  endColumnKey: 'materialCode',
});

export class GovernedBomGridAdapter implements BomGridAdapter {
  private rows: BomGridRow[];
  private undoStack: BomGridRow[][] = [];
  private redoStack: BomGridRow[][] = [];
  private bridge: GridBridge = {};
  private selection: GridSelection;

  constructor(
    initialRows: BomGridRow[],
    private readonly onRowsChanged: (rows: BomGridRow[]) => void,
    private readonly historyLimit = 100,
  ) {
    this.rows = this.resequence(initialRows);
    this.selection = emptySelection(this.rows);
  }

  bindBridge(bridge: GridBridge) {
    this.bridge = bridge;
  }

  setSelection(selection: GridSelection) {
    this.selection = selection;
  }

  getRows() {
    return cloneRows(this.rows);
  }

  replaceRows(rows: BomGridRow[]) {
    this.commit(rows);
  }

  insertRows(index: number, rows: BomGridRow[]) {
    const next = cloneRows(this.rows);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, ...cloneRows(rows));
    this.commit(next);
  }

  deleteRows(rowKeys: string[]) {
    const keys = new Set(rowKeys);
    this.commit(this.rows.filter((row) => !keys.has(row.rowKey)));
  }

  getSelection() {
    return this.bridge.getSelection?.() || { ...this.selection };
  }

  focusCell(rowKey: string, columnKey: string) {
    if (!BOM_GRID_COLUMN_KEYS.includes(columnKey as BomGridColumnKey)) return;
    const typedColumn = columnKey as BomGridColumnKey;
    this.selection = {
      startRowKey: rowKey,
      endRowKey: rowKey,
      startColumnKey: typedColumn,
      endColumnKey: typedColumn,
    };
    this.bridge.focusCell?.(rowKey, typedColumn);
  }

  paste(matrix: string[][]): PasteResult {
    if (matrix.length > 300) {
      return {
        insertedRowCount: 0,
        updatedCellCount: 0,
        rejectedCellCount: matrix.reduce((sum, row) => sum + row.length, 0),
        messages: ['单次粘贴最多允许 300 行。'],
      };
    }
    const selection = this.getSelection();
    const startIndex = Math.max(0, this.rows.findIndex((row) => row.rowKey === selection.startRowKey));
    const startColumn = Math.max(0, BOM_GRID_COLUMN_KEYS.indexOf(selection.startColumnKey));
    const next = cloneRows(this.rows);
    let insertedRowCount = 0;
    let updatedCellCount = 0;
    let rejectedCellCount = 0;

    matrix.forEach((values, rowOffset) => {
      const rowIndex = startIndex + rowOffset;
      if (!next[rowIndex]) {
        next.push(toBomGridRow({
          materialName: '',
          materialCode: '',
          ingredientRole: 'other',
          dosageMode: 'fixed',
          percentage: '',
          quantityPerUnit: '',
          unit: 'kg',
          lossRate: '0',
          allowedVarianceRate: '',
          processStage: '',
          substituteGroup: '',
          yieldContribution: '',
          notes: '',
        }, next.length + 1));
        insertedRowCount += 1;
      }
      values.forEach((value, columnOffset) => {
        const key = BOM_GRID_COLUMN_KEYS[startColumn + columnOffset];
        if (!key) {
          rejectedCellCount += 1;
          return;
        }
        next[rowIndex] = {
          ...next[rowIndex],
          [key]: String(value ?? '').trim(),
          dirtyFields: Array.from(new Set([...next[rowIndex].dirtyFields, key])),
        };
        updatedCellCount += 1;
      });
    });
    this.commit(next);
    return { insertedRowCount, updatedCellCount, rejectedCellCount, messages: [] };
  }

  copy() {
    const selection = this.getSelection();
    const firstRow = this.rows.findIndex((row) => row.rowKey === selection.startRowKey);
    const lastRow = this.rows.findIndex((row) => row.rowKey === selection.endRowKey);
    const firstColumn = BOM_GRID_COLUMN_KEYS.indexOf(selection.startColumnKey);
    const lastColumn = BOM_GRID_COLUMN_KEYS.indexOf(selection.endColumnKey);
    const rowStart = Math.max(0, Math.min(firstRow, lastRow));
    const rowEnd = Math.max(firstRow, lastRow);
    const columnStart = Math.max(0, Math.min(firstColumn, lastColumn));
    const columnEnd = Math.max(firstColumn, lastColumn);
    return this.rows.slice(rowStart, rowEnd + 1).map((row) => (
      BOM_GRID_COLUMN_KEYS.slice(columnStart, columnEnd + 1).map((key) => String(row[key] ?? ''))
    ));
  }

  fillDown() {
    const selection = this.getSelection();
    const firstRow = this.rows.findIndex((row) => row.rowKey === selection.startRowKey);
    const lastRow = this.rows.findIndex((row) => row.rowKey === selection.endRowKey);
    if (firstRow < 0 || lastRow < 0) return;
    const start = Math.min(firstRow, lastRow);
    const end = Math.max(firstRow, lastRow);
    const value = this.rows[start][selection.startColumnKey];
    const next = cloneRows(this.rows);
    for (let index = start + 1; index <= end; index += 1) {
      next[index] = {
        ...next[index],
        [selection.startColumnKey]: value,
        dirtyFields: Array.from(new Set([...next[index].dirtyFields, selection.startColumnKey])),
      };
    }
    this.commit(next);
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneRows(this.rows));
    this.rows = this.resequence(previous);
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneRows(this.rows));
    this.rows = this.resequence(next);
    this.emit();
  }

  validate(): BomValidationResult {
    const issues: BomValidationIssue[] = [];
    let percentageTotal = new Decimal(0);
    let totalQuantityPerUnit = new Decimal(0);
    const materialCodes = new Set<string>();

    const validatedRows = this.rows.map((row) => {
      const rowIssues: BomValidationIssue[] = [];
      const parsed = bomGridDraftSchema.safeParse(row);
      if (!parsed.success) {
        parsed.error.issues.forEach((issue) => rowIssues.push({
          rowKey: row.rowKey,
          sequenceNo: row.sequenceNo,
          columnKey: issue.path[0] as BomGridColumnKey | undefined,
          level: 'blocking',
          message: issue.message,
        }));
      }
      if (!row.materialCode.trim() && !row.materialName.trim()) {
        rowIssues.push({ rowKey: row.rowKey, sequenceNo: row.sequenceNo, level: 'blocking', message: '物料编码或名称至少填写一项。' });
      }
      const code = row.materialCode.trim().toLocaleLowerCase();
      if (code && materialCodes.has(code)) {
        rowIssues.push({ rowKey: row.rowKey, sequenceNo: row.sequenceNo, columnKey: 'materialCode', level: 'blocking', message: '物料编码重复。' });
      }
      if (code) materialCodes.add(code);
      const quantity = toDecimal(row.quantityPerUnit);
      if (!quantity.isPositive()) {
        rowIssues.push({ rowKey: row.rowKey, sequenceNo: row.sequenceNo, columnKey: 'quantityPerUnit', level: 'blocking', message: '单位单耗必须大于 0。' });
      }
      const percentage = toDecimal(row.percentage);
      if (row.dosageMode === 'percentage') percentageTotal = percentageTotal.plus(percentage);
      totalQuantityPerUnit = totalQuantityPerUnit.plus(quantity);
      if (row.dosageMode === 'percentage' && !percentage.isPositive()) {
        rowIssues.push({ rowKey: row.rowKey, sequenceNo: row.sequenceNo, columnKey: 'percentage', level: 'blocking', message: '百分比配方必须填写正数比例。' });
      }
      if (!row.processStage.trim()) {
        rowIssues.push({ rowKey: row.rowKey, sequenceNo: row.sequenceNo, columnKey: 'processStage', level: 'warning', message: '建议填写工艺阶段。' });
      }
      issues.push(...rowIssues);
      const blocking = rowIssues.some((issue) => issue.level === 'blocking');
      return {
        ...row,
        validationLevel: blocking ? 'blocking' as const : rowIssues.length ? 'warning' as const : 'normal' as const,
        validationMessages: rowIssues.map((issue) => issue.message),
      };
    });

    if (validatedRows.some((row) => row.dosageMode === 'percentage') && !percentageTotal.eq(100)) {
      issues.push({
        rowKey: '',
        sequenceNo: 0,
        columnKey: 'percentage',
        level: 'blocking',
        message: `百分比合计必须为 100%，当前为 ${percentageTotal.toFixed(6)}%。`,
      });
    }
    this.rows = validatedRows;
    this.emit();
    const blockingCount = issues.filter((issue) => issue.level === 'blocking').length;
    return {
      valid: blockingCount === 0,
      blockingCount,
      warningCount: issues.filter((issue) => issue.level === 'warning').length,
      percentageTotal: percentageTotal.toFixed(6),
      totalQuantityPerUnit: totalQuantityPerUnit.toFixed(6),
      issues,
    };
  }

  exportDraft() {
    return this.rows.map(({
      rowKey: _rowKey,
      sequenceNo: _sequenceNo,
      validationLevel: _validationLevel,
      validationMessages: _validationMessages,
      dirtyFields: _dirtyFields,
      ...draft
    }) => ({ ...draft }));
  }

  private commit(rows: BomGridRow[]) {
    this.undoStack.push(cloneRows(this.rows));
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
    this.rows = this.resequence(rows);
    this.emit();
  }

  private resequence(rows: BomGridRow[]) {
    return cloneRows(rows).map((row, index) => ({ ...row, sequenceNo: index + 1 }));
  }

  private emit() {
    this.onRowsChanged(this.getRows());
  }
}
