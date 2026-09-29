import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { FormField } from '../../components/ui';
import { MaterialMasterCombobox } from '../../components/materials/MaterialMasterCombobox';
import type { MaterialMaster } from '../../services/material.service';
import { materialPackagingService, type PackagingRevision, type PackagingRevisionInput } from '../../services/materialPackaging.service';
import { productionService } from '../../services/production.service';
import massBasis from '../../backend/src/domain/production-mass-basis';
import packagingBasis from '../../backend/src/domain/production-packaging-basis';

const button = 'min-h-11 rounded-xl border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-50 dark:border-blue-800 dark:text-blue-200';
const empty = (): PackagingRevisionInput => ({ specCode: '', version: '', packageUnit: '桶', netMass: '', massUnit: 'kg', sourceReference: '' });
type RawLine = { text: string; material: MaterialMaster | null; percentage: string };
export function PackagingWorkbench({ onCreated }: { onCreated: () => Promise<void> }) {
  const { currentUser } = useAppContext();
  const [output, setOutput] = useState<MaterialMaster | null>(null), [outputText,setOutputText] = useState('');
  const [form,setForm] = useState(empty), [rows,setRows] = useState<PackagingRevision[]>([]);
  const [selected,setSelected] = useState<number | null>(null), [version,setVersion] = useState('');
  const [lines,setLines] = useState<RawLine[]>([{text:'',material:null,percentage:'100'}]);
  const [reason,setReason] = useState(''), [pending,setPending] = useState<{revision:PackagingRevision; action:'approve'|'retire'} | null>(null);
  const [message,setMessage] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const lock = useRef(false);
  const unsaved = useUnsavedForm({ sourceId:'packaging-workbench',label:'包装规格/配方',open:true,value:{form,version,lines} });
  const revision = rows.find(r=>r.id===selected && r.status==='approved');
  useEffect(()=>{let live=true;setRows([]);setSelected(null);setPending(null);setError('');
    if(output) materialPackagingService.list(output.id).then(r=>{if(live)setRows(r);}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[output]);
  const act = async (work:()=>Promise<void>) => {if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await work();}catch(e){setError(e instanceof Error?e.message:'操作失败，草稿已保留');}finally{lock.current=false;setBusy(false);}};
  const refresh = async () => {if(output)setRows(await materialPackagingService.list(output.id));};
  const create = () => act(async()=>{
    if(!output)throw Error('请先选择已启用包装成品');
    const saved=await materialPackagingService.create(output.id,{...form,packageUnit:output.baseUnit});
    const read=await materialPackagingService.list(output.id);const found=read.find(r=>r.id===saved.id);
    if(!found || found.netMass!==saved.netMass || found.sourceReference!==saved.sourceReference)throw Error('规格回读不一致，请刷新核查，勿重复创建');
    setRows(read);setForm(empty());setMessage('包装规格草稿已保存并回读；等待另一人批准。');
  });
  const review = () => act(async()=>{
    if(!pending || !reason.trim())throw Error('请填写审核/停用依据');
    const saved=await materialPackagingService.review(pending.revision,pending.action,reason.trim());
    const read=await materialPackagingService.list(saved.materialId), found=read.find(r=>r.id===saved.id);
    if(!found || found.status!==saved.status || found.updatedAt!==saved.updatedAt)throw Error('审核状态回读不一致，请刷新核查');
    setRows(read);setPending(null);setReason('');setMessage(`包装版本已${saved.status==='approved'?'批准':'停用'}并回读。`);
  });
  let preview: number[]=[];let previewError='';
  try {if(revision)preview=lines.map(l=>l.material?massBasis.packagingPercentageQuantityV1(l.percentage,l.material.baseUnit,revision.netMass,revision.massUnit):0);}catch(e){previewError=e instanceof Error?e.message:'换算失败';}
  const createBom = () => act(async()=>{
    if(!output || !revision || !version.trim())throw Error('请选择批准版本并填写 BOM 版本');
    if(!output.shelfLifeDays)throw Error('请先补齐成品保质期');
    if(previewError)throw Error(previewError);
    if(lines.some(l=>!l.material) || Math.abs(lines.reduce((n,l)=>n+Number(l.percentage),0)-100)>0.00000001)throw Error('请选择每行原料，占比合计必须为100%');
    const bom=await productionService.createBom({materialId:output.id,packagingRevisionId:revision.id,productName:output.nameZh,version:version.trim(),bomType:'chemical_formula',status:'active',formulationMode:'percentage',standardBatchSize:1,batchSizeUnit:output.baseUnit,outputUnit:output.baseUnit,shelfLifeDays:output.shelfLifeDays,
      qualityCharacteristics:[{code:'PACK-NET-MASS',name:'单包装净质量',valueType:'numeric',unit:revision.massUnit,lowerLimit:revision.netMass,upperLimit:revision.netMass,required:true,sortOrder:0}],
      items:lines.map((l,i)=>({materialId:l.material!.id,materialName:l.material!.nameZh,unit:l.material!.baseUnit,dosageMode:packagingBasis.PACKAGING_PERCENTAGE_V1,percentage:Number(l.percentage),quantityPerUnit:preview[i],lossRate:0,allowedVarianceRate:0})),
    });
    const read=(await productionService.getBoms()).find(b=>b.id===bom.id);
    if(!read || read.packagingRevisionId!==revision.id || read.items.length!==preview.length || read.items.some((item,i)=>item.quantityPerUnit!==preview[i]))throw Error('BOM 回读不一致，请核查，不要重复创建');
    setVersion('');setLines([{text:'',material:null,percentage:'100'}]);setMessage(`包装 BOM ${bom.bomNo} 已创建并回读；净量版本已冻结。`);await onCreated();
  });
  const selectOutput=(m:MaterialMaster)=>unsaved.requestClose(()=>{setOutput(m);setOutputText(m.nameZh);setForm(empty());setVersion('');setLines([{text:'',material:null,percentage:'100'}]);});
  return <details className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900" data-testid="packaging-workbench">
    <summary className="cursor-pointer text-lg font-black text-slate-900 dark:text-white">受控包装净量 · 版本与配方</summary>
    <div className="mt-4 space-y-5">
      <p className="text-sm text-slate-600 dark:text-slate-300">仅支持质量原料 → 整桶/袋/罐/瓶。净量必须有来源；编制人不能自批。批准后不可改净量，更正另建版本。本版零损耗、零配方容差；不支持密度、拆零、混合包装。</p>
      <fieldset disabled={busy}><MaterialMasterCombobox value={outputText} selectedMaterialId={output?.id ?? null} onTextChange={setOutputText} onSelect={selectOutput} onClearSelection={()=>setOutput(null)} label="包装成品" dataTestId="packaging-output" allowedCategories={['finished_good','semi_finished']} /></fieldset>
      {output && <p className="text-sm">主单位：{output.baseUnit}；已用物料不可直接改单位。</p>}
      {error && <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{message}</p>}
      {output && can(currentUser,'materials.write') && <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 font-bold">新建不可覆写的规格草稿</legend>
        <FormField label="规格编码" value={form.specCode} onChange={v=>setForm({...form,specCode:v})} dataTestId="packaging-spec-code" />
        <FormField label="规格版本" value={form.version} onChange={v=>setForm({...form,version:v})} dataTestId="packaging-spec-version" />
        <FormField label="每包装净质量" value={form.netMass} onChange={v=>setForm({...form,netMass:v})} dataTestId="packaging-net-mass" />
        <FormField label="净质量单位" as="select" value={form.massUnit} onChange={v=>setForm({...form,massUnit:v})} options={['mg','g','kg','t'].map(v=>({value:v,label:v}))} />
        <FormField label="净量来源文件/编号" value={form.sourceReference} onChange={v=>setForm({...form,sourceReference:v})} dataTestId="packaging-source" />
        <button type="button" className={button} onClick={create}>保存包装规格草稿并回读</button>
      </fieldset>}
      {output && <><button type="button" className={button} disabled={busy} onClick={()=>void act(refresh)}>刷新包装版本</button><ul className="space-y-3">{rows.map(r=><li key={r.id} data-testid={`packaging-revision-${r.id}`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <p className="font-bold">{r.specCode} / {r.version} · {r.netMass} {r.massUnit}/{r.packageUnit} · {r.status==='approved'?'已批准':r.status==='retired'?'已停用':'待独立审批'}</p><p className="break-words text-sm">来源：{r.sourceReference} · 编制人 #{r.createdBy} · 审批人 {r.approvedBy ? `#${r.approvedBy}` : '未批准'}</p>
        {can(currentUser,'materials.govern') && r.status!=='retired' && <div className="mt-2 flex flex-wrap gap-2">
          {r.status==='draft' && Number(currentUser.id)!==r.createdBy && <button type="button" className={button} disabled={busy} onClick={()=>setPending({revision:r,action:'approve'})}>独立批准</button>}
          <button type="button" className={button} disabled={busy} onClick={()=>setPending({revision:r,action:'retire'})}>停用该版本</button>
        </div>}
      </li>)}</ul></>}
      {pending && <section className="space-y-3 rounded-xl border border-amber-300 p-4" aria-label="包装版本审核确认"><p>确认{pending.action==='approve'?'批准':'停用'} {pending.revision.specCode}/{pending.revision.version}？停用不改变已在制工单。</p><FormField label="审核/停用依据" value={reason} onChange={setReason} dataTestId="packaging-review-reason" /><button type="button" className={button} disabled={busy} onClick={review}>确认包装版本操作</button><button type="button" className={button} disabled={busy} onClick={()=>setPending(null)}>取消操作</button></section>}
      {output && can(currentUser,'production.write') && <fieldset disabled={busy} className="space-y-4"><legend className="font-bold">批准规格 → 冻结包装配方</legend>
        <FormField label="批准的包装版本" as="select" value={selected?String(selected):''} onChange={v=>setSelected(v?Number(v):null)} options={[{value:'',label:'请选择批准版本'},...rows.filter(r=>r.status==='approved').map(r=>({value:String(r.id),label:`${r.specCode}/${r.version} · ${r.netMass} ${r.massUnit}/${r.packageUnit}`}))]} dataTestId="packaging-bom-revision" />
        <FormField label="新 BOM 版本" value={version} onChange={setVersion} dataTestId="packaging-bom-version" />
        {lines.map((line,i)=><div key={i} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2">
          <MaterialMasterCombobox label={`质量原料 ${i+1}`} value={line.text} selectedMaterialId={line.material?.id ?? null} dataTestId={`packaging-raw-${i}`} onTextChange={text=>setLines(v=>v.map((l,j)=>j===i?{...l,text}:l))} onClearSelection={()=>setLines(v=>v.map((l,j)=>j===i?{...l,material:null}:l))} onSelect={m=>setLines(v=>v.map((l,j)=>j===i?{...l,material:m,text:m.nameZh}:l))} allowedCategories={['raw_material','semi_finished']} />
          <FormField label={`原料 ${i+1} 质量占比 %`} value={line.percentage} onChange={percentage=>setLines(v=>v.map((l,j)=>j===i?{...l,percentage}:l))} dataTestId={`packaging-percent-${i}`} />
          <p className="text-sm" data-testid={`packaging-preview-${i}`}>每包装单耗：{preview[i] ?? '--'} {line.material?.baseUnit || ''}/{output.baseUnit}</p>
          {lines.length>1 && <button type="button" className={button} onClick={()=>setLines(v=>v.filter((_,j)=>j!==i))}>移除原料 {i+1}</button>}
        </div>)}
        {previewError && <p role="alert">{previewError}</p>}
        <p className="text-sm text-slate-600 dark:text-slate-300">本入口创建化工配方，并将单包装净质量的上下限明确设为批准净量；完工仍需检验及独立 QC 放行。不接受来源未知的自动换算。</p>
        <div className="flex flex-wrap gap-3"><button type="button" className={button} onClick={()=>setLines(v=>[...v,{text:'',material:null,percentage:''}])}>增加质量原料</button><button type="button" className={button} disabled={!revision || Boolean(previewError)} onClick={createBom}>创建包装 BOM 并回读</button></div>
      </fieldset>}
    </div>
  </details>;
}
