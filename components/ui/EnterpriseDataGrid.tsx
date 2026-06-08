import React, { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileSpreadsheet, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ActionToolbar } from './ActionToolbar';
import { EmptyState } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { StatusBadge } from './StatusBadge';

export type EnterpriseColumn<T> = {
  key: string;
  header: React.ReactNode;
  accessor?: keyof T | ((row: T) => React.ReactNode);
  render?: (row: T) => React.ReactNode;
  searchText?: (row: T) => string;
  sortable?: boolean;
  isNumeric?: boolean;
  isStatus?: boolean;
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
  className = '',
}: Props<T>) {
  const [sortState, setSortState] = useState<SortState>(null);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);
  const [internalSearch, setInternalSearch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const effectiveSearchValue = typeof onSearchChange === 'function' ? searchValue : internalSearch;
  const isServerPaged = manualPagination && Boolean(pagination);

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

  const sortedData = useMemo(() => {
    if (isServerPaged || !sortState) return searchedData;
    const column = columns.find((item) => item.key === sortState.key);
    if (!column) return searchedData;
    return [...searchedData].sort((left, right) => {
      const a = column.searchText?.(left) ?? stringifyCell(getAccessorValue(left, column));
      const b = column.searchText?.(right) ?? stringifyCell(getAccessorValue(right, column));
      return sortState.direction === 'asc'
        ? a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
        : b.localeCompare(a, 'zh-Hans-CN', { numeric: true });
    });
  }, [columns, isServerPaged, searchedData, sortState]);

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
  const effectiveExportLabel = isServerPaged ? '导出当前页' : exportLabel;

  const handleExport = () => {
    const sheetRows = exportData.map((row) => (
      columns.map((column) => column.searchText?.(row) ?? stringifyCell(getAccessorValue(row, column)))
    ));
    const headers = columns.map((column) => stringifyCell(column.header) || column.key);
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
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
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

  return (
    <div className={`space-y-4 ${className}`}>
      <ActionToolbar
        title={title}
        description={description}
        searchValue={searchable ? effectiveSearchValue : undefined}
        onSearchChange={searchable ? (onSearchChange || setInternalSearch) : undefined}
        searchPlaceholder={searchPlaceholder}
        searchInputTestId={searchInputTestId}
        resultCount={isServerPaged && pagination ? pagination.total : searchedData.length}
        resultCountLabel={resultCountLabel || (isServerPaged && pagination ? `总 ${pagination.total}` : undefined)}
      >
        {onImport ? (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
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
        {toolbarActions}
      </ActionToolbar>

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
          <div className="overflow-x-auto">
            <table className="app-density-table w-full min-w-[980px] table-fixed border-collapse">
              <thead>
                <tr className="bg-slate-50/95 dark:bg-slate-800/95 shadow-sm">
                  {columns.map((column, columnIndex) => {
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
                        className={`inline-flex items-center gap-1 ${canSort ? 'hover:text-blue-600' : 'cursor-default'}`}
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
              <tbody>
                {pageData.map((row) => (
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
                    {columns.map((column, columnIndex) => {
                      const value = column.render ? column.render(row) : getAccessorValue(row, column);
                      return (
                        <td key={column.key} className={`px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 ${columnIndex === 0 ? 'sticky left-0 z-[5] bg-white group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800' : ''} ${column.isNumeric ? 'text-right font-data' : ''} ${column.className || ''}`}>
                          {column.isStatus ? (
                            <StatusBadge status={stringifyCell(value)} label={stringifyCell(value)} />
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
                        <div className="app-row-actions touch-actions-visible ml-auto flex max-w-[236px] items-center justify-end gap-1.5 overflow-x-auto whitespace-nowrap pb-1">
                          {rowActions(row)}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
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
            value={effectivePageSize}
            onChange={(event) => {
              const nextPageSize = Number(event.target.value);
              if (isServerPaged && onPageSizeChange) {
                onPageSizeChange(nextPageSize);
                return;
              }
              setPageSize(nextPageSize);
              setPage(1);
            }}
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 outline-none dark:border-slate-700 dark:bg-slate-800"
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
            onClick={() => {
              const nextPage = Math.max(1, safePage - 1);
              if (isServerPaged && onPageChange) {
                onPageChange(nextPage);
                return;
              }
              setPage(nextPage);
            }}
            disabled={safePage <= 1}
            className="rounded-xl border border-slate-200 bg-white p-2 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-16 text-center">{safePage} / {totalPages}</span>
          <button
            type="button"
            data-testid={paginationTestIdPrefix ? `${paginationTestIdPrefix}-next` : undefined}
            onClick={() => {
              const nextPage = Math.min(totalPages, safePage + 1);
              if (isServerPaged && onPageChange) {
                onPageChange(nextPage);
                return;
              }
              setPage(nextPage);
            }}
            disabled={safePage >= totalPages}
            className="rounded-xl border border-slate-200 bg-white p-2 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
