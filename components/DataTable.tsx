import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, DollarSign, FileSpreadsheet, Search, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAppContext } from '../app/AppContext';

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  key: string;
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
  onImport?: (newData: T[]) => void;
  /** Optional export currency selector. */
  exportCurrencies?: string[];
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
  confirmed: { label: '已确认', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  shipped: { label: '已发货', cls: 'bg-violet-50 text-violet-600 border-violet-200' },
  delivered: { label: '已签收', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  completed: { label: '已完成', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-400 border-slate-200' },
  paid: { label: '已付款', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: '部分付款', cls: 'bg-orange-50 text-orange-600 border-orange-200' },
  unpaid: { label: '未付款', cls: 'bg-rose-50 text-rose-500 border-rose-200' },
  active: { label: '生效中', cls: 'bg-teal-50 text-teal-600 border-teal-200' },
  draft: { label: '草稿', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  verified: { label: '已核销', cls: 'bg-green-50 text-green-700 border-green-200' },
  approved: { label: '已审批', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  rejected: { label: '已驳回', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  open: { label: '进行中', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  closed: { label: '已关闭', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export const StatusBadge: React.FC<{ value: string }> = ({ value }) => {
  const cfg = STATUS_BADGE[String(value).toLowerCase()];
  if (!cfg) return <span className="text-sm text-slate-500">{value}</span>;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const DataTable = <T extends Record<string, any>>({
  title,
  columns,
  data,
  isLoading,
  onRowClick,
  rowTestId,
  actions,
  onImport,
  exportCurrencies,
}: DataTableProps<T>) => {
  const { t } = useAppContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [exportCurrency, setExportCurrency] = useState<string>(exportCurrencies?.[0] ?? 'CNY');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsPerPage = 15;

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const lower = searchTerm.toLowerCase();
    return data.filter((item) =>
      columns.some((col) =>
        typeof col.accessor === 'string' &&
        String(item[col.accessor as string] ?? '').toLowerCase().includes(lower)
      )
    );
  }, [data, searchTerm, columns]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const displayedData = useMemo(
    () => filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredData, currentPage]
  );

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result as string;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws) as Record<string, any>[];
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
        onImport(mapped);
      } catch (err) {
        console.error(err);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleExport = useCallback(() => {
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
  }, [data, columns, title, exportCurrency]);

  const renderCell = (row: T, col: Column<T>) => {
    const raw = typeof col.accessor === 'function' ? col.accessor(row) : row[col.accessor as keyof T];
    if (col.isStatus) return <StatusBadge value={String(raw ?? '')} />;
    return raw as React.ReactNode;
  };

  const pageNumbers = useMemo(() => {
    const delta = 2;
    const left = Math.max(1, currentPage - delta);
    const right = Math.min(totalPages, currentPage + delta);
    return Array.from({ length: right - left + 1 }, (_, i) => left + i);
  }, [currentPage, totalPages]);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/20 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-black tracking-tight text-slate-800 dark:text-white">{title}</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-black uppercase tracking-wider text-blue-500 dark:bg-blue-900/30 dark:text-blue-300">
              {filteredData.length} {t.records || '条记录'}
            </span>
            {searchTerm && (
              <span className="text-xs font-bold text-slate-400">已筛选 / 共 {data.length} 条</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              placeholder={t.search || '搜索...'}
              className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm font-medium outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-blue-900/30"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-2xl bg-slate-100 px-1 py-1 dark:bg-slate-800">
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
              onClick={handleExport}
              title="导出 Excel"
              className="flex items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-200"
            >
              <FileSpreadsheet size={13} />导出
            </button>
          </div>

          {onImport && (
            <>
              <input ref={fileInputRef} type="file" onChange={handleImport} className="hidden" accept=".xlsx,.xls,.csv" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-2xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <Upload size={13} />导入
              </button>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/30">
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-xs font-black uppercase  text-slate-400 whitespace-nowrap dark:text-slate-500
                    ${i === 0 ? 'pl-6' : ''}
                    ${col.isNumeric ? 'text-right' : 'text-left'}`}
                >
                  {col.header}
                </th>
              ))}
              {actions && (
                <th className="px-4 py-3 pr-6 text-right text-xs font-black uppercase  text-slate-400 whitespace-nowrap dark:text-slate-500">
                  操作
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {isLoading && (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-6 py-10 text-center text-sm font-bold text-slate-400">
                  Loading...
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
                    className={`px-4 py-3.5 text-sm text-slate-700 dark:text-slate-200
                      ${i === 0 ? 'pl-6 font-semibold' : 'font-medium'}
                      ${col.isNumeric ? 'text-right tabular-nums font-mono' : ''}`}
                  >
                    {renderCell(row, col)}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-3.5 pr-6 text-right">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      {actions(row)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && displayedData.length === 0 && (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center gap-3 text-slate-400">
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
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 dark:border-slate-800">
          <span className="text-xs font-medium text-slate-400">
            第 {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredData.length)} 条，共 {filteredData.length} 条
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded-xl p-1.5 text-slate-400 transition-all hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed dark:hover:bg-slate-800"
            >
              <ChevronLeft size={16} />
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCurrentPage(n)}
                className={`min-w-[32px] rounded-xl px-2 py-1 text-xs font-bold transition-all ${
                  n === currentPage
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
