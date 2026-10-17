import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { MaterialMasterCombobox } from '../../components/materials/MaterialMasterCombobox';
import { FormField } from '../../components/ui';
import type { MaterialMaster } from '../../services/material.service';
import { materialDensityService, type DensityInput, type DensityRevision } from '../../services/materialDensity.service';

const blank = (): DensityInput => ({ batchNo:'',specCode:'',version:'',densityKgPerL:'',temperatureC:'',pressureKpaAbs:'',compositionReference:'',methodReference:'',sourceReference:'',measuredAt:'' });
const button = 'min-h-11 rounded-xl border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-50 dark:border-blue-800 dark:text-blue-200';
const fields: Array<[keyof DensityInput,string]> = [
  ['batchNo','适用批次号（必须属于所选物料）'],['specCode','依据编码'],['version','依据版本'],
  ['densityKgPerL','密度 kg/L'],['temperatureC','测定温度 °C'],['pressureKpaAbs','测定绝对压力 kPa'],
  ['compositionReference','组分 / 浓度及适用条件依据'],['methodReference','测定方法 / 报告方法编号'],
  ['sourceReference','来源文件 / 检测报告编号'],['measuredAt','测定时间（本地时间）'],
];

export function DensityWorkbench() {
  const { currentUser } = useAppContext();
  const [material,setMaterial] = useState<MaterialMaster | null>(null), [text,setText] = useState('');
  const [form,setForm] = useState(blank), [rows,setRows] = useState<DensityRevision[]>([]);
  const [pending,setPending] = useState<{row:DensityRevision;action:'approve'|'retire'} | null>(null), [reason,setReason] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  const lock = useRef(false);
  const unsaved = useUnsavedForm({sourceId:'density-workbench',label:'批次密度依据',open:true,value:{form,reason}});
  useEffect(() => {
    let live=true;setRows([]);setPending(null);setError('');setMessage('');
    if(material)materialDensityService.list(material.id).then(r=>{if(live)setRows(r);}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[material]);
  const act = async (work:()=>Promise<void>) => {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
    try { await work(); } catch(e) {setError(e instanceof Error?e.message:'操作失败，输入已保留');}
    finally {lock.current=false;setBusy(false);}
  };
  const select = (m:MaterialMaster) => unsaved.requestClose(()=>{setMaterial(m);setText(m.nameZh);setForm(blank());setReason('');});
  const create = () => act(async()=>{
    if(!material)throw Error('请选择物料');
    if(!form.measuredAt || !Number.isFinite(Date.parse(form.measuredAt)))throw Error('请填写真实测定时间');
    const saved=await materialDensityService.create(material.id,{...form,measuredAt:new Date(form.measuredAt).toISOString()});
    const read=await materialDensityService.list(material.id), found=read.find(r=>r.id===saved.id);
    if(!found || JSON.stringify(found)!==JSON.stringify(saved))throw Error('密度依据回读不一致，请刷新核查，不要重复创建');
    setRows(read);setForm(blank());setMessage('密度依据草稿已保存并回读，等待另一人核对。');
  });
  const review = () => act(async()=>{
    if(!pending || !reason.trim())throw Error('请填写审核或停用依据');
    const saved=await materialDensityService.review(pending.row,pending.action,reason.trim());
    const read=await materialDensityService.list(saved.materialId), found=read.find(r=>r.id===saved.id);
    if(!found || found.status!==saved.status || found.updatedAt!==saved.updatedAt)throw Error('审批回读不一致，请刷新核查');
    setRows(read);setPending(null);setReason('');setMessage('密度依据状态已回读；未改变批次 QC、库存或成本。');
  });
  return <details className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" data-testid="density-workbench">
    <summary className="cursor-pointer text-lg font-black text-slate-900 dark:text-white">批次密度依据 · 独立核对台账</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">仅登记与冻结来源依据，不执行体积/质量换算。批准不是批次 QC 放行，不改变库存或成本。测定点以外条件不得自动外推；更正另建版本。</p>
      <fieldset disabled={busy}><MaterialMasterCombobox label="密度对应物料" value={text} selectedMaterialId={material?.id??null} onTextChange={setText} onClearSelection={()=>setMaterial(null)} onSelect={select} dataTestId="density-material" allowedCategories={['raw_material','semi_finished']} /></fieldset>
      {error && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{message}</p>}
      {material && can(currentUser,'materials.write') && <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 font-bold">新建不可覆写的密度依据草稿</legend>
        {fields.map(([key,label])=><FormField key={key} label={label} value={form[key]} type={key==='measuredAt'?'datetime-local':'text'} onChange={value=>setForm(v=>({...v,[key]:value}))} dataTestId={`density-${key}`} />)}
        <button type="button" className={button} onClick={create}>保存密度依据草稿并回读</button>
      </fieldset>}
      {material && <><button type="button" className={button} disabled={busy} onClick={()=>void act(async()=>setRows(await materialDensityService.list(material.id)))}>刷新密度依据</button>
        <ul className="space-y-3">{rows.map(row=><li key={row.id} data-testid={`density-revision-${row.id}`} className="space-y-2 break-words rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="font-bold">{row.specCode} / {row.version} · {row.status==='approved'?'已核对批准':row.status==='retired'?'已停用':'待独立核对'}</p>
          <p>批次 {row.batchNo} · {row.densityKgPerL} kg/L · {row.temperatureC} °C · {row.pressureKpaAbs} kPa（绝对压力）</p>
          <p className="text-sm">组分/条件：{row.compositionReference}；方法：{row.methodReference}；来源：{row.sourceReference}</p>
          <p className="text-sm">测定：{new Date(row.measuredAt).toLocaleString('zh-CN')}；编制人 #{row.createdBy}；批准人 {row.approvedBy?`#${row.approvedBy}`:'未批准'}</p>
          {row.approvedAt && <p className="text-sm">批准时间：{new Date(row.approvedAt).toLocaleString('zh-CN')}</p>}
          {row.reviewReason && <p className="text-sm">核对依据：{row.reviewReason}</p>}{row.retireReason && <p className="text-sm">停用依据：{row.retireReason}</p>}
          {can(currentUser,'materials.govern') && row.status!=='retired' && <div className="flex flex-wrap gap-2">
            {row.status==='draft' && Number(currentUser.id)!==row.createdBy && <button type="button" className={button} disabled={busy} onClick={()=>setPending({row,action:'approve'})}>独立核对批准</button>}
            <button type="button" className={button} disabled={busy} onClick={()=>setPending({row,action:'retire'})}>停用密度版本</button>
          </div>}
        </li>)}</ul></>}
      {pending && <section className="space-y-3 rounded-xl border border-amber-300 p-4"><p>确认{pending.action==='approve'?'核对批准':'停用'} {pending.row.specCode}/{pending.row.version}？不会放行 QC 或授权库存换算。</p>
        <FormField label="核对 / 停用依据" value={reason} onChange={setReason} dataTestId="density-review-reason" />
        <button type="button" className={button} disabled={busy} onClick={review}>确认密度版本操作</button><button type="button" className={button} disabled={busy} onClick={()=>{setPending(null);setReason('');}}>取消操作</button>
      </section>}
    </div>
  </details>;
}
