import React, { useEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { ArrowLeft, ClipboardPaste, FlaskConical, Redo2, Save, Trash2, Undo2 } from 'lucide-react';
import { useAppContext } from '../../../app/AppContext';
import { canUseBomGridLab } from '../../../app/bomGridFeatureFlags';
import { can } from '../../../app/permissions';
import { productionService, type ProductionBomItem } from '../../../services/production.service';
import { createEmptyItem, type BomItemDraft } from '../productionBomLineModel';
import fixture100Url from '../../../tests/fixtures/bom-grid/acrylic-emulsion-100-rows.json?url';
import fixture1000Url from '../../../tests/fixtures/bom-grid/acrylic-emulsion-1000-rows.json?url';
import paste300Url from '../../../tests/fixtures/bom-grid/paste-300-rows.tsv?url';
import expectedPayloadUrl from '../../../tests/fixtures/bom-grid/expected-save-payload.json?url';
import {
  GovernedBomGridAdapter,
  toBomGridRow,
  type BomGridRow,
  type BomValidationResult,
} from './bomGridContract';

export type BomGridLabEngine = 'revogrid' | 'react-data-grid';
type GridRenderer = React.ComponentType<{ rows: BomGridRow[]; adapter: GovernedBomGridAdapter }>;

type GoldenFixtures = {
  fixture100: BomItemDraft[];
  fixture1000: BomItemDraft[];
  expectedPayload: BomItemDraft[];
  pasteMatrix: string[][];
};

const toApiItems = (drafts: BomItemDraft[]): ProductionBomItem[] => drafts.map((item) => ({
  materialName: item.materialName,
  materialCode: item.materialCode || null,
  ingredientRole: item.ingredientRole || null,
  dosageMode: item.dosageMode || null,
  percentage: item.percentage ? Number(item.percentage) : null,
  quantityPerUnit: Number(item.quantityPerUnit || 0),
  unit: item.unit,
  lossRate: item.lossRate ? Number(item.lossRate) : 0,
  allowedVarianceRate: item.allowedVarianceRate ? Number(item.allowedVarianceRate) : null,
  processStage: item.processStage || null,
  substituteGroup: item.substituteGroup || null,
  yieldContribution: item.yieldContribution ? Number(item.yieldContribution) : null,
  notes: item.notes || null,
}));

const fromApiItems = (items: ProductionBomItem[]): BomItemDraft[] => items.map((item) => ({
  materialName: item.materialName,
  materialCode: item.materialCode || '',
  ingredientRole: item.ingredientRole || '',
  dosageMode: item.dosageMode || 'fixed',
  percentage: item.percentage == null ? '' : String(item.percentage),
  quantityPerUnit: String(item.quantityPerUnit),
  unit: item.unit,
  lossRate: item.lossRate == null ? '' : String(item.lossRate),
  allowedVarianceRate: item.allowedVarianceRate == null ? '' : String(item.allowedVarianceRate),
  processStage: item.processStage || '',
  substituteGroup: item.substituteGroup || '',
  yieldContribution: item.yieldContribution == null ? '' : String(item.yieldContribution),
  notes: item.notes || '',
}));

const compareDrafts = (actual: BomItemDraft[], expected: BomItemDraft[]) => {
  if (actual.length !== expected.length) return `行数不一致：actual=${actual.length}, expected=${expected.length}`;
  const fields = Object.keys(expected[0] || {}) as Array<keyof BomItemDraft>;
  const decimalFields = new Set<keyof BomItemDraft>([
    'percentage',
    'quantityPerUnit',
    'lossRate',
    'allowedVarianceRate',
    'yieldContribution',
    'availableStock',
    'lockedStock',
    'unitCost',
  ]);
  for (let rowIndex = 0; rowIndex < expected.length; rowIndex += 1) {
    for (const field of fields) {
      const actualValue = String(actual[rowIndex]?.[field] ?? '');
      const expectedValue = String(expected[rowIndex]?.[field] ?? '');
      if (decimalFields.has(field) && actualValue !== '' && expectedValue !== '') {
        try {
          if (new Decimal(actualValue).eq(expectedValue)) continue;
        } catch {
          // Fall through to exact comparison so malformed numeric data is reported.
        }
      }
      if (actualValue !== expectedValue) {
        return `第 ${rowIndex + 1} 行 ${String(field)} 不一致：actual=${actualValue}, expected=${expectedValue}`;
      }
    }
  }
  return '';
};

export function BomGridLabPage({ engine, grid: Grid }: { engine: BomGridLabEngine; grid: GridRenderer }) {
  const { currentUser } = useAppContext();
  const labAllowed = canUseBomGridLab(currentUser);
  const canWriteProduction = can(currentUser, 'production.write');
  const [rows, setRows] = useState<BomGridRow[]>(() => [toBomGridRow(createEmptyItem(), 1, 'lab-empty-0001')]);
  const [fixtures, setFixtures] = useState<GoldenFixtures | null>(null);
  const [validation, setValidation] = useState<BomValidationResult | null>(null);
  const [message, setMessage] = useState('尚未执行黄金操作与后端回读。');
  const [saving, setSaving] = useState(false);
  const adapterRef = useRef<GovernedBomGridAdapter | null>(null);
  if (!adapterRef.current) {
    adapterRef.current = new GovernedBomGridAdapter(rows, setRows, 100);
  }
  const adapter = adapterRef.current;
  const title = engine === 'revogrid' ? 'RevoGrid Core' : 'react-data-grid';
  const expectedComparison = useMemo(() => (
    fixtures ? compareDrafts(adapter.exportDraft(), fixtures.expectedPayload) : '黄金数据加载中'
  ), [fixtures, rows]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(fixture100Url).then((response) => response.json() as Promise<BomItemDraft[]>),
      fetch(fixture1000Url).then((response) => response.json() as Promise<BomItemDraft[]>),
      fetch(expectedPayloadUrl).then((response) => response.json() as Promise<BomItemDraft[]>),
      fetch(paste300Url).then((response) => response.text()),
    ]).then(([fixture100, fixture1000, expectedPayload, pasteText]) => {
      if (cancelled) return;
      const loaded = {
        fixture100,
        fixture1000,
        expectedPayload,
        pasteMatrix: pasteText.trimEnd().split(/\r?\n/).map((line) => line.split('\t')),
      };
      setFixtures(loaded);
      adapter.replaceRows(fixture100.map((row, index) => toBomGridRow(row, index + 1, `fixture-${String(index + 1).padStart(4, '0')}`)));
      setMessage('已载入 100 行脱敏黄金数据。');
    }).catch((error) => {
      if (!cancelled) setMessage(`黄金数据加载失败：${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { cancelled = true; };
  }, [adapter]);

  if (!labAllowed) {
    return (
      <div className="app-card m-6 p-8" data-testid="bom-grid-lab-disabled">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">BOM Grid Lab 未启用</h1>
        <p className="mt-3 text-sm text-slate-500">实验页必须显式启用，且仅管理员或 VITE_BOM_GRID_LAB_USER_IDS 白名单用户可进入。正式 BOM 不受影响。</p>
      </div>
    );
  }

  const loadFixture = (fixture: BomItemDraft[]) => {
    adapter.replaceRows(fixture.map((row, index) => toBomGridRow(row, index + 1, `fixture-${String(index + 1).padStart(4, '0')}`)));
    setValidation(null);
    setMessage(`已载入 ${fixture.length} 行脱敏数据。`);
  };

  const runGoldenOperations = () => {
    if (!fixtures) {
      setMessage('黄金数据尚未加载完成。');
      return;
    }
    loadFixture(fixtures.fixture100);
    const initial = adapter.getRows();
    initial[0] = {
      ...initial[0],
      materialName: `${initial[0].materialName}（已编辑）`,
      dosageMode: 'fixed',
      percentage: '',
      dirtyFields: ['materialName', 'dosageMode', 'percentage'],
    };
    adapter.replaceRows(initial);
    const pasteStart = adapter.getRows()[1];
    adapter.setSelection({
      startRowKey: pasteStart.rowKey,
      endRowKey: pasteStart.rowKey,
      startColumnKey: 'materialCode',
      endColumnKey: 'materialCode',
    });
    const pasteResult = adapter.paste(fixtures.pasteMatrix);
    adapter.deleteRows(['fixture-0004']);
    adapter.insertRows(2, [toBomGridRow({
      ...createEmptyItem(),
      materialCode: 'LAB-INSERT-0001',
      materialName: '人工插入脱敏原料',
      ingredientRole: 'main_resin',
      dosageMode: 'fixed',
      quantityPerUnit: '9.999000',
      unit: 'kg',
      lossRate: '0',
      allowedVarianceRate: '0.200000',
      processStage: '人工确认',
      notes: '脱敏测试行 9999',
    }, 3, 'golden-insert-0001')]);
    const mismatch = compareDrafts(adapter.exportDraft(), fixtures.expectedPayload);
    setMessage(mismatch || `黄金操作通过：粘贴 ${pasteResult.updatedCellCount} 个单元格，最终 ${adapter.getRows().length} 行。`);
  };

  const validate = () => {
    const result = adapter.validate();
    setValidation(result);
    setMessage(result.valid ? '共享验证规则通过。' : `验证未通过：${result.blockingCount} 个阻断，${result.warningCount} 个警告。`);
  };

  const saveAndReadBack = async () => {
    if (!canWriteProduction) {
      setMessage('当前账号没有 production.write 权限，禁止执行保存回读。');
      return;
    }
    const currentValidation = adapter.validate();
    setValidation(currentValidation);
    if (!currentValidation.valid) {
      setMessage('存在阻断项，未向后端保存。');
      return;
    }
    setSaving(true);
    try {
      const runId = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
      const created = await productionService.createBom({
        productName: `BOM-GRID-LAB-${engine}-${runId}`,
        version: `lab-${runId}`,
        bomType: 'chemical_formula',
        status: 'draft',
        formulationMode: 'fixed',
        outputUnit: 'kg',
        shelfLifeDays: 365,
        standardBatchSize: 1000,
        batchSizeUnit: 'kg',
        notes: `[BOM_GRID_LAB][${engine}] 可删除测试数据`,
        items: toApiItems(adapter.exportDraft()),
      });
      const readback = (await productionService.getBoms()).find((bom) => bom.id === created.id);
      if (!readback) throw new Error(`创建成功但回读列表中找不到 BOM id=${created.id}`);
      if (readback.shelfLifeDays !== 365) {
        throw new Error(`保存回读保质期不一致：actual=${readback.shelfLifeDays ?? '未配置'}, expected=365`);
      }
      const mismatch = compareDrafts(fromApiItems(readback.items), adapter.exportDraft());
      if (mismatch) throw new Error(`保存回读逐字段比对失败：${mismatch}`);
      setMessage(`后端保存与回读逐字段一致：BOM ${readback.bomNo}，${readback.items.length} 行。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存回读失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 p-4 md:p-7" data-testid={`bom-grid-lab-page-${engine}`}>
      <header className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              <FlaskConical size={16} /> 隔离实验，不是正式 BOM
            </div>
            <h1 className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{title} / 统一 BomGridAdapter</h1>
            <p className="mt-2 max-w-4xl text-sm text-slate-500">两套候选共用数据模型、Decimal 计算、Zod 验证、撤销栈、黄金数据和生产 BOM 保存回读接口。</p>
          </div>
          <a href="/#production" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-200">
            <ArrowLeft size={15} /> 返回旧 BOM
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button disabled={!fixtures} data-testid="bom-grid-load-100" onClick={() => fixtures && loadFixture(fixtures.fixture100)} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50">载入 100 行</button>
          <button disabled={!fixtures} data-testid="bom-grid-load-1000" onClick={() => fixtures && loadFixture(fixtures.fixture1000)} className="rounded-xl bg-slate-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50">载入 1000 行</button>
          <button data-testid="bom-grid-run-golden" onClick={runGoldenOperations} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white"><ClipboardPaste size={14} />执行黄金操作</button>
          <button data-testid="bom-grid-undo" onClick={() => adapter.undo()} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-black dark:border-slate-700"><Undo2 size={14} />撤销</button>
          <button data-testid="bom-grid-redo" onClick={() => adapter.redo()} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-black dark:border-slate-700"><Redo2 size={14} />恢复</button>
          <button data-testid="bom-grid-delete-selection" onClick={() => adapter.deleteRows([adapter.getSelection().startRowKey])} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-black text-rose-600 dark:border-slate-700"><Trash2 size={14} />删除选中行</button>
          <button data-testid="bom-grid-validate" onClick={validate} className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white">统一验证</button>
          <button data-testid="bom-grid-save-readback" disabled={saving || !canWriteProduction} onClick={saveAndReadBack} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50"><Save size={14} />{saving ? '保存回读中' : '保存并逐字段回读'}</button>
        </div>
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${expectedComparison ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200'}`} data-testid="bom-grid-lab-result">
          {message}
        </div>
        {validation ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold md:grid-cols-4">
            <div>阻断：{validation.blockingCount}</div><div>警告：{validation.warningCount}</div>
            <div>比例：{validation.percentageTotal}%</div><div>单位总量：{validation.totalQuantityPerUnit}</div>
          </div>
        ) : null}
      </header>
      <Grid rows={rows} adapter={adapter} />
    </div>
  );
}
