import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Layers3, Save, X } from 'lucide-react';
import { productionService } from '../../services/production.service';

type Suggestion = {
  materialName: string;
  requiredQty: number;
  shortageQty: number;
  pickList: {
    stockBalanceId: number;
    locationId: number;
    locationName: string;
    batchNo: string;
    availableQty: number;
    deductQty: number;
  }[];
};

type CompletionIssue = {
  type?: string;
  severity?: string;
  material?: string;
  expected?: number;
  actual?: number;
  unit?: string;
  toleranceRate?: number;
  message?: string;
};

const formatCompletionIssue = (issue: CompletionIssue) => {
  const unit = issue.unit ? ` ${issue.unit}` : '';
  const expected = typeof issue.expected === 'number' ? issue.expected.toFixed(3) : null;
  const actual = typeof issue.actual === 'number' ? issue.actual.toFixed(3) : null;
  const tolerance = typeof issue.toleranceRate === 'number'
    ? `${(issue.toleranceRate * 100).toFixed(0)}%`
    : null;

  if (issue.type === 'missing_material') {
    return '未录入已确认耗料，请补录实际扣料批次和数量。';
  }
  if (issue.type === 'unit_mismatch') {
    return '库存单位与 BOM 单位不一致，请核对物料批次和计量单位。';
  }
  if (issue.type === 'quantity_under' && expected && actual) {
    return `实耗 ${actual}${unit} 低于理论 ${expected}${unit}${tolerance ? `（允许偏差 ${tolerance}）` : ''}。`;
  }
  if (issue.type === 'quantity_over' && expected && actual) {
    return `实耗 ${actual}${unit} 高于理论 ${expected}${unit}${tolerance ? `（允许偏差 ${tolerance}）` : ''}。`;
  }
  return issue.message || '完工校验未通过，请核对耗料记录。';
};

type Props = {
  workOrderId: number;
  productName: string;
  targetQuantity: number;
  onClose: () => void;
  onConfirm: (records: { stockBalanceId: number; quantity: number }[]) => Promise<void>;
};

export const CompleteWorkOrderModal: React.FC<Props> = ({
  workOrderId,
  productName,
  targetQuantity,
  onClose,
  onConfirm,
}) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<CompletionIssue[]>([]);
  const [records, setRecords] = useState<Record<number, number>>({});

  useEffect(() => {
    const fetchPreview = async () => {
      try {
        setLoading(true);
        const data = await productionService.previewWorkOrderConsumption(workOrderId);
        setSuggestions(data);

        const initialRecords: Record<number, number> = {};
        data.forEach((suggestion: Suggestion) => {
          suggestion.pickList.forEach((pick) => {
            if (pick.deductQty > 0) {
              initialRecords[pick.stockBalanceId] = pick.deductQty;
            }
          });
        });
        setRecords(initialRecords);
      } catch (err: any) {
        setError(err.message || '获取原料扣减建议失败');
      } finally {
        setLoading(false);
      }
    };

    fetchPreview();
  }, [workOrderId]);

  const handleDeductChange = (stockBalanceId: number, value: string) => {
    const num = Number(value);
    setRecords((prev) => ({ ...prev, [stockBalanceId]: num >= 0 ? num : 0 }));
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setError('');
      setIssues([]);

      const payload = Object.entries(records)
        .map(([stockBalanceId, quantity]) => ({
          stockBalanceId: Number(stockBalanceId),
          quantity: Number(quantity),
        }))
        .filter((record) => record.quantity > 0);

      await onConfirm(payload);
      onClose();
    } catch (err: any) {
      setError(err.message || '确认完工失败');
      setIssues(Array.isArray(err.issues) ? err.issues : []);
    } finally {
      setSubmitting(false);
    }
  };

  const hasShortage = suggestions.some((suggestion) => suggestion.shortageQty > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm">
      <div
        data-testid="production-complete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="production-complete-title"
        className="relative w-full max-w-4xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-[28px] sm:rounded-[36px] shadow-2xl border border-slate-100 dark:border-slate-800 p-4 sm:p-8"
      >
        <button
          onClick={onClose}
          aria-label="关闭完工确认"
          className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors motion-reduce:transition-none"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-[20px] bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Layers3 size={24} />
          </div>
          <div>
            <h2 id="production-complete-title" className="pr-10 text-lg sm:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">工单完工耗料确认</h2>
            <p className="text-sm font-bold text-slate-500 mt-1">
              工单: {productName} | 生产数量: {targetQuantity}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/40 flex items-start gap-3">
            <AlertCircle size={18} className="text-rose-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="text-sm font-bold text-rose-700 dark:text-rose-400">
                {issues.length > 0
                  ? `完工校验未通过，共 ${issues.length} 项。请修正下列耗料后重试。`
                  : error}
              </div>
              {issues.length > 0 && (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {issues.map((issue, index) => (
                    <div
                      key={`${issue.type || 'issue'}-${index}`}
                      data-testid="production-complete-issue"
                      className="rounded-xl bg-white/70 dark:bg-slate-950/40 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300"
                    >
                      <div>{issue.material || 'BOM 原料'}：{formatCompletionIssue(issue)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-10 h-10 border-4 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {hasShortage && (
              <div className="mb-6 rounded-[24px] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 flex gap-3">
                <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={18} />
                <div className="text-xs font-bold text-amber-700 dark:text-amber-400 leading-relaxed">
                  系统检测到部分原料库存不足，标红的物料缺口可能导致后续账务差异，请确认是否缺料生产，或手工调整其他替代料。
                </div>
              </div>
            )}

            <div className="space-y-4 mb-8">
              {suggestions.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm font-bold">无配套耗料或关联 BOM</div>
              ) : (
                suggestions.map((suggestion, idx) => (
                  <div
                    key={`${suggestion.materialName}-${idx}`}
                    className="rounded-[24px] border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60">
                      <div className="font-black text-sm text-slate-800 dark:text-slate-200">{suggestion.materialName}</div>
                      <div className="flex items-center gap-4 text-xs font-bold">
                        <span className="text-slate-500">
                          应扣需求: <span className="text-slate-900 dark:text-white">{suggestion.requiredQty.toFixed(2)}</span>
                        </span>
                        {suggestion.shortageQty > 0 && (
                          <span className="text-rose-500 flex items-center gap-1">
                            <AlertTriangle size={12} />
                            缺口: {suggestion.shortageQty.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    {suggestion.pickList.length === 0 ? (
                      <div className="px-5 py-4 text-xs font-bold text-slate-400 text-center">系统未找到对应的在库库存记录</div>
                    ) : (
                      <div className="p-3">
                        <table className="hidden w-full text-left max-w-full sm:table">
                          <thead>
                            <tr>
                              <th className="px-3 py-2 text-xs font-black uppercase text-slate-400">库位存放点</th>
                              <th className="px-3 py-2 text-xs font-black uppercase text-slate-400">原始批号</th>
                              <th className="px-3 py-2 text-xs font-black uppercase text-slate-400 text-right">可用库存</th>
                              <th className="px-3 py-2 text-xs font-black uppercase text-slate-400 text-right">确认扣减量</th>
                            </tr>
                          </thead>
                          <tbody>
                            {suggestion.pickList.map((pick) => (
                              <tr key={pick.stockBalanceId} className="border-t border-slate-100/50 dark:border-slate-800/50">
                                <td className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-300">{pick.locationName}</td>
                                <td className="px-3 py-2 text-xs text-slate-500 font-mono">{pick.batchNo}</td>
                                <td className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 text-right">
                                  {pick.availableQty.toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input
                                    data-testid={`production-complete-deduct-${pick.stockBalanceId}`}
                                    type="number"
                                    min="0"
                                    max={pick.availableQty}
                                    step="0.01"
                                    value={records[pick.stockBalanceId] ?? 0}
                                    onChange={(e) => handleDeductChange(pick.stockBalanceId, e.target.value)}
                                    className="w-24 text-right bg-white dark:bg-slate-900 border border-blue-200 dark:border-slate-700 px-2 py-1 rounded-lg text-xs font-bold text-blue-700 dark:text-blue-300 outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="space-y-2 sm:hidden" data-testid="production-complete-mobile-picks">
                          {suggestion.pickList.map((pick) => (
                            <div key={pick.stockBalanceId} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs font-black text-slate-800 dark:text-slate-100">{pick.locationName}</div>
                                  <div className="mt-1 break-all font-mono text-[11px] text-slate-500">批号 {pick.batchNo}</div>
                                </div>
                                <div className="shrink-0 text-right text-[11px] font-bold text-slate-500">
                                  可用 <span className="text-slate-900 dark:text-white">{pick.availableQty.toFixed(2)}</span>
                                </div>
                              </div>
                              <label className="mt-3 block text-xs font-black text-slate-600 dark:text-slate-300">
                                确认扣减量
                                <input
                                  data-testid={`production-complete-mobile-deduct-${pick.stockBalanceId}`}
                                  type="number"
                                  min="0"
                                  max={pick.availableQty}
                                  step="0.01"
                                  value={records[pick.stockBalanceId] ?? 0}
                                  onChange={(event) => handleDeductChange(pick.stockBalanceId, event.target.value)}
                                  className="mt-1 min-h-11 w-full rounded-xl border border-blue-200 bg-white px-3 text-right text-sm font-black text-blue-700 outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300"
                                />
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 pt-6 border-t border-slate-100 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-end">
              <button
                onClick={onClose}
                disabled={submitting}
                className="min-h-12 w-full px-6 py-3 rounded-[20px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-widest transition-colors motion-reduce:transition-none hover:bg-slate-200 dark:hover:bg-slate-700 sm:w-auto"
              >
                暂不完工
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                data-testid="production-complete-confirm"
                className="flex min-h-12 w-full items-center justify-center gap-2 px-8 py-3 rounded-[20px] bg-blue-600 text-white text-xs font-black uppercase tracking-widest transition-[transform,background-color,box-shadow] motion-reduce:transition-none hover:bg-blue-700 hover:scale-[1.02] motion-reduce:hover:scale-100 shadow-xl shadow-blue-500/20 active-shrink disabled:opacity-50 sm:w-auto"
              >
                <Save size={16} />
                确认扣减并完工
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
