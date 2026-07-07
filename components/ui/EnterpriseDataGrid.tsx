import React, { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileSpreadsheet, SlidersHorizontal, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ActionToolbar } from './ActionToolbar';
import {
  applyBusinessFilters,
  createEmptyBusinessFilterState,
  hasActiveBusinessFilters,
  isEmptyBusinessFilterValue,
  type BusinessFilterDefinition,
  type BusinessFilterMode,
  type BusinessFilterRangeValue,
  type BusinessFilterState,
  type BusinessFilterValue,
} from './businessFilters';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { StatusBadge } from './StatusBadge';
import { readNumberPreference, readStringArrayPreference, writeNumberPreference, writeStringArrayPreference } from './tablePreferences';

export type EnterpriseColumn<T> = {
  key: string;
  header: React.ReactNode;
  accessor?: keyof T | ((row: T) => React.ReactNode);
  render?: (row: T) => React.ReactNode;
  searchText?: (row: T) => string;
  sortable?: boolean;
  isNumeric?: boolean;
  isStatus?: boolean;
  defaultVisible?: boolean;
  width?: string;
  className?: string;
};

type Props<T> = {
  data: T[];
  columns: EnterpriseColumn<T>[];
  rowKey: keyof T | ((row: T) => string);
  title?: React.ReactNode;
  description?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchInputTestId?: string;
  searchable?: boolean;
  manualSearch?: boolean;
  filterDefinitions?: BusinessFilterDefinition<T>[];
  filterState?: BusinessFilterState;
  onFilterStateChange?: (state: BusinessFilterState) => void;
  filterMode?: BusinessFilterMode;
  loading?: boolean;
  emptyTitle?: React.ReactNode;
  emptyDescription?: React.ReactNode;
  toolbarActions?: React.ReactNode;
  exportFileName?: string;
  exportSheetName?: string;
  exportLabel?: React.ReactNode;
  importLabel?: React.ReactNode;
  onImport?: (rows: Record<string, unknown>[]) => void | Promise<void>;
  rowActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  getRowTestId?: (row: T) => string;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  manualPagination?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  resultCountLabel?: string;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  paginationTestIdPrefix?: string;
  preferenceKey?: string;
  virtualizeRows?: boolean;
  virtualizationThreshold?: number;
  className?: string;
};

type SortState = {
  key: string;
  direction: 'asc' | 'desc';
} | null;

const stringifyCell = (value: unknown): string => {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifyCell).join(' ');
  return '';
};

const renderCellValue = (value: unknown): React.ReactNode => {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (React.isValidElement(value)) return value;
  if (Array.isArray(value)) return value.map(renderCellValue).filter(Boolean).join(' ');
  return String(value);
};

const getCellTitle = (value: unknown): string | undefined => {
  if (React.isValidElement(value) || value == null || typeof value === 'boolean') return undefined;
  const text = String(renderCellValue(value)).trim();
  return text.length > 18 ? text : undefined;
};

const getAccessorValue = <T,>(row: T, column: EnterpriseColumn<T>): unknown => {
  if (column.accessor) {
    return typeof column.accessor === 'function'
      ? column.accessor(row)
      : (row as Record<string, unknown>)[String(column.accessor)];
  }
  return (row as Record<string, unknown>)[column.key];
};

export function EnterpriseDataGrid<T>({
  data,
  columns,
  rowKey,
  title,
  description,
  searchValue = '',
  onSearchChange,
  searchPlaceholder,
  searchInputTestId,
  searchable = true,
  manualSearch = false,
  filterDefinitions = [],
  filterState,
  onFilterStateChange,
  filterMode = 'client',
  loading = false,
  emptyTitle = '暂无数据',
  emptyDescription,
  toolbarActions,
  exportFileName,
  exportSheetName,
  exportLabel = '导出',
  importLabel = '导入',
  onImport,
  rowActions,
  onRowClick,
  rowClassName,
  getRowTestId,
  defaultPageSize = 10,
  pageSizeOptions = [10, 20, 50],
  manualPagination = false,
  pagination,
  resultCountLabel,
  onPageChange,
  onPageSizeChange,
  paginationTestIdPrefix,
  preferenceKey,
  virtualizeRows = true,
  virtualizationThreshold = 30,
  className = '',
}: Props<T>) {
  const tablePreferenceKey = preferenceKey || paginationTestIdPrefix || searchInputTestId || exportFileName || stringifyCell(title) || 'enterprise-grid';
  const pageSizeStorageKey = `ailao.grid.${tablePreferenceKey}.pageSize`;
  const columnStorageKey = `ailao.grid.${tablePreferenceKey}.columns`;
  const defaultColumnKeys = useMemo(() => columns.filter((column) => column.defaultVisible !== false).map((column) => column.key), [columns]);
  const [sortState, setSortState] = useState<SortState>(null);
  const [pageSize, setPageSize] = useState(() => readNumberPreference(pageSizeStorageKey, defaultPageSize, pageSizeOptions));
  const [page, setPage] = useState(1);
  const [internalSearch, setInternalSearch] = useState('');
  const [internalFilterState, setInternalFilterState] = useState<BusinessFilterState>(() => createEmptyBusinessFilterState());
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(() => readStringArrayPreference(columnStorageKey, defaultColumnKeys));
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const visibleColumnKeySet = useMemo(() => new Set(visibleColumnKeys), [visibleColumnKeys]);
  const visibleColumns = useMemo(() => {
    const selected = columns.filter((column) => visibleColumnKeySet.has(column.key));
    return selected.length ? selected : columns.slice(0, 1);
  }, [columns, visibleColumnKeySet]);
  const effectiveSearchValue = typeof onSearchChange === 'function' ? searchValue : internalSearch;
  const effectiveFilterState = filterState || internalFilterState;
  const smartFiltersActive = hasActiveBusinessFilters(effectiveFilterState);
  const isServerPaged = manualPagination && Boolean(pagination);
  const handleSearchChange = (value: string) => {
    setPage(1);
    if (onSearchChange) {
      onSearchChange(value);
      return;
    }
    setInternalSearch(value);
  };
  const setColumnVisibility = (key: string, visible: boolean) => {
    setVisibleColumnKeys((current) => {
      const next = visible ? Array.from(new Set([...current, key])) : current.filter((item) => item !== key);
      const safeNext = next.length ? next : [key];
      writeStringArrayPreference(columnStorageKey, safeNext);
      return safeNext;
    });
  };
  const resetColumnVisibility = () => {
    setVisibleColumnKeys(defaultColumnKeys);
    writeStringArrayPreference(columnStorageKey, defaultColumnKeys);
  };
  const commitFilterState = (next: BusinessFilterState) => {
    setPage(1);
    if (onFilterStateChange) {
      onFilterStateChange(next);
      return;
    }
    setInternalFilterState(next);
  };
  const updateFilterValue = (key: string, value: BusinessFilterValue) => {
    const nextValues = { ...(effectiveFilterState.values || {}) };
    if (isEmptyBusinessFilterValue(value)) delete nextValues[key];
    else nextValues[key] = value;
    commitFilterState({
      ...effectiveFilterState,
      values: nextValues,
      updatedAt: new Date().toISOString(),
    });
  };
  const updateRangeFilterValue = (key: string, bound: keyof BusinessFilterRangeValue, value: string) => {
    const current = effectiveFilterState.values?.[key];
    const range = current && typeof current === 'object' && !Array.isArray(current) && !(current instanceof Date)
      ? current as BusinessFilterRangeValue
      : {};
    updateFilterValue(key, { ...range, [bound]: value });
  };
  const clearSmartFilters = () => {
    const { quickPreset: _quickPreset, ...filterStateWithoutPreset } = effectiveFilterState;
    commitFilterState({
      ...filterStateWithoutPreset,
      values: {},
      updatedAt: new Date().toISOString(),
    });
  };

  const searchedData = useMemo(() => {
    const terms = effectiveSearchValue.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (manualSearch || isServerPaged || terms.length === 0) return data;
    return data.filter((row) => {
      const haystack = columns
        .map((column) => column.searchText?.(row) ?? stringifyCell(getAccessorValue(row, column)))
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [columns, data, effectiveSearchValue, isServerPaged, manualSearch]);

  const filteredData = useMemo(() => {
    if (filterMode === 'manual' || isServerPaged) return searchedData;
    return applyBusinessFilters(searchedData, filterDefinitions, effectiveFilterState);
  }, [effectiveFilterState, filterDefinitions, filterMode, isServerPaged, searchedData]);

  const sortedData = useMemo(() => {
    if (isServerPaged || !sortState) return filteredData;
    const column = visibleColumns.find((item) => item.key === sortState.key);
    if (!column) return filteredData;
    return [...filteredData].sort((left, right) => {
      const a = column.searchText?.(left) ?? stringifyCell(getAccessorValue(left, column));
      const b = column.searchText?.(right) ?? stringifyCell(getAccessorValue(right, column));
      return sortState.direction === 'asc'
        ? a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
        : b.localeCompare(a, 'zh-Hans-CN', { numeric: true });
    });
  }, [filteredData, isServerPaged, sortState, visibleColumns]);

  const effectivePageSize = isServerPaged && pagination ? pagination.pageSize : pageSize;
  const totalRows = isServerPaged && pagination ? pagination.total : sortedData.length;
  const totalPages = isServerPaged && pagination
    ? Math.max(1, pagination.totalPages)
    : Math.max(1, Math.ceil(sortedData.length / pageSize));
  const safePage = isServerPaged && pagination ? Math.min(pagination.page, totalPages) : Math.min(page, totalPages);
  const pageData = isServerPaged ? sortedData : sortedData.slice((safePage - 1) * pageSize, safePage * pageSize);
  const getKey = (row: T) => (typeof rowKey === 'function' ? rowKey(row) : String((row as Record<string, unknown>)[String(rowKey)]));
  const firstRowIndex = totalRows === 0 ? 0 : (safePage - 1) * effectivePageSize + 1;
  const lastRowIndex = isServerPaged
    ? Math.min((safePage - 1) * effectivePageSize + pageData.length, totalRows)
    : Math.min(safePage * effectivePageSize, totalRows);
  const exportData = isServerPaged ? pageData : sortedData;
  const effectiveResultCount = isServerPaged && pagination ? pagination.total : filteredData.length;
  const shouldVirtualizeRows = virtualizeRows && !isServerPaged && pageData.length >= virtualizationThreshold;
  const rowVirtualizer = useVirtualizer({
    count: pageData.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });
  const virtualRows = shouldVirtualizeRows ? rowVirtualizer.getVirtualItems() : [];
  const virtualPaddingTop = virtualRows[0]?.start || 0;
  const lastVirtualRow = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1] : undefined;
  const virtualPaddingBottom = shouldVirtualizeRows && lastVirtualRow
    ? Math.max(0, rowVirtualizer.getTotalSize() - lastVirtualRow.end)
    : 0;
  const effectiveExportLabel = isServerPaged ? '导出当前页' : exportLabel;

  const handleExport = () => {
    const sheetRows = exportData.map((row) => (
      visibleColumns.map((column) => column.searchText?.(row) ?? stringifyCell(getAccessorValue(row, column)))
    ));
    const headers = visibleColumns.map((column) => stringifyCell(column.header) || column.key);
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sheetRows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, exportSheetName || 'Sheet1');
    const safeName = (exportFileName || stringifyCell(title) || 'export').replace(/[\\/:*?"<>|]/g, '_');
    const pageSuffix = isServerPaged ? `_page-${safePage}` : '';
    XLSX.writeFile(workbook, `${safeName}${pageSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onImport) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = async (readerEvent) => {
      try {
        const workbook = XLSX.read(readerEvent.target?.result, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
        if (!worksheet) throw new Error('No worksheet found in imported file');
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
        await onImport(rows);
      } catch (error) {
        const message = error instanceof Error ? error.message : '文件解析失败，请检查表头、格式或文件是否损坏';
        setImportError(`导入失败：${message}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setImportError(`导入失败：无法读取文件 ${file.name}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const toggleSort = (column: EnterpriseColumn<T>) => {
    if (!column.sortable || isServerPaged) return;
    setPage(1);
    setSortState((current) => {
      if (!current || current.key !== column.key) return { key: column.key, direction: 'asc' };
      if (current.direction === 'asc') return { key: column.key, direction: 'desc' };
      return null;
    });
  };

  const renderFilterControl = (definition: BusinessFilterDefinition<T>) => {
    const current = effectiveFilterState.values?.[definition.key];
    const label = definition.label || definition.key;

    if (definition.kind === 'dateRange' || definition.kind === 'numberRange' || definition.kind === 'amountRange') {
      const range = current && typeof current === 'object' && !Array.isArray(current) && !(current instanceof Date)
        ? current as BusinessFilterRangeValue
        : {};
      const inputType = definition.kind === 'dateRange' ? 'date' : 'number';
      return (
        <div key={definition.key} className="space-y-2">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type={inputType}
              value={String(range.from ?? range.min ?? '')}
              onChange={(event) => updateRangeFilterValue(definition.key, 'from', event.target.value)}
              aria-label={`${label} from`}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-900/30"
            />
            <input
              type={inputType}
              value={String(range.to ?? range.max ?? '')}
              onChange={(event) => updateRangeFilterValue(definition.key, 'to', event.target.value)}
              aria-label={`${label} to`}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-900/30"
            />
          </div>
        </div>
      );
    }

    if (definition.kind === 'multiSelect') {
      const currentValues = new Set((Array.isArray(current) ? current : current ? [current] : []).map(String));
      return (
        <div key={definition.key} className="space-y-2">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</div>
          <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
            {(definition.options || []).map((option) => {
              const checked = currentValues.has(option.value);
              return (
                <label key={option.value} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-bold ${checked ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(currentValues);
                      if (event.target.checked) next.add(option.value);
                      else next.delete(option.value);
                      updateFilterValue(definition.key, Array.from(next));
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </div>
      );
    }

    if (definition.kind === 'boolean') {
      return (
        <label key={definition.key} className="space-y-2">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</div>
          <select
            value={current === true || current === 'true' ? 'true' : current === false || current === 'false' ? 'false' : ''}
            onChange={(event) => updateFilterValue(definition.key, event.target.value)}
            className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-900/30"
          >
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      );
    }

    return (
      <label key={definition.key} className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{label}</div>
        <input
          value={String(current ?? '')}
          onChange={(event) => updateFilterValue(definition.key, event.target.value)}
          placeholder={definition.entity ? `Search ${definition.entity}` : 'Filter'}
          className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-900/30"
        />
      </label>
    );
  };

  const renderDataRow = (row: T) => (
    <tr
      key={getKey(row)}
      data-testid={getRowTestId?.(row)}
      onClick={() => onRowClick?.(row)}
      onKeyDown={(event) => {
        if (!onRowClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onRowClick(row);
        }
      }}
      role={onRowClick ? 'button' : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      className={`group border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-800 dark:hover:bg-slate-800/70 dark:focus:ring-blue-900/30 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) || ''}`}
    >
      {visibleColumns.map((column, columnIndex) => {
        const value = column.render ? column.render(row) : getAccessorValue(row, column);
        return (
          <td key={column.key} className={`px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 ${columnIndex === 0 ? 'sticky left-0 z-[5] bg-white group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800' : ''} ${column.isNumeric ? 'text-right font-data' : ''} ${column.className || ''}`}>
            {column.isStatus ? (
              <StatusBadge status={stringifyCell(value)} />
            ) : React.isValidElement(value) ? (
              value
            ) : (
              <span className="truncate-cell" title={getCellTitle(value)}>
                {renderCellValue(value)}
              </span>
            )}
          </td>
        );
      })}
      {rowActions ? (
        <td className="sticky right-0 z-[5] w-[260px] bg-white px-3 py-2.5 text-right group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800">
          <div className="app-row-actions touch-actions-visible ml-auto flex min-w-[120px] max-w-[236px] items-center justify-end gap-1.5 overflow-x-auto whitespace-nowrap pb-1">
            {rowActions(row)}
          </div>
        </td>
      ) : null}
    </tr>
  );

  return (
    <div className={`space-y-4 ${className}`}>
      <ActionToolbar
        title={title}
        description={description}
        searchValue={searchable ? effectiveSearchValue : undefined}
        onSearchChange={searchable ? handleSearchChange : undefined}
        searchPlaceholder={searchPlaceholder}
        searchInputTestId={searchInputTestId}
        resultCount={effectiveResultCount}
        resultCountLabel={resultCountLabel || (isServerPaged && pagination ? `总 ${pagination.total}` : undefined)}
      >
        {onImport ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImport}
              aria-label="导入表格文件"
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-xs font-black tracking-[0.14em] text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Upload size={14} className="mr-2" />
              {importLabel}
            </button>
          </>
        ) : null}
        {exportFileName ? (
          <button
            type="button"
            onClick={handleExport}
            disabled={exportData.length === 0}
            className="inline-flex items-center justify-center rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-xs font-black tracking-[0.14em] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FileSpreadsheet size={14} className="mr-2" />
            {effectiveExportLabel}
          </button>
        ) : null}
        <details className="relative">
          <summary aria-label="显示或隐藏表格列" className="inline-flex min-h-9 cursor-pointer list-none items-center justify-center rounded-[18px] border border-slate-200 bg-white px-4 py-2.5 text-xs font-black tracking-[0.14em] text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            <SlidersHorizontal size={14} className="mr-2" />
            列
          </summary>
          <div className="absolute right-0 top-11 z-40 w-56 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-black text-slate-700 dark:text-slate-200">显示列</span>
              <button type="button" onClick={resetColumnVisibility} className="min-h-8 rounded-lg px-2 text-xs font-bold text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40">重置</button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {columns.map((column) => (
                <label key={column.key} className="flex min-h-9 items-center gap-2 rounded-xl px-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={visibleColumnKeySet.has(column.key)}
                    onChange={(event) => setColumnVisibility(column.key, event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span className="truncate">{stringifyCell(column.header) || column.key}</span>
                </label>
              ))}
            </div>
          </div>
        </details>
        {toolbarActions}
      </ActionToolbar>

      {filterDefinitions.length > 0 ? (
        <details
          open={smartFiltersActive || undefined}
          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal size={14} />
              Smart filters
            </span>
            <span className={`rounded-full px-2 py-1 text-[10px] ${smartFiltersActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200' : 'bg-white text-slate-400 dark:bg-slate-800'}`}>
              {filterMode === 'manual' ? 'manual' : 'client'}
            </span>
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {filterDefinitions.map(renderFilterControl)}
          </div>
          {smartFiltersActive ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={clearSmartFilters}
                className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </details>
      ) : null}

      {importError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-black text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200">
          {importError}
        </div>
      ) : null}

      <div className="app-density-surface overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <LoadingSkeleton variant="table" rows={effectivePageSize} />
        ) : pageData.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} className="m-4" />
        ) : (
          <div
            ref={tableScrollRef}
            data-virtualized={shouldVirtualizeRows ? 'true' : 'false'}
            data-virtual-row-count={shouldVirtualizeRows ? pageData.length : undefined}
            className={`overflow-x-auto ${shouldVirtualizeRows ? 'max-h-[70vh] overflow-y-auto' : ''}`}
          >
            <table className="app-density-table w-full min-w-[980px] table-fixed border-collapse">
              <thead>
                <tr className="bg-slate-50/95 dark:bg-slate-800/95 shadow-sm">
                  {visibleColumns.map((column, columnIndex) => {
                    const canSort = Boolean(column.sortable && !isServerPaged);
                    return (
                      <th
                        key={column.key}
                        style={column.width ? { width: column.width } : undefined}
                        className={`sticky top-0 z-20 border-b border-slate-100 bg-slate-50/95 px-3 py-2.5 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-600 dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-300 ${columnIndex === 0 ? 'left-0 z-30' : ''} ${column.isNumeric ? 'text-right' : ''}`}
                      >
                      <button
                        type="button"
                        disabled={!canSort}
                        onClick={() => toggleSort(column)}
                        aria-label={canSort ? `按 ${stringifyCell(column.header) || column.key} 排序` : undefined}
                        className={`inline-flex min-h-8 items-center gap-1 rounded px-1.5 ${canSort ? 'hover:text-blue-600' : 'cursor-default'}`}
                      >
                        {column.header}
                        {canSort ? (
                          sortState?.key === column.key ? (
                            sortState.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                          ) : (
                            <ArrowUpDown size={12} />
                          )
                        ) : null}
                      </button>
                    </th>
                    );
                  })}
                  {rowActions ? (
                    <th className="sticky right-0 top-0 z-30 w-[260px] border-b border-slate-100 bg-slate-50/95 px-3 py-2.5 text-right text-xs font-black uppercase tracking-[0.12em] text-slate-600 dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-300">
                      操作
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody data-virtualized={shouldVirtualizeRows ? 'true' : 'false'}>
                {shouldVirtualizeRows && virtualPaddingTop > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={visibleColumns.length + (rowActions ? 1 : 0)} style={{ height: virtualPaddingTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {shouldVirtualizeRows
                  ? virtualRows.map((virtualRow) => {
                    const row = pageData[virtualRow.index];
                    return row ? renderDataRow(row) : null;
                  })
                  : pageData.map((row) => renderDataRow(row))}
                {shouldVirtualizeRows && virtualPaddingBottom > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={visibleColumns.length + (rowActions ? 1 : 0)} style={{ height: virtualPaddingBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 text-xs font-bold text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {firstRowIndex}-{lastRowIndex} / {totalRows}
        </span>
        <div className="flex items-center gap-2">
          <select
            data-testid={paginationTestIdPrefix ? `${paginationTestIdPrefix}-page-size` : undefined}
            aria-label="每页行数"
            title="每页行数"
            value={effectivePageSize}
            onChange={(event) => {
              const nextPageSize = Number(event.target.value);
              if (isServerPaged && onPageSizeChange) {
                onPageSizeChange(nextPageSize);
                return;
              }
              setPageSize(nextPageSize);
              setPage(1);
              writeNumberPreference(pageSizeStorageKey, nextPageSize);
            }}
            className="min-h-8 rounded-xl border border-slate-200 bg-white px-2 py-1 outline-none dark:border-slate-700 dark:bg-slate-800"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option} / 页
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid={paginationTestIdPrefix ? `${paginationTestIdPrefix}-prev` : undefined}
            aria-label="上一页"
            title="上一页"
            onClick={() => {
              const nextPage = Math.max(1, safePage - 1);
              if (isServerPaged && onPageChange) {
                onPageChange(nextPage);
                return;
              }
              setPage(nextPage);
            }}
            disabled={safePage <= 1}
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-16 text-center">{safePage} / {totalPages}</span>
          <button
            type="button"
            data-testid={paginationTestIdPrefix ? `${paginationTestIdPrefix}-next` : undefined}
            aria-label="下一页"
            title="下一页"
            onClick={() => {
              const nextPage = Math.min(totalPages, safePage + 1);
              if (isServerPaged && onPageChange) {
                onPageChange(nextPage);
                return;
              }
              setPage(nextPage);
            }}
            disabled={safePage >= totalPages}
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
