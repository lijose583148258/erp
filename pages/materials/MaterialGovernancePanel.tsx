import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  Link2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { useDialogFocus } from '../../app/useDialogFocus';
import { ConfirmDialog } from '../../components/ui';
import {
  materialService,
  type BomBackfillCandidate,
  type MaterialGovernanceRun,
} from '../../services/material.service';

const PAGE_SIZE = 20;

type Selection = Record<string, { checked: boolean; materialId: number | null }>;
type ConfirmState = { type: 'apply' } | { type: 'rollback'; run: MaterialGovernanceRun } | null;

const matchLabel: Record<BomBackfillCandidate['matchState'], string> = {
  exact_unique: '唯一精确匹配',
  exact_ambiguous: '存在多个精确匹配',
  unit_or_lifecycle_blocked: '单位或状态不符合',
  no_exact_match: '未找到精确匹配',
};

const formatRunSummary = (run: MaterialGovernanceRun) => {
  try {
    const summary = JSON.parse(run.summaryJson || '{}') as { mappingCount?: number; changedItems?: number };
    return `${summary.mappingCount || 0} 组来源 · ${summary.changedItems || run._count.changes} 条明细`;
  } catch {
    return `${run._count.changes} 条明细`;
  }
};

const MaterialGovernancePanel: React.FC<{ onClose: () => void; onApplied: () => void }> = ({
  onClose,
  onApplied,
}) => {
  const { notify } = useAppContext();
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<'candidates' | 'runs'>('candidates');
  const [candidates, setCandidates] = useState<BomBackfillCandidate[]>([]);
  const [totalUnlinked, setTotalUnlinked] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [runs, setRuns] = useState<MaterialGovernanceRun[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [selection, setSelection] = useState<Selection>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const selectedMappings = useMemo(() => candidates.flatMap(candidate => {
    const selected = selection[candidate.sourceKey];
    if (!selected?.checked || !selected.materialId || !candidate.expectedFingerprint) return [];
    return [{
      source: candidate.source,
      materialId: selected.materialId,
      expectedCount: candidate.occurrenceCount,
      expectedFingerprint: candidate.expectedFingerprint,
    }];
  }), [candidates, selection]);
  const selectedCount = useMemo(
    () => selectedMappings.reduce((total, mapping) => total + mapping.expectedCount, 0),
    [selectedMappings],
  );
  const isDirty = selectedMappings.length > 0;

  const requestClose = () => {
    if (isDirty) setConfirmClose(true);
    else onClose();
  };
  useDialogFocus(!confirmState && !confirmClose, dialogRef, requestClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const loadCandidates = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await materialService.listBackfillCandidates({
        limit: PAGE_SIZE,
        offset: candidateOffset,
      }, { signal });
      setCandidates(result.items);
      setTotalUnlinked(result.totalUnlinkedItems);
      setHasMore(result.hasMoreGroups);
      setSelection(Object.fromEntries(result.items.map(candidate => [
        candidate.sourceKey,
        { checked: false, materialId: candidate.recommendedMaterialId },
      ])));
    } catch (error) {
      if (!signal?.aborted) notify('error', error instanceof Error ? error.message : '历史 BOM 物料预览失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [candidateOffset, notify]);

  const loadRuns = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await materialService.listGovernanceRuns({
        limit: PAGE_SIZE,
        offset: runOffset,
      }, { signal });
      setRuns(result.items);
      setRunTotal(result.total);
    } catch (error) {
      if (!signal?.aborted) notify('error', error instanceof Error ? error.message : '治理记录读取失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [notify, runOffset]);

  useEffect(() => {
    const controller = new AbortController();
    if (tab === 'candidates') void loadCandidates(controller.signal);
    else void loadRuns(controller.signal);
    return () => controller.abort();
  }, [loadCandidates, loadRuns, tab]);

  const apply = async () => {
    if (!selectedMappings.length) return;
    setSubmitting(true);
    try {
      const result = await materialService.applyBomBackfill(selectedMappings);
      notify('success', result.idempotent
        ? '该批回填已经执行过，没有重复写入。'
        : `已安全关联 ${selectedCount} 条 BOM 明细，并生成可回滚审计批次。`);
      setConfirmState(null);
      setSelection({});
      onApplied();
      if (candidateOffset === 0) await loadCandidates();
      else setCandidateOffset(0);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '历史物料回填失败');
      setConfirmState(null);
      await loadCandidates();
    } finally {
      setSubmitting(false);
    }
  };

  const rollback = async (run: MaterialGovernanceRun) => {
    setSubmitting(true);
    try {
      const result = await materialService.rollbackGovernanceRun(run.id);
      notify('success', result.idempotent ? '该批次已经回滚，无需重复操作。' : '治理批次已完整回滚。');
      setConfirmState(null);
      onApplied();
      await loadRuns();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '治理批次回滚失败');
      setConfirmState(null);
      await loadRuns();
    } finally {
      setSubmitting(false);
    }
  };

  const patchSelection = (sourceKey: string, patch: Partial<Selection[string]>) => {
    setSelection(current => ({
      ...current,
      [sourceKey]: { ...current[sourceKey], ...patch },
    }));
  };

  return (
    <motion.div
      data-testid="material-governance-overlay"
      initial={{ opacity: reduceMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: reduceMotion ? 1 : 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16 }}
      className="fixed inset-0 z-[130] bg-slate-950/45 p-0 backdrop-blur-sm sm:p-4"
    >
      <motion.section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="material-governance-title"
        tabIndex={-1}
        initial={{ y: reduceMotion ? 0 : 24, opacity: reduceMotion ? 1 : 0.94 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: reduceMotion ? 0 : 24, opacity: reduceMotion ? 1 : 0.94 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden bg-slate-50 shadow-2xl outline-none dark:bg-slate-950 sm:rounded-3xl"
      >
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-blue-600">
                <ShieldCheck size={15} /> Admin governance
              </div>
              <h2 id="material-governance-title" className="mt-1 text-xl font-black text-slate-950 dark:text-white">
                历史 BOM 物料治理
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-300">
                这里只建立历史明细与正式物料的关系，不改历史名称、编码和单位。系统只提示精确匹配，最终决定必须由管理员逐组确认。
              </p>
            </div>
            <button type="button" aria-label="关闭历史物料治理" onClick={requestClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800">
              <X size={20} />
            </button>
          </div>

          <div className="mt-4 grid gap-2 rounded-2xl bg-slate-100 p-2 text-xs font-bold text-slate-600 dark:bg-slate-800/70 dark:text-slate-200 sm:grid-cols-3">
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 dark:bg-slate-900"><span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white">1</span>核对历史来源</div>
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 dark:bg-slate-900"><span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white">2</span>明确选择目标物料</div>
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 dark:bg-slate-900"><span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white">3</span>保存、回读与可回滚审计</div>
          </div>

          <nav aria-label="物料治理内容" className="mt-4 flex gap-2">
            <button type="button" onClick={() => setTab('candidates')} aria-current={tab === 'candidates' ? 'page' : undefined} className={`rounded-xl px-4 py-2 text-sm font-black ${tab === 'candidates' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200'}`}>
              待关联明细
            </button>
            <button type="button" onClick={() => setTab('runs')} aria-current={tab === 'runs' ? 'page' : undefined} className={`rounded-xl px-4 py-2 text-sm font-black ${tab === 'runs' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200'}`}>
              <span className="inline-flex items-center gap-2"><History size={15} />执行与回滚记录</span>
            </button>
          </nav>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          {tab === 'candidates' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900/40 dark:bg-blue-950/20">
                <div>
                  <p className="font-black text-blue-950 dark:text-blue-100">当前仍有 {totalUnlinked} 条 BOM 明细未关联正式物料</p>
                  <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-200">一组代表“历史名称 + 历史编码 + 单位”完全相同的明细；每次最多变更 500 条。</p>
                </div>
                <button type="button" onClick={() => void loadCandidates()} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-200">
                  <RefreshCw size={14} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />重新预览
                </button>
              </div>

              <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
                <table className="min-w-[980px] w-full table-fixed">
                  <caption className="sr-only">历史 BOM 物料来源与目标物料关联决策</caption>
                  <thead className="bg-slate-50 text-left text-xs font-black text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">
                    <tr>
                      <th scope="col" className="w-[29%] px-4 py-3">历史来源（不会被改写）</th>
                      <th scope="col" className="w-[16%] px-4 py-3">影响范围</th>
                      <th scope="col" className="w-[38%] px-4 py-3">目标正式物料</th>
                      <th scope="col" className="w-[17%] px-4 py-3">本次决定</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {candidates.map(candidate => {
                      const current = selection[candidate.sourceKey];
                      const eligible = candidate.suggestions.filter(item => item.eligible);
                      const selectable = eligible.length > 0 && Boolean(candidate.expectedFingerprint) && !candidate.overLimit;
                      return (
                        <tr key={candidate.sourceKey} data-testid="material-backfill-candidate">
                          <td className="px-4 py-4 align-top">
                            <p className="font-black text-slate-950 dark:text-white">{candidate.source.materialName}</p>
                            <p className="mt-1 text-xs text-slate-500">历史编码：{candidate.source.materialCode || '未填写'} · 单位：{candidate.source.unit}</p>
                          </td>
                          <td className="px-4 py-4 align-top text-xs">
                            <p className="font-black text-slate-700 dark:text-slate-200">{candidate.occurrenceCount} 条明细</p>
                            <p className={`mt-1 font-bold ${candidate.matchState === 'exact_unique' && !candidate.overLimit ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {candidate.overLimit ? '超过单批上限' : matchLabel[candidate.matchState]}
                            </p>
                            <p className="mt-2 line-clamp-2 text-slate-400">{candidate.sampleBoms.map(item => `${item.bomNo} ${item.productName}`).join('；') || '暂无配方样例'}</p>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <label className="block">
                              <span className="sr-only">为 {candidate.source.materialName} 选择目标物料</span>
                              <select
                                data-testid="material-backfill-target"
                                value={current?.materialId || ''}
                                disabled={!selectable}
                                onChange={event => patchSelection(candidate.sourceKey, { materialId: Number(event.target.value) || null, checked: false })}
                                className="app-control"
                              >
                                <option value="">请选择正式物料</option>
                                {candidate.suggestions.map(item => (
                                  <option key={item.materialId} value={item.materialId} disabled={!item.eligible}>
                                    {item.code} · {item.nameZh} · {item.baseUnit}{item.eligible ? '' : '（状态或单位不符）'}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p className="mt-1.5 text-xs text-slate-400">
                              {eligible.length === 1 ? '系统已预填唯一精确匹配，但不会自动勾选或写入。' : eligible.length > 1 ? '存在多个候选，请先核对编码、名称和单位。' : '请先到物料主数据建立或审核正式物料。'}
                            </p>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <label className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black ${selectable && current?.materialId ? 'cursor-pointer border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200' : 'cursor-not-allowed border-slate-100 text-slate-300 dark:border-slate-800 dark:text-slate-600'}`}>
                              <input
                                data-testid="material-backfill-confirm"
                                type="checkbox"
                                checked={Boolean(current?.checked)}
                                disabled={!selectable || !current?.materialId}
                                onChange={event => patchSelection(candidate.sourceKey, { checked: event.target.checked })}
                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              我已核对，加入本批
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 lg:hidden">
                {candidates.map(candidate => {
                  const current = selection[candidate.sourceKey];
                  const eligible = candidate.suggestions.filter(item => item.eligible);
                  const selectable = eligible.length > 0 && Boolean(candidate.expectedFingerprint) && !candidate.overLimit;
                  return (
                    <article key={candidate.sourceKey} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="font-black text-slate-950 dark:text-white">{candidate.source.materialName}</p><p className="mt-1 text-xs text-slate-500">{candidate.source.materialCode || '无历史编码'} · {candidate.source.unit}</p></div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-200">{candidate.occurrenceCount} 条</span>
                      </div>
                      <p className={`mt-3 text-xs font-black ${candidate.matchState === 'exact_unique' && !candidate.overLimit ? 'text-emerald-600' : 'text-amber-600'}`}>{candidate.overLimit ? '超过单批 500 条上限' : matchLabel[candidate.matchState]}</p>
                      <label className="mt-3 block space-y-1.5">
                        <span className="text-xs font-black text-slate-500">关联到哪一条正式物料？</span>
                        <select value={current?.materialId || ''} disabled={!selectable} onChange={event => patchSelection(candidate.sourceKey, { materialId: Number(event.target.value) || null, checked: false })} className="app-control">
                          <option value="">请选择正式物料</option>
                          {candidate.suggestions.map(item => <option key={item.materialId} value={item.materialId} disabled={!item.eligible}>{item.code} · {item.nameZh} · {item.baseUnit}</option>)}
                        </select>
                      </label>
                      <label className="mt-3 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700 dark:border-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={Boolean(current?.checked)} disabled={!selectable || !current?.materialId} onChange={event => patchSelection(candidate.sourceKey, { checked: event.target.checked })} className="h-4 w-4 rounded" />
                        我已核对来源、目标和单位
                      </label>
                    </article>
                  );
                })}
              </div>

              {!loading && candidates.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <CheckCircle2 className="mx-auto text-emerald-600" />
                  <p className="mt-3 font-black text-emerald-900 dark:text-emerald-100">当前没有待关联的历史 BOM 明细</p>
                </div>
              ) : null}
              {loading ? <div className="p-8 text-center text-sm font-black text-slate-400">正在逐组核对历史来源与正式物料……</div> : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="font-black text-slate-900 dark:text-white">每次执行都保留操作者、时间、输入指纹和逐条变更</p>
                <p className="mt-1 text-xs text-slate-500">回滚只撤销仍保持原目标的关联；如果后续业务已经修改，系统会拒绝整批回滚，避免覆盖新数据。</p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {runs.map(run => (
                  <div key={run.id} className="flex flex-col gap-3 border-b border-slate-100 p-4 last:border-b-0 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-black text-slate-950 dark:text-white">{run.runNo}</p>
                        <span className={`rounded-full px-2 py-1 text-xs font-black ${run.status === 'applied' ? 'bg-blue-100 text-blue-700' : run.status === 'rolled_back' ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300' : 'bg-amber-100 text-amber-700'}`}>
                          {run.status === 'applied' ? '已执行' : run.status === 'rolled_back' ? '已回滚' : '回滚受阻'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">{formatRunSummary(run)}</p>
                      <p className="mt-1 text-xs text-slate-400">{new Date(run.createdAt).toLocaleString()}</p>
                    </div>
                    {run.status === 'applied' ? (
                      <button type="button" onClick={() => setConfirmState({ type: 'rollback', run })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 text-xs font-black text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:border-rose-900 dark:text-rose-300">
                        <RotateCcw size={15} />回滚本批
                      </button>
                    ) : null}
                  </div>
                ))}
                {!loading && runs.length === 0 ? <div className="p-10 text-center text-sm font-black text-slate-400">还没有执行过历史物料治理</div> : null}
                {loading ? <div className="p-10 text-center text-sm font-black text-slate-400">正在读取审计批次……</div> : null}
              </div>
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          {tab === 'candidates' ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-2">
                  <button type="button" aria-label="上一页待关联来源" disabled={candidateOffset === 0} onClick={() => setCandidateOffset(value => Math.max(0, value - PAGE_SIZE))} className="rounded-xl border border-slate-200 p-2 disabled:opacity-30 dark:border-slate-700"><ChevronLeft size={16} /></button>
                  <button type="button" aria-label="下一页待关联来源" disabled={!hasMore} onClick={() => setCandidateOffset(value => value + PAGE_SIZE)} className="rounded-xl border border-slate-200 p-2 disabled:opacity-30 dark:border-slate-700"><ChevronRight size={16} /></button>
                </div>
                <p aria-live="polite" className={`text-xs font-bold ${selectedCount > 500 ? 'text-rose-600' : 'text-slate-500'}`}>
                  已选 {selectedMappings.length} 组 · {selectedCount} 条{selectedCount > 500 ? '（超过单批上限，请减少选择）' : ''}
                </p>
              </div>
              <button type="button" data-testid="material-backfill-apply" disabled={!selectedMappings.length || selectedCount > 500 || submitting} onClick={() => setConfirmState({ type: 'apply' })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-lg shadow-blue-600/20 disabled:cursor-not-allowed disabled:opacity-40">
                <Link2 size={16} />核对并执行本批关联<ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500">共 {runTotal} 个治理批次</p>
              <div className="flex gap-2">
                <button type="button" aria-label="上一页治理记录" disabled={runOffset === 0} onClick={() => setRunOffset(value => Math.max(0, value - PAGE_SIZE))} className="rounded-xl border border-slate-200 p-2 disabled:opacity-30 dark:border-slate-700"><ChevronLeft size={16} /></button>
                <button type="button" aria-label="下一页治理记录" disabled={runOffset + PAGE_SIZE >= runTotal} onClick={() => setRunOffset(value => value + PAGE_SIZE)} className="rounded-xl border border-slate-200 p-2 disabled:opacity-30 dark:border-slate-700"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </footer>
      </motion.section>

      <ConfirmDialog
        open={confirmState?.type === 'apply'}
        title={`确认关联 ${selectedMappings.length} 组、共 ${selectedCount} 条 BOM 明细？`}
        description="系统会在一个事务中写入关系并立即回读；历史名称、编码和单位保持不变。预览后只要任一明细发生变化，本批就会整体拒绝。"
        confirmLabel="确认执行并生成审计批次"
        tone="success"
        loading={submitting}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => void apply()}
      />
      <ConfirmDialog
        open={confirmState?.type === 'rollback'}
        title="确认回滚这个治理批次？"
        description="只撤销本批建立的物料关系，不删除 BOM 明细，也不改历史文本。存在后续变更时会整体拒绝回滚。"
        confirmLabel="确认整批回滚"
        tone="danger"
        loading={submitting}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (confirmState?.type === 'rollback') void rollback(confirmState.run);
        }}
      />
      <ConfirmDialog
        open={confirmClose}
        title="放弃本页已核对的关联选择？"
        description="当前选择尚未提交。关闭后不会写入任何数据，但本页勾选会被清空。"
        confirmLabel="放弃并关闭"
        tone="danger"
        onCancel={() => setConfirmClose(false)}
        onConfirm={onClose}
      />
    </motion.div>
  );
};

export default MaterialGovernancePanel;
