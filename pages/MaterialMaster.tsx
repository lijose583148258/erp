import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Database,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { useDialogFocus } from '../app/useDialogFocus';
import { can } from '../app/permissions';
import { useUnsavedForm } from '../app/useUnsavedForm';
import { ConfirmDialog, FormField, PageShell } from '../components/ui';
import {
  materialService,
  type MaterialAlias,
  type MaterialCategory,
  type MaterialMaster,
  type MaterialStatus,
  type MaterialWriteInput,
} from '../services/material.service';

const PAGE_SIZE = 30;
const MATERIAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const categoryOptions: Array<{ value: MaterialCategory; label: string }> = [
  { value: 'raw_material', label: '原料 / Raw material' },
  { value: 'semi_finished', label: '半成品 / Semi-finished' },
  { value: 'finished_good', label: '成品 / Finished good' },
  { value: 'packaging', label: '包装物 / Packaging' },
  { value: 'consumable', label: '耗材 / Consumable' },
  { value: 'service', label: '服务 / Service' },
];

const statusMeta: Record<MaterialStatus, { label: string; className: string }> = {
  draft: { label: '草稿待审核', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' },
  active: { label: '已启用', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' },
  blocked: { label: '已冻结', className: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200' },
  retired: { label: '已停用', className: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
};

type EditorForm = {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  category: MaterialCategory;
  baseUnit: string;
  specification: string;
  casNumber: string;
  unNumber: string;
  hsCode: string;
  shelfLifeDays: string;
  complianceNotes: string;
};

const emptyEditor = (): EditorForm => ({
  code: '',
  nameZh: '',
  nameEn: '',
  nameVi: '',
  category: 'raw_material',
  baseUnit: 'kg',
  specification: '',
  casNumber: '',
  unNumber: '',
  hsCode: '',
  shelfLifeDays: '',
  complianceNotes: '',
});

const toEditor = (material: MaterialMaster): EditorForm => ({
  code: material.code,
  nameZh: material.nameZh,
  nameEn: material.nameEn || '',
  nameVi: material.nameVi || '',
  category: material.category,
  baseUnit: material.baseUnit,
  specification: material.specification || '',
  casNumber: material.casNumber || '',
  unNumber: material.unNumber || '',
  hsCode: material.hsCode || '',
  shelfLifeDays: material.shelfLifeDays == null ? '' : String(material.shelfLifeDays),
  complianceNotes: material.complianceNotes || '',
});

const toWriteInput = (form: EditorForm): MaterialWriteInput => ({
  code: form.code.trim(),
  nameZh: form.nameZh.trim(),
  nameEn: form.nameEn.trim() || null,
  nameVi: form.nameVi.trim() || null,
  category: form.category,
  baseUnit: form.baseUnit.trim(),
  specification: form.specification.trim() || null,
  casNumber: form.casNumber.trim() || null,
  unNumber: form.unNumber.trim() || null,
  hsCode: form.hsCode.trim() || null,
  shelfLifeDays: form.shelfLifeDays ? Number(form.shelfLifeDays) : null,
  complianceNotes: form.complianceNotes.trim() || null,
});

type LifecycleAction = 'activate' | 'block' | 'retire' | null;

const MaterialEditor = ({
  material,
  onClose,
  onSaved,
}: {
  material: MaterialMaster | null;
  onClose: () => void;
  onSaved: (material: MaterialMaster) => void;
}) => {
  const { notify } = useAppContext();
  const [form, setForm] = useState<EditorForm>(() => material ? toEditor(material) : emptyEditor());
  const [saving, setSaving] = useState(false);
  const [alias, setAlias] = useState('');
  const [aliasLanguage, setAliasLanguage] = useState<MaterialAlias['language']>('zh');
  const [pendingAction, setPendingAction] = useState<LifecycleAction>(null);
  const [fieldError, setFieldError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const unsavedForm = useUnsavedForm({
    sourceId: 'material-master-editor',
    label: material ? `物料 ${material.code}` : '新建物料草稿',
    open: true,
    value: { form, alias, aliasLanguage },
    resetKey: material?.updatedAt || 'new',
  });
  const requestClose = () => unsavedForm.requestClose(onClose);
  useDialogFocus(!pendingAction, dialogRef, requestClose);

  const patch = (value: Partial<EditorForm>) => {
    setFieldError('');
    setForm(current => ({ ...current, ...value }));
  };

  const persist = async () => {
    if (!form.code.trim() || !form.nameZh.trim() || !form.baseUnit.trim()) {
      setFieldError('请先填写物料编码、中文名称和基本单位。');
      return;
    }
    if (!MATERIAL_CODE_PATTERN.test(form.code.trim())) {
      setFieldError('物料编码只能以字母或数字开头，并使用字母、数字、点、斜线、下划线或短横线。');
      return;
    }
    if (form.shelfLifeDays) {
      const shelfLifeDays = Number(form.shelfLifeDays);
      if (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 1 || shelfLifeDays > 3650) {
        setFieldError('保质期必须是 1–3650 之间的整数天数。');
        return;
      }
    }
    setSaving(true);
    try {
      const payload = toWriteInput(form);
      let saved: MaterialMaster;
      if (material) {
        const { code: _immutableCode, ...updatePayload } = payload;
        saved = await materialService.update(material.id, {
          ...updatePayload,
          expectedUpdatedAt: material.updatedAt,
        });
      } else {
        saved = await materialService.create({
            ...payload,
            status: 'draft',
            isTemporary: true,
          });
      }
      notify('success', material ? '物料修改已保存并回读。' : '物料草稿已创建，请完成审核后启用。');
      onSaved(saved);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '物料保存失败');
    } finally {
      setSaving(false);
    }
  };

  const addAlias = async () => {
    if (!material || !alias.trim()) return;
    setSaving(true);
    try {
      await materialService.addAlias(material.id, {
        alias: alias.trim(),
        language: aliasLanguage,
        aliasType: 'business',
      });
      const refreshed = await materialService.list({ q: material.code, limit: 5, offset: 0, includeRetired: true });
      const saved = refreshed.items.find(item => item.id === material.id);
      if (saved) onSaved(saved);
      setAlias('');
      notify('success', '物料别名已保存。');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '别名保存失败');
    } finally {
      setSaving(false);
    }
  };

  const applyLifecycle = async () => {
    if (!material || !pendingAction) return;
    setSaving(true);
    try {
      const patchByAction = {
        activate: { status: 'active' as const, isTemporary: false },
        block: { status: 'blocked' as const },
        retire: { status: 'retired' as const },
      };
      const saved = await materialService.update(material.id, {
        ...patchByAction[pendingAction],
        expectedUpdatedAt: material.updatedAt,
      });
      notify('success', pendingAction === 'activate' ? '物料已审核并启用。' : pendingAction === 'block' ? '物料已冻结。' : '物料已停用。');
      setPendingAction(null);
      onSaved(saved);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '状态变更失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: reduceMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: reduceMotion ? 1 : 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16 }}
      className="fixed inset-0 z-[120] flex justify-end bg-slate-950/35 backdrop-blur-sm"
    >
      <motion.section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={material ? `编辑物料 ${material.code}` : '新建物料'}
        tabIndex={-1}
        initial={{ x: reduceMotion ? 0 : 36, opacity: reduceMotion ? 1 : 0.92 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: reduceMotion ? 0 : 36, opacity: reduceMotion ? 1 : 0.92 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="h-full w-full max-w-3xl overflow-y-auto bg-slate-50 shadow-2xl outline-none dark:bg-slate-950"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-blue-600">MATERIAL MASTER</p>
            <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{material ? `编辑 ${material.code}` : '建立统一物料草稿'}</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">先建立身份，再补合规信息，审核通过后才允许进入正式配方。</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="关闭物料编辑" className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:hover:bg-slate-800"><X size={20} /></button>
        </header>

        <div className="space-y-5 p-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40"><Database size={18} /></span>
              <div><h3 className="font-black text-slate-900 dark:text-white">第一步：确定唯一身份</h3><p className="text-xs text-slate-500">编码保存后不可直接修改，避免历史库存和配方失联。</p></div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="物料编码" required autoFocus value={form.code} onChange={value => patch({ code: value.toUpperCase() })} readOnly={Boolean(material)} maxLength={64} placeholder="例如 RM-ACR-001" dataTestId="material-editor-code" />
              <FormField label="基本单位" required value={form.baseUnit} onChange={value => patch({ baseUnit: value })} maxLength={24} placeholder="kg" dataTestId="material-editor-unit" />
              <FormField label="中文名称" required value={form.nameZh} onChange={value => patch({ nameZh: value })} maxLength={160} placeholder="水性丙烯酸乳液" dataTestId="material-editor-name-zh" />
              <FormField label="物料类别" as="select" value={form.category} onChange={value => patch({ category: value as MaterialCategory })} options={categoryOptions} dataTestId="material-editor-category" />
              <FormField label="英文名称" value={form.nameEn} onChange={value => patch({ nameEn: value })} maxLength={160} placeholder="Acrylic Emulsion" />
              <FormField label="越南文名称" value={form.nameVi} onChange={value => patch({ nameVi: value })} maxLength={160} placeholder="Nhựa acrylic" />
              <FormField label="牌号 / 规格" value={form.specification} onChange={value => patch({ specification: value })} maxLength={240} placeholder="固含 50%，200 kg/桶" className="md:col-span-2" />
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4"><h3 className="font-black text-slate-900 dark:text-white">第二步：补充化工与合规标识</h3><p className="mt-1 text-xs text-slate-500">不知道的字段可以后补；启用前由审核人确认适用范围。</p></div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="CAS 号" value={form.casNumber} onChange={value => patch({ casNumber: value })} maxLength={64} placeholder="9003-01-4" />
              <FormField label="UN 编号" value={form.unNumber} onChange={value => patch({ unNumber: value })} maxLength={64} placeholder="非危化品可留空" />
              <FormField label="HS 编码" value={form.hsCode} onChange={value => patch({ hsCode: value })} maxLength={64} />
              <FormField label="保质期（天）" type="number" value={form.shelfLifeDays} onChange={value => patch({ shelfLifeDays: value })} placeholder="例如 365" />
              <FormField label="合规备注" as="textarea" value={form.complianceNotes} onChange={value => patch({ complianceNotes: value })} maxLength={2000} className="md:col-span-2" placeholder="SDS 版本、运输限制、国家许可或其他审核说明" />
            </div>
          </section>

          {material ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-black text-slate-900 dark:text-white">第三步：维护搜索别名</h3>
              <p className="mt-1 text-xs text-slate-500">客户叫法、供应商牌号和历史名称都归到同一物料，不再重复建档。</p>
              <div className="mt-4 grid items-end gap-2 sm:grid-cols-[144px_minmax(0,1fr)_auto]">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">别名语言</span>
                  <select value={aliasLanguage} onChange={event => setAliasLanguage(event.target.value as MaterialAlias['language'])} className="app-control">
                    <option value="zh">中文</option><option value="en">English</option><option value="vi">Tiếng Việt</option><option value="und">其他</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">别名内容</span>
                  <input value={alias} onChange={event => setAlias(event.target.value)} className="app-control" placeholder="客户叫法、供应商牌号或历史名称" />
                </label>
                <button type="button" onClick={() => void addAlias()} disabled={saving || !alias.trim()} className="min-h-11 whitespace-nowrap rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40 dark:bg-white dark:text-slate-900">添加别名</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {material.aliases.map(item => <span key={item.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">{item.alias} · {item.language}</span>)}
              </div>
            </section>
          ) : null}

          {fieldError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{fieldError}</div> : null}

          <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <div className="flex flex-wrap gap-2">
              {material && material.status !== 'retired' ? (
                <>
                  {material.status !== 'active' ? <button type="button" onClick={() => setPendingAction('activate')} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700"><ShieldCheck size={15} />审核并启用</button> : null}
                  {material.status !== 'blocked' ? <button type="button" onClick={() => setPendingAction('block')} className="inline-flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-2 text-xs font-black text-amber-700"><Ban size={15} />冻结</button> : null}
                  <button type="button" onClick={() => setPendingAction('retire')} className="inline-flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-2 text-xs font-black text-rose-700"><CircleOff size={15} />停用</button>
                </>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={requestClose} className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-black text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:text-slate-200">取消</button>
              <button type="button" onClick={() => void persist()} disabled={saving || material?.status === 'retired'} className="rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40">{saving ? '保存中…' : '保存并回读'}</button>
            </div>
          </div>
        </div>
      </motion.section>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction === 'activate' ? '确认审核并启用该物料？' : pendingAction === 'block' ? '确认冻结该物料？' : '确认永久停用该物料？'}
        description={pendingAction === 'activate' ? '启用后可进入正式 BOM。请确认编码、名称、单位和合规身份已经核对。' : pendingAction === 'block' ? '冻结后新 BOM 不能继续选择该物料，历史记录仍保留。' : '停用为不可逆生命周期动作；历史配方保留，但不能重新启用。'}
        confirmLabel={pendingAction === 'activate' ? '审核并启用' : pendingAction === 'block' ? '确认冻结' : '确认停用'}
        tone={pendingAction === 'activate' ? 'success' : 'danger'}
        loading={saving}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void applyLifecycle()}
      />
    </motion.div>
  );
};

const MaterialMaster: React.FC = () => {
  const { currentUser, notify } = useAppContext();
  const writable = can(currentUser, 'materials.write');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<MaterialStatus | ''>('');
  const [category, setCategory] = useState<MaterialCategory | ''>('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<MaterialMaster[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<MaterialMaster | 'new' | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await materialService.list({
        q: query.trim() || undefined,
        status: status || undefined,
        category: category || undefined,
        includeRetired: status === 'retired',
        limit: PAGE_SIZE,
        offset,
      }, { signal });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      if (!signal?.aborted) notify('error', error instanceof Error ? error.message : '物料列表加载失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [category, notify, offset, query, status]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  useEffect(() => setOffset(0), [category, query, status]);

  const counts = useMemo(() => ({
    active: items.filter(item => item.status === 'active' && !item.isTemporary).length,
    pending: items.filter(item => item.status === 'draft' || item.isTemporary).length,
    unavailable: items.filter(item => item.status === 'blocked' || item.status === 'retired').length,
  }), [items]);

  const handleSaved = (saved: MaterialMaster) => {
    setEditor(saved);
    void load();
  };

  return (
    <PageShell
      eyebrow="CANONICAL MATERIAL MASTER"
      title="统一物料主数据"
      subtitle="一个物料只保留一个身份；中文、英文、越南文、客户叫法和供应商牌号都通过别名找到同一条记录。"
      actions={writable ? (
        <button type="button" data-testid="material-create-button" onClick={() => setEditor('new')} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20"><Plus size={17} />新建物料草稿</button>
      ) : null}
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-blue-900 dark:bg-blue-950/25 dark:text-blue-100">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-blue-600" />
          <div><p className="text-sm font-black">先搜索，再决定是否新建</p><p className="mt-0.5 text-xs font-medium text-blue-700/80 dark:text-blue-200/75">输入历史名称、客户叫法、供应商牌号或 CAS，确认没有同一物料后再建草稿。</p></div>
        </div>
        <div className="grid items-end gap-3 lg:grid-cols-[minmax(280px,1fr)_220px_220px_auto]">
          <label className="block space-y-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">物料搜索</span>
            <span className="relative block">
              <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input data-testid="material-search-input" value={query} onChange={event => setQuery(event.target.value)} className="app-control pl-11" placeholder="编码、名称、CAS、HS 或任意别名" />
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">生命周期状态</span>
            <select value={status} onChange={event => setStatus(event.target.value as MaterialStatus | '')} className="app-control">
              <option value="">全部可用状态</option><option value="draft">草稿待审核</option><option value="active">已启用</option><option value="blocked">已冻结</option><option value="retired">已停用</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">物料类别</span>
            <select value={category} onChange={event => setCategory(event.target.value as MaterialCategory | '')} className="app-control">
              <option value="">全部物料类别</option>{categoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-11 min-w-[88px] items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 transition hover:border-blue-300 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:text-slate-200"><RefreshCw size={16} className={loading ? 'animate-spin motion-reduce:animate-none' : ''} />刷新</button>
        </div>
      </section>

      <section aria-label="当前筛选结果状态摘要" className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20"><p className="text-xs font-black text-emerald-700">当前页可正式使用</p><p className="mt-1 text-2xl font-black tabular-nums text-emerald-900 dark:text-emerald-100">{counts.active}</p></div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20"><p className="text-xs font-black text-amber-700">当前页待审核 / 临时</p><p className="mt-1 text-2xl font-black tabular-nums text-amber-900 dark:text-amber-100">{counts.pending}</p></div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 dark:border-rose-900/40 dark:bg-rose-950/20"><p className="text-xs font-black text-rose-700">当前页冻结 / 停用</p><p className="mt-1 text-2xl font-black tabular-nums text-rose-900 dark:text-rose-100">{counts.unavailable}</p></div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="hidden lg:block">
          <table className="w-full table-fixed">
            <caption className="sr-only">统一物料主数据搜索结果</caption>
            <thead className="bg-slate-50 text-left text-xs font-black text-slate-500 dark:bg-slate-800/60 dark:text-slate-300"><tr><th scope="col" className="w-[28%] px-5 py-4">编码与名称</th><th scope="col" className="w-[22%] px-4 py-4">类别 / 规格</th><th scope="col" className="w-[18%] px-4 py-4">化工标识</th><th scope="col" className="w-[14%] px-4 py-4">状态</th><th scope="col" className="w-[8%] px-4 py-4">别名</th><th scope="col" className="w-[10%] px-5 py-4 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map(item => (
                <tr key={item.id} data-testid={`material-row-${item.id}`} className="transition-colors hover:bg-blue-50/40 motion-reduce:transition-none dark:hover:bg-blue-950/10">
                  <td className="px-5 py-4"><p className="break-words font-black text-slate-950 dark:text-white">{item.code}</p><p className="mt-1 break-words text-sm font-bold text-slate-600 dark:text-slate-300">{item.nameZh}</p><p className="break-words text-xs text-slate-400">{[item.nameEn, item.nameVi].filter(Boolean).join(' · ') || '尚未补充英文/越南文'}</p></td>
                  <td className="px-4 py-4 text-sm"><p className="font-bold text-slate-700 dark:text-slate-200">{categoryOptions.find(option => option.value === item.category)?.label}</p><p className="mt-1 text-xs text-slate-400">{item.specification || '未填写规格'} · {item.baseUnit}</p></td>
                  <td className="px-4 py-4 text-xs font-bold text-slate-500"><p>CAS：{item.casNumber || '—'}</p><p className="mt-1">HS：{item.hsCode || '—'}</p></td>
                  <td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusMeta[item.status].className}`}>{statusMeta[item.status].label}</span>{item.isTemporary ? <p className="mt-2 text-xs font-bold text-amber-600">临时身份</p> : null}</td>
                  <td className="px-4 py-4 text-sm font-black tabular-nums text-slate-600 dark:text-slate-300">{item.aliases.length} 个</td>
                  <td className="px-5 py-4 text-right"><button type="button" onClick={() => setEditor(item)} className="whitespace-nowrap rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-700 transition-colors hover:bg-blue-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none dark:bg-slate-800 dark:text-slate-200">{writable ? '查看 / 编辑' : '查看'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 lg:hidden">
          {items.map(item => (
            <button key={item.id} type="button" onClick={() => setEditor(item)} className="w-full rounded-2xl border border-slate-200 p-4 text-left dark:border-slate-700">
              <div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950 dark:text-white">{item.code}</p><p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">{item.nameZh}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-black ${statusMeta[item.status].className}`}>{statusMeta[item.status].label}</span></div>
              <p className="mt-3 text-xs text-slate-400">{item.specification || '未填写规格'} · {item.baseUnit} · {item.aliases.length} 个别名</p>
            </button>
          ))}
        </div>

        {!loading && items.length === 0 ? <div className="p-12 text-center"><AlertTriangle className="mx-auto text-amber-500" /><p className="mt-3 font-black text-slate-700 dark:text-slate-200">没有找到物料</p><p className="mt-1 text-sm text-slate-400">请换一个编码、名称、CAS 或别名；不要因为搜索不到就重复建档。</p></div> : null}
        {loading ? <div className="p-10 text-center text-sm font-black text-slate-400">正在读取统一物料…</div> : null}

        <footer aria-live="polite" className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs font-bold text-slate-500 dark:border-slate-800">
          <span>共 {total} 条；当前显示 {total === 0 ? 0 : offset + 1}–{Math.min(offset + items.length, total)}</span>
          <div className="flex gap-2">
            <button type="button" aria-label="上一页" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))} className="rounded-xl border border-slate-200 p-2 disabled:opacity-30 dark:border-slate-700"><ChevronLeft size={16} /></button>
            <button type="button" aria-label="下一页" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(value => value + PAGE_SIZE)} className="rounded-xl border border-slate-200 p-2 disabled:opacity-30 dark:border-slate-700"><ChevronRight size={16} /></button>
          </div>
        </footer>
      </section>

      <AnimatePresence>
        {editor ? (
          <MaterialEditor
            material={editor === 'new' ? null : editor}
            onClose={() => setEditor(null)}
            onSaved={handleSaved}
          />
        ) : null}
      </AnimatePresence>
    </PageShell>
  );
};

export default MaterialMaster;
