import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, DollarSign, FileSpreadsheet, Search, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAppContext } from '../app/AppContext';
import { StatusBadge as UnifiedStatusBadge } from './ui/StatusBadge';

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  key: string;
  /** Text used by EnterpriseDataGrid search when the visual cell is JSX. */
  searchText?: (row: T) => string;
  /** Numeric columns are right-aligned automatically. */
  isNumeric?: boolean;
  /** Status columns are rendered as semantic badges. */
  isStatus?: boolean;
  defaultVisible?: boolean;
}

interface DataTableProps<T> {
  tableId?: string;
  title: string;
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  onRowClick?: (row: T) => void;
  rowTestId?: (row: T, index: number) => string | undefined;
  actions?: (row: T) => React.ReactNode;
  onImport?: (newData: T[]) => void | Promise<void>;
  onExport?: () => void | Promise<void>;
  /** Optional export currency selector. */
  exportCurrencies?: string[];
  hideSearch?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  confirmed: '已确认',
  shipped: '已发货',
  delivered: '已签收',
  completed: '已完成',
  cancelled: '已取消',
  paid: '已付款',
  partial: '部分付款',
  unpaid: '未付款',
  active: '生效中',
  draft: '草稿',
  verified: '已核销',
  approved: '已审批',
  rejected: '已驳回',
  open: '进行中',
  closed: '已关闭',
};

export const StatusBadge: React.FC<{ value: string }> = ({ value }) => {
  const key = String(value || '').toLowerCase();
  return <UnifiedStatusBadge status={key || 'unknown'} label={STATUS_LABELS[key] || value || 'unknown'} />;
};

const getImportErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '文件解析失败，请检查表头、格式或文件是否损坏';
};

const stringifySearchValue = (value: React.ReactNode): string => {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifySearchValue).join(' ');
  if (React.isValidElement(value)) {
    try {
      const props = value.props as Record<string, any> | undefined;
      if (!props || !props.children) return '';
      return stringifySearchValue(props.children);
    } catch {
      return '';
    }
  }
  return '';
};

const renderSafeCellValue = (value: unknown): React.ReactNode => {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (React.isValidElement(value)) return value;
  if (Array.isArray(value)) return value.map(renderSafeCellValue).filter(Boolean).join(' ');
  return String(value);
};

const getCellTitle = (value: unknown): string | undefined => {
  if (React.isValidElement(value) || value === null || value === undefined || typeof value === 'boolean') return undefined;
  const text = String(renderSafeCellValue(value)).trim();
  return text.length > 18 ? text : undefined;
};

const DataTable = <T extends Record<string, any>>({
  tableId,
  title,
  columns,
  data,
  isLoading,
  onRowClick,
  rowTestId,
  actions,
  onImport,
  onExport,
  exportCurrencies,
  hideSearch = false,
  pagination,
}: DataTableProps<T>) => {
  const { t, notify } = useAppContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [exportCurrency, setExportCurrency] = useState<string>(exportCurrencies?.[0] ?? 'CNY');
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsPerPage = 15;

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const terms = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.filter((item) => {
      const haystack = columns.map((col) => {
        if (col.searchText) return col.searchText(item);
        const value = typeof col.accessor === 'function'
          ? col.accessor(item)
          : item[col.accessor as string];
        return stringifySearchValue(value);
      }).join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [data, searchTerm, columns]);

  const totalPages = pagination?.totalPages ?? Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const effectivePage = pagination?.page ?? currentPage;
  React.useEffect(() => {
    if (pagination) return;
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [pagination, totalPages]);
  const displayedData = useMemo(
    () => pagination ? data : filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [data, filteredData, currentPage, pagination]
  );

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result as string;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws) as Record<string, any>[];
        if (rawRows.length === 0) {
          notify('warning', `导入文件 ${file.name} 没有可读取的数据行`);
          return;
        }
        const normalize = (v: string) => v.replace(/\s+/g, '').toLowerCase();
        const mapped = rawRows.map((row) => {
          const out: Record<string, any> = { ...row };
          const keys = Object.keys(row);
          const normalized = keys.map((key) => ({ key, normalized: normalize(key) }));
          const pairs: Record<string, string[]> = {
            productName: ['中文品名', '品名', 'product', 'productname'],
            quantity: ['数量', 'qty', 'quantity'],
            unit: ['单位', 'unit'],
            batchNo: ['批次', '批次号', 'batch', 'batchno'],
            customerName: ['客户', '客户名称', 'customer', 'customername'],
            trackingNo: ['运单号', 'tracking', 'trackingno'],
          };

          Object.entries(pairs).forEach(([target, aliases]) => {
            const hit = normalized.find(({ normalized: current }) => aliases.map(normalize).includes(current));
            if (hit) out[target] = row[hit.key];
          });

          return out as T;
        });
        await onImport(mapped);
        notify('success', `已读取 ${mapped.length} 行导入数据，请保存后刷新回读确认`);
      } catch (err) {
        notify('error', `导入失败：${getImportErrorMessage(err)}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      notify('error', `导入失败：无法读取文件 ${file.name}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  const handleExport = useCallback(async () => {
    if (onExport) {
      setIsExporting(true);
      try {
        await onExport();
      } catch (error) {
        notify('error', error instanceof Error ? error.message : '导出失败，请稍后重试');
      } finally {
        setIsExporting(false);
      }
      return;
    }
    if (!data.length) return;
    const headers = columns.map((c) => c.header);
    const rows = data.map((row) =>
      columns.map((col) => {
        if (typeof col.accessor === 'string') return row[col.accessor as string] ?? '';
        return '';
      })
    );
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title);
    XLSX.writeFile(wb, `${title}_${exportCurrency}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [data, columns, title, exportCurrency, notify, onExport]);

  const renderCell = (row: T, col: Column<T>) => {
    const raw = typeof col.accessor === 'function' ? col.accessor(row) : row[col.accessor as keyof T];
    if (col.isStatus) return <StatusBadge value={String(raw ?? '')} />;
    if (React.isValidElement(raw)) return raw;
    return (
      <span className="truncate-cell" title={getCellTitle(raw)}>
        {renderSafeCellValue(raw)}
      </span>
    );
  };

  const pageNumbers = useMemo(() => {
    const delta = 2;
    const left = Math.max(1, effectivePage - delta);
    const right = Math.min(totalPages, effectivePage + delta);
    return Array.from({ length: right - left + 1 }, (_, i) => left + i);
  }, [effectivePage, totalPages]);

  return (
    <div className="app-density-surface rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/20 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-black tracking-tight text-slate-800 dark:text-white">{title}</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-black uppercase tracking-wider text-blue-500 dark:bg-blue-900/30 dark:text-blue-300">
              {pagination?.total ?? filteredData.length} {t.records || '条记录'}
            </span>
            {searchTerm && (
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">已筛选 / 共 {data.length} 条</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!hideSearch && <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              placeholder={t.search || '搜索...'}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm font-medium outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-900/30"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X size={13} />
              </button>
            )}
          </div>}

          <div className="flex items-center gap-1 rounded-xl bg-slate-100 px-1 py-1 dark:bg-slate-800">
            {exportCurrencies && exportCurrencies.length > 1 && (
              <div className="flex items-center gap-1">
                <DollarSign size={12} className="text-slate-400 ml-2" />
                <select
                  value={exportCurrency}
                  onChange={(e) => setExportCurrency(e.target.value)}
                  className="bg-transparent text-xs font-bold text-slate-600 outline-none dark:text-slate-300 pr-1"
                >
                  {exportCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <button
              type="button"
              onClick={() => { void handleExport(); }}
              disabled={isExporting || (!onExport && !data.length)}
              data-testid={tableId ? `${tableId}-export` : undefined}
              title="导出 Excel"
              className="flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200"
            >
              <FileSpreadsheet size={13} />{isExporting ? '导出中...' : '导出'}
            </button>
          </div>

          {onImport && (
            <>
              <input ref={fileInputRef} type="file" onChange={handleImport} className="hidden" accept=".xlsx,.xls,.csv" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <Upload size={13} />导入
              </button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="app-density-table min-w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/95 dark:border-slate-800 dark:bg-slate-800/95">
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={`sticky top-0 z-20 bg-slate-50/95 px-3 py-2.5 text-xs font-black uppercase text-slate-600 whitespace-nowrap dark:bg-slate-800/95 dark:text-slate-300
                    ${i === 0 ? 'pl-4' : ''}
                    ${col.isNumeric ? 'text-right' : 'text-left'}`}
                >
                  {col.header}
                </th>
              ))}
              {actions && (
                <th className="sticky right-0 top-0 z-30 w-[132px] bg-slate-50/95 px-3 py-2.5 pr-4 text-right text-xs font-black uppercase text-slate-600 whitespace-nowrap shadow-[-10px_0_16px_-14px_rgba(15,23,42,0.55)] dark:bg-slate-800/95 dark:text-slate-300">
                  操作
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {isLoading && (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-8 text-center text-sm font-bold text-slate-600 dark:text-slate-300">
                  正在加载...
                </td>
              </tr>
            )}
            {!isLoading && displayedData.map((row, index) => (
              <tr
                key={index}
                data-testid={rowTestId?.(row, index)}
                onClick={() => onRowClick?.(row)}
                className={`group transition-colors duration-150 ${
                  onRowClick
                    ? 'cursor-pointer hover:bg-blue-50/40 dark:hover:bg-blue-900/10'
                    : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/20'
                }`}
              >
                {columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200
                      ${i === 0 ? 'pl-4 font-semibold' : 'font-medium'}
                      ${col.isNumeric ? 'text-right tabular-nums font-mono' : ''}`}
                  >
                    {renderCell(row, col)}
                  </td>
                ))}
                {actions && (
                  <td className="sticky right-0 z-10 bg-white px-3 py-2.5 pr-4 text-right shadow-[-10px_0_16px_-14px_rgba(15,23,42,0.45)] dark:bg-slate-900">
                    <div className="app-row-actions touch-actions-visible flex min-w-[96px] items-center justify-end gap-1.5 opacity-100">
                      {actions(row)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && displayedData.length === 0 && (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3 text-slate-600 dark:text-slate-300">
                    <div className="w-12 h-12 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                      <Search size={22} strokeWidth={1.5} className="opacity-40" />
                    </div>
                    <span className="text-sm font-medium">
                      {searchTerm ? `未找到包含 "${searchTerm}" 的记录` : '暂无数据'}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            第 {(effectivePage - 1) * (pagination?.pageSize || itemsPerPage) + 1}-{Math.min(effectivePage * (pagination?.pageSize || itemsPerPage), pagination?.total ?? filteredData.length)} 条，共 {pagination?.total ?? filteredData.length} 条
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={effectivePage === 1}
              onClick={() => pagination ? pagination.onPageChange(Math.max(1, effectivePage - 1)) : setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded-xl p-1.5 text-slate-400 transition-all hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-slate-800"
            >
              <ChevronLeft size={16} />
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => pagination ? pagination.onPageChange(n) : setCurrentPage(n)}
                className={`min-w-[32px] rounded-xl px-2 py-1 text-xs font-bold transition-all ${
                  n === effectivePage
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              disabled={effectivePage === totalPages}
              onClick={() => pagination ? pagination.onPageChange(Math.min(totalPages, effectivePage + 1)) : setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-xl p-1.5 text-slate-400 transition-all hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-slate-800"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataTable;
