import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { MaterialMasterCombobox } from '../../components/materials/MaterialMasterCombobox';
import type { MaterialMaster } from '../../services/material.service';
import { materialDensityService, type DensityRevision } from '../../services/materialDensity.service';
import { productionService } from '../../services/production.service';

type Props = { onCreated: () => Promise<void> | void };

const fieldClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-blue-900/40';
const buttonClass = 'min-h-11 rounded-xl border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:text-blue-200';

const asPositive = (value: string, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}必须是大于 0 的数字`);
  return number;
};

/**
 * The only authoring path for density v1 intentionally creates exactly one
 * 100% input line. It keeps its immutable source selection separate from the
 * generic BOM grid, where a client-editable conversion value would be unsafe.
 */
export function DensityConversionWorkbench({ onCreated }: Props) {
  const { currentUser } = useAppContext();
  const [output, setOutput] = useState<MaterialMaster | null>(null);
  const [outputText, setOutputText] = useState('');
  const [input, setInput] = useState<MaterialMaster | null>(null);
  const [inputText, setInputText] = useState('');
  const [revisions, setRevisions] = useState<DensityRevision[]>([]);
  const [revisionId, setRevisionId] = useState('');
  const [version, setVersion] = useState('density-v1');
  const [standardBatchSize, setStandardBatchSize] = useState('1');
  const [shelfLifeDays, setShelfLifeDays] = useState('365');
  const [qualityCode, setQualityCode] = useState('');
  const [qualityName, setQualityName] = useState('');
  const [qualityLowerLimit, setQualityLowerLimit] = useState('');
  const [qualityUpperLimit, setQualityUpperLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [savedRevision, setSavedRevision] = useState(0);
  const lock = useRef(false);
  const selectedRevision = revisions.find(row => row.id === Number(revisionId) && row.status === 'approved') || null;
  useUnsavedForm({
    sourceId: 'density-conversion-workbench',
    label: '批次密度换算 BOM',
    open: true,
    resetKey: savedRevision,
    value: { output: output?.id ?? null, input: input?.id ?? null, revisionId, version, standardBatchSize, shelfLifeDays, qualityCode, qualityName, qualityLowerLimit, qualityUpperLimit },
  });

  useEffect(() => {
    let live = true;
    setRevisions([]);
    setRevisionId('');
    if (input) materialDensityService.list(input.id)
      .then(rows => { if (live) setRevisions(rows.filter(row => row.status === 'approved')); })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : '读取批准密度依据失败'); });
    return () => { live = false; };
  }, [input]);

  const selectOutput = (material: MaterialMaster) => {
    setOutput(material); setOutputText(material.nameZh); setError(''); setMessage('');
    if (material.shelfLifeDays) setShelfLifeDays(String(material.shelfLifeDays));
  };
  const selectInput = (material: MaterialMaster) => {
    setInput(material); setInputText(material.nameZh); setError(''); setMessage('');
  };

  const create = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      if (!output || !input || !selectedRevision) throw new Error('请选择成品、原料和一条已批准的真实批次密度依据');
      if (selectedRevision.materialId !== input.id || selectedRevision.baseUnit !== input.baseUnit) throw new Error('所选密度依据不属于当前原料及其主单位；请重新选择。');
      if (!qualityCode.trim() || !qualityName.trim() || (!qualityLowerLimit.trim() && !qualityUpperLimit.trim())) {
        throw new Error('受控化工配方必须填写至少一个结构化质检项目及其判定范围。');
      }
      const created = await productionService.createBom({
        materialId: output.id,
        productName: output.nameZh,
        version: version.trim() || 'density-v1',
        bomType: 'chemical_formula',
        status: 'active',
        formulationMode: 'percentage',
        outputUnit: output.baseUnit,
        shelfLifeDays: Math.round(asPositive(shelfLifeDays, '保质期')),
        standardBatchSize: asPositive(standardBatchSize, '标准批量'),
        batchSizeUnit: output.baseUnit,
        qualityCharacteristics: [{
          code: qualityCode.trim().toUpperCase(), name: qualityName.trim(), valueType: 'numeric',
          lowerLimit: qualityLowerLimit.trim() || null, upperLimit: qualityUpperLimit.trim() || null,
        }],
        items: [{
          materialId: input.id, materialName: input.nameZh, materialCode: input.code,
          dosageMode: 'density_percentage_v1', densityRevisionId: selectedRevision.id,
          percentage: 100, quantityPerUnit: 1, unit: input.baseUnit,
          lossRate: 0, allowedVarianceRate: 0,
        }],
      });
      const readback = (await productionService.getBoms()).find(row => row.id === created.id);
      const line = readback?.items?.[0];
      const snapshot = line?.densitySnapshotJson ? JSON.parse(line.densitySnapshotJson) : null;
      if (!readback || !line || line.dosageMode !== 'density_percentage_v1' || line.densityRevisionId !== selectedRevision.id
        || !snapshot || snapshot.revisionId !== selectedRevision.id || snapshot.batchNo !== selectedRevision.batchNo
        || snapshot.temperatureC !== selectedRevision.temperatureC || snapshot.pressureKpaAbs !== selectedRevision.pressureKpaAbs
        || snapshot.compositionReference !== selectedRevision.compositionReference || !(Number(line.quantityPerUnit) > 0)) {
        throw new Error('密度换算 BOM 保存后回读不一致；没有继续创建工单。');
      }
      await onCreated();
      setSavedRevision(value => value + 1);
      setMessage(`已保存并回读 ${readback.bomNo}：服务器冻结批次 ${selectedRevision.batchNo} 的密度条件，并计算单位单耗 ${line.quantityPerUnit} ${line.unit}/${output.baseUnit}。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建密度换算 BOM 失败，输入未清空。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <details className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-5 dark:border-cyan-900/60 dark:bg-cyan-950/10" data-testid="density-conversion-workbench">
    <summary className="cursor-pointer text-lg font-black text-slate-900 dark:text-white">批次密度换算 BOM · 受控建版</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">仅可使用一条已批准的真实原料批次密度依据。服务端冻结批号、密度、温度、绝对压力、组分、方法及来源，并自行计算体积单耗；不能由页面填写快照或覆盖换算结果。完工时仍须逐项录入并核对实际条件。</p>
      {error ? <p role="alert" className="text-sm font-bold text-rose-700 dark:text-rose-300">{error}</p> : null}
      {message ? <p role="status" className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      <fieldset disabled={busy || !can(currentUser, 'production.write')} className="grid gap-4 md:grid-cols-2">
        <MaterialMasterCombobox label="输出成品 / 半成品" value={outputText} selectedMaterialId={output?.id ?? null} onTextChange={setOutputText} onClearSelection={() => setOutput(null)} onSelect={selectOutput} dataTestId="density-conversion-output" allowedCategories={['finished_good', 'semi_finished']} />
        <MaterialMasterCombobox label="按体积领用的原料" value={inputText} selectedMaterialId={input?.id ?? null} onTextChange={setInputText} onClearSelection={() => setInput(null)} onSelect={selectInput} dataTestId="density-conversion-input" allowedCategories={['raw_material', 'semi_finished']} />
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">已批准批次密度依据<select data-testid="density-conversion-revision" className={`${fieldClass} mt-1`} value={revisionId} onChange={event => setRevisionId(event.target.value)}><option value="">选择已批准依据</option>{revisions.map(row => <option key={row.id} value={row.id}>{row.batchNo} · {row.specCode}/{row.version} · {row.densityKgPerL} kg/L @ {row.temperatureC} °C / {row.pressureKpaAbs} kPa</option>)}</select></label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">BOM 版本<input data-testid="density-conversion-version" className={`${fieldClass} mt-1`} value={version} onChange={event => setVersion(event.target.value)} /></label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">标准批量（{output?.baseUnit || '输出单位'}）<input data-testid="density-conversion-standard-batch" className={`${fieldClass} mt-1`} inputMode="decimal" value={standardBatchSize} onChange={event => setStandardBatchSize(event.target.value)} /></label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">成品保质期（天）<input data-testid="density-conversion-shelf-life" className={`${fieldClass} mt-1`} inputMode="numeric" value={shelfLifeDays} onChange={event => setShelfLifeDays(event.target.value)} /></label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">QC 项目编码<input data-testid="density-conversion-qc-code" className={`${fieldClass} mt-1`} value={qualityCode} onChange={event => setQualityCode(event.target.value)} placeholder="例如 VISC" /></label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">QC 项目名称<input data-testid="density-conversion-qc-name" className={`${fieldClass} mt-1`} value={qualityName} onChange={event => setQualityName(event.target.value)} placeholder="例如 粘度" /></label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">QC 下限（至少填一边）<input data-testid="density-conversion-qc-lower" className={`${fieldClass} mt-1`} inputMode="decimal" value={qualityLowerLimit} onChange={event => setQualityLowerLimit(event.target.value)} /></label>
        <label className="text-sm font-bold text-slate-700 dark:text-slate-200">QC 上限（至少填一边）<input data-testid="density-conversion-qc-upper" className={`${fieldClass} mt-1`} inputMode="decimal" value={qualityUpperLimit} onChange={event => setQualityUpperLimit(event.target.value)} /></label>
      </fieldset>
      {selectedRevision ? <div data-testid="density-conversion-frozen-source" className="rounded-xl border border-cyan-200 bg-white/75 p-3 text-sm leading-6 text-slate-700 dark:border-cyan-900 dark:bg-slate-950/60 dark:text-slate-200">冻结候选：批次 {selectedRevision.batchNo}；{selectedRevision.densityKgPerL} kg/L；{selectedRevision.temperatureC} °C；{selectedRevision.pressureKpaAbs} kPa（绝对）；组分/条件 {selectedRevision.compositionReference}；方法 {selectedRevision.methodReference}；来源 {selectedRevision.sourceReference}。</div> : null}
      {!can(currentUser, 'production.write') ? <p className="text-sm font-bold text-amber-700 dark:text-amber-300">当前角色仅可查看，不能创建 BOM 版本。</p> : <button type="button" data-testid="density-conversion-save" className={buttonClass} disabled={busy} onClick={() => void create()}>{busy ? '保存并回读中…' : '保存受控密度换算 BOM'}</button>}
    </div>
  </details>;
}
