import React, { useState } from 'react';
import { AlertTriangle, Check, FileSpreadsheet, RotateCcw, Upload, X } from 'lucide-react';
import { parseTableFile, recognizeAndParseTable, type ParsedFormData } from '../services/freeAIService';

interface TableImportProps {
  onDataConfirmed: (data: any[], type: string) => void;
  onCancel: () => void;
}

const typeNames: Record<string, string> = {
  customer: '客户资料',
  order: '销售订单',
  sample: '样品申请',
  shipment: '物流信息',
  unknown: '未知类型',
};

const getTypeName = (type: string): string => typeNames[type] || '未知类型';

export const TableImport: React.FC<TableImportProps> = ({ onDataConfirmed, onCancel }) => {
  const [parsedData, setParsedData] = useState<ParsedFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setError('');
    setLoading(true);
    try {
      const table = await parseTableFile(selectedFile);
      setParsedData(recognizeAndParseTable(table));
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件解析失败，请检查文件格式和表头。');
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  };

  const handleConfirm = () => {
    if (!parsedData?.data.length) return;
    onDataConfirmed(parsedData.data, parsedData.type);
  };

  const previewRows = parsedData?.data.slice(0, 10) || [];
  const columns = Object.keys(previewRows[0] || {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 bg-blue-700 px-6 py-4 text-white dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black">
              <FileSpreadsheet size={22} /> 智能表格导入
            </h2>
            <p className="mt-1 text-sm font-bold text-blue-100">上传 Excel 或 CSV，系统先预览，确认后再写入业务数据。</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭导入窗口" className="rounded-full p-2 hover:bg-blue-800">
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {!parsedData ? (
            <div className="py-12 text-center">
              <FileSpreadsheet size={72} className="mx-auto text-blue-600" />
              <h3 className="mt-6 text-2xl font-black text-slate-900 dark:text-white">上传表格文件</h3>
              <p className="mt-2 text-sm font-bold text-slate-500">支持 .xlsx、.xls、.csv。请先核对识别结果，再确认导入。</p>

              <label className="mt-8 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-700 px-6 py-3 text-sm font-black text-white hover:bg-blue-800">
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} className="hidden" disabled={loading} />
                <Upload size={18} />
                {loading ? '解析中...' : '选择文件'}
              </label>

              {error ? (
                <div className="mx-auto mt-6 max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-4 text-left text-sm font-bold text-rose-700">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                </div>
              ) : null}

              <div className="mx-auto mt-10 grid max-w-4xl gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['客户资料', '客户名称、联系人、电话等主数据。'],
                  ['销售订单', '订单行、数量、价格等待核对数据。'],
                  ['样品申请', '样品名称、数量和收件信息。'],
                  ['物流信息', '运单号、承运方和状态。'],
                ].map(([title, desc]) => (
                  <div key={title} className="rounded-xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800">
                    <div className="font-black text-slate-900 dark:text-white">{title}</div>
                    <div className="mt-1 text-sm font-bold text-slate-500">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-xl font-black text-slate-900 dark:text-white">识别类型：{getTypeName(parsedData.type)}</h3>
                    <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">
                      置信度 {(parsedData.confidence * 100).toFixed(0)}%，共识别 {parsedData.data.length} 行。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedData(null);
                      setError('');
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <RotateCcw size={16} /> 重新上传
                  </button>
                </div>

                {parsedData.suggestions.length ? (
                  <div className="mt-4 rounded-xl bg-white p-4 text-sm font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    <div className="font-black text-slate-900 dark:text-white">导入建议</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {parsedData.suggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}
                    </ul>
                  </div>
                ) : null}

                {parsedData.warnings.length ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                    <div className="flex items-center gap-2 font-black">
                      <AlertTriangle size={16} /> 需要注意
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {parsedData.warnings.slice(0, 5).map((warning, index) => <li key={index}>{warning}</li>)}
                    </ul>
                    {parsedData.warnings.length > 5 ? <p className="mt-2">还有 {parsedData.warnings.length - 5} 条警告未显示。</p> : null}
                  </div>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm font-black text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  数据预览（前 10 行）
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-xs font-black uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <tr>
                        <th className="px-4 py-3 text-left">序号</th>
                        {columns.map(column => <th key={column} className="px-4 py-3 text-left whitespace-nowrap">{column}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {previewRows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 text-slate-500">{rowIndex + 1}</td>
                          {columns.map(column => (
                            <td key={column} className="max-w-[240px] truncate px-4 py-3 text-slate-800 dark:text-slate-100" title={String((row as any)[column] || '')}>
                              {typeof (row as any)[column] === 'object' ? JSON.stringify((row as any)[column]) : String((row as any)[column] || '-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsedData.data.length > 10 ? (
                  <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-center text-sm font-bold text-slate-500">
                    还有 {parsedData.data.length - 10} 行未显示。
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {parsedData ? (
          <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950">
            <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-black hover:bg-white dark:border-slate-700">
              取消
            </button>
            <button type="button" onClick={handleConfirm} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 text-sm font-black text-white hover:bg-blue-800">
              <Check size={16} /> 确认导入（{parsedData.data.length} 行）
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TableImport;
