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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div
        data-testid="production-complete-modal"
        className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-[36px] shadow-2xl border border-slate-100 dark:border-slate-800 p-8"
      >
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-[20px] bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Layers3 size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">工单完工耗料确认</h2>
            <p className="text-sm font-bold text-slate-500 mt-1">
              工单: {productName} | 生产数量: {targetQuantity}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/40 flex items-start gap-3">
            <AlertCircle size={18} className="text-rose-500 shrink-0 mt-0.5" />
            <div className="space-y-3">
              <div className="text-sm font-bold text-rose-700 dark:text-rose-400">{error}</div>
              {issues.length > 0 && (
                <div className="space-y-2">
                  {issues.map((issue, index) => (
                    <div
                      key={`${issue.type || 'issue'}-${index}`}
                      data-testid="production-complete-issue"
                      className="rounded-xl bg-white/70 dark:bg-slate-950/40 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-300"
                    >
                      <div>{issue.material || 'BOM 原料'}：{issue.message || '完工校验未通过'}</div>
                      {typeof issue.expected === 'number' && typeof issue.actual === 'number' && (
                        <div className="mt-1 text-rose-500/80">
                          理论 {issue.expected.toFixed(3)} {issue.unit || ''} / 实耗 {issue.actual.toFixed(3)} {issue.unit || ''}
                        </div>
                      )}
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
                    key={idx}
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
                        <table className="w-full text-left max-w-full">
                          <thead>
                            <tr>
                              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400">库位存放点</th>
                              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400">原始批号</th>
                              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400 text-right">可用库存</th>
                              <th className="px-3 py-2 text-[10px] font-black uppercase text-slate-400 text-right">确认扣减量</th>
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
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-6 py-3 rounded-[20px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-widest transition hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                暂不完工
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                data-testid="production-complete-confirm"
                className="flex items-center gap-2 px-8 py-3 rounded-[20px] bg-blue-600 text-white text-xs font-black uppercase tracking-widest transition hover:bg-blue-700 hover:scale-[1.02] shadow-xl shadow-blue-500/20 active-shrink disabled:opacity-50"
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
