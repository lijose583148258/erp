import React, { Dispatch, SetStateAction } from 'react';
import { DocumentInputGuide } from '../../components/ui/DocumentInputGuide';
import { ProductionBom } from '../../services/production.service';
import { ProductionBomLineGrid, type BomItemDraft } from './ProductionBomLineGrid';
import {
  BOM_STATUS_LABELS,
  BOM_STATUS_OPTIONS,
  BOM_TYPE_LABELS,
  BOM_TYPE_OPTIONS,
  CHEMICAL_ROLE_LABELS,
  DOSAGE_MODE_LABELS,
  FORMULATION_MODE_LABELS,
  FORMULATION_MODE_OPTIONS,
  formatDateOnly,
  type BomLifecycleStatus,
  type BomType,
} from './productionWorkspaceConfig';
import {
  Field,
  MiniTag,
  SectionHeader,
  SelectField,
  SummaryChip,
  Td,
  TextareaField,
  Th,
} from './ProductionWorkspacePrimitives';

type BomFormErrors = Partial<Record<'productName' | 'outputUnit' | 'standardBatchSize' | 'percentage' | 'items', string>>;

interface ProductionBomSectionProps {
  bomKeyword: string;
  setBomKeyword: (value: string) => void;
  bomProductName: string;
  setBomProductName: (value: string) => void;
  bomVersion: string;
  setBomVersion: (value: string) => void;
  bomType: BomType;
  setBomType: (value: BomType) => void;
  bomStatus: BomLifecycleStatus;
  setBomStatus: (value: BomLifecycleStatus) => void;
  bomFormulationMode: string;
  setBomFormulationMode: (value: string) => void;
  bomOutputUnit: string;
  setBomOutputUnit: (value: string) => void;
  bomStandardBatchSize: string;
  setBomStandardBatchSize: (value: string) => void;
  bomBatchSizeUnit: string;
  setBomBatchSizeUnit: (value: string) => void;
  bomDensity: string;
  setBomDensity: (value: string) => void;
  bomSolidContent: string;
  setBomSolidContent: (value: string) => void;
  bomProcessText: string;
  setBomProcessText: (value: string) => void;
  bomEffectiveFrom: string;
  setBomEffectiveFrom: (value: string) => void;
  bomEffectiveTo: string;
  setBomEffectiveTo: (value: string) => void;
  bomQualitySpecText: string;
  setBomQualitySpecText: (value: string) => void;
  bomNotes: string;
  setBomNotes: (value: string) => void;
  bomPercentageSummary: number;
  numericStandardBatchSize: number;
  bomItems: BomItemDraft[];
  setBomItems: Dispatch<SetStateAction<BomItemDraft[]>>;
  loading: boolean;
  bomSaving: boolean;
  bomFormErrors: BomFormErrors;
  clearBomFormError: (field: keyof BomFormErrors) => void;
  handleCreateBom: () => void;
  displayedBoms: ProductionBom[];
  selectedBomId: number | null;
  setSelectedBomId: (value: number) => void;
  setWoProductName: (value: string) => void;
  selectedBom: ProductionBom | null;
  selectedBomPercentageSummary: number;
  selectedBomProcessSummary: string;
  selectedBomQualitySummary: string;
}

export function ProductionBomSection({
  bomKeyword,
  setBomKeyword,
  bomProductName,
  setBomProductName,
  bomVersion,
  setBomVersion,
  bomType,
  setBomType,
  bomStatus,
  setBomStatus,
  bomFormulationMode,
  setBomFormulationMode,
  bomOutputUnit,
  setBomOutputUnit,
  bomStandardBatchSize,
  setBomStandardBatchSize,
  bomBatchSizeUnit,
  setBomBatchSizeUnit,
  bomDensity,
  setBomDensity,
  bomSolidContent,
  setBomSolidContent,
  bomProcessText,
  setBomProcessText,
  bomEffectiveFrom,
  setBomEffectiveFrom,
  bomEffectiveTo,
  setBomEffectiveTo,
  bomQualitySpecText,
  setBomQualitySpecText,
  bomNotes,
  setBomNotes,
  bomPercentageSummary,
  numericStandardBatchSize,
  bomItems,
  setBomItems,
  loading,
  bomSaving,
  bomFormErrors,
  clearBomFormError,
  handleCreateBom,
  displayedBoms,
  selectedBomId,
  setSelectedBomId,
  setWoProductName,
  selectedBom,
  selectedBomPercentageSummary,
  selectedBomProcessSummary,
  selectedBomQualitySummary,
}: ProductionBomSectionProps) {
  const isBomMasterReady = Boolean(bomProductName.trim() && bomVersion.trim() && bomOutputUnit.trim());
  const [showAdvancedFields, setShowAdvancedFields] = React.useState(false);
  const advancedSummary = [
    bomDensity.trim() ? `密度 ${bomDensity}` : '',
    bomSolidContent.trim() ? `固含 ${bomSolidContent}%` : '',
    bomEffectiveFrom ? `生效 ${bomEffectiveFrom}` : '',
    bomEffectiveTo ? `截止 ${bomEffectiveTo}` : '',
  ].filter(Boolean).join(' · ') || '未填写，可稍后补充';

  return (
    <section className="xl:col-span-5 space-y-8">
      <DocumentInputGuide
        testId="production-bom-input-guide"
        eyebrow="化工配方 / BOM 输入路线"
        title="先建配方主档，再录原料明细，最后保存回读"
        description="这里不是普通物料列表。对胶水、树脂、涂料来说，BOM 本质是配方版本：先说明做什么产品、哪个版本、按什么批量生产，再用表格录入 10 种左右原料、代号、占比、单耗、损耗和工序。保存后只通过下方版本列表回读，不在列表里直接改明细，避免主档和明细互相抢职责。"
        tone="blue"
        steps={[
          { title: '配方主档', description: '填写产品名称、版本、配方类型、输出单位、标准批量。保密原料可以只填代号。', badge: '主数据' },
          { title: '原料明细表', description: '像 Excel 一样逐行录原料、占比、单耗、损耗、工序阶段。这里只管组成，不管完工扣料。', badge: '明细' },
          { title: '保存配方版本', description: '一次保存主档和明细，生成可回读的配方版本。不要把工单、库存调整混在这里。', badge: '保存' },
          { title: '工单再执行', description: '真正领料、耗用、质检、成品入库必须去工单区完成，防止假完工。', badge: '执行' },
        ]}
        boundaries={[
          { title: '本区只做', items: ['配方版本', '原料组成', '单位/批量', '工艺摘要', '质量标准'] },
          { title: '不要在本区做', items: ['工单完工', '库存调拨', '财务调账', '采购入库', '批次异常'] },
        ]}
        evidence={['版本列表能看到', '明细行数不丢', '选中后能回读', '工单区能带入']}
      />
      <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
        <SectionHeader title="配方主档工作台" subtitle="配方版本 = 产品主数据 + 原料明细行；BOM 仅作为兼容术语保留，列表只负责查找和回读" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SummaryChip label="1 配方主档" value="产品、版本、状态、生效期" />
          <SummaryChip label="2 原料明细" value="只记录组成、占比、单耗、损耗" />
          <SummaryChip label="3 版本回读" value="保存后从列表选中核对" />
        </div>
        <div className="rounded-[28px] border border-blue-100 bg-blue-50/70 px-5 py-4 text-xs font-bold leading-6 text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/10 dark:text-blue-200">
          当前上方是“正在编辑的新配方草稿”，下方是“已保存配方版本只读回读”。选中历史配方只会带入工单产品，不会覆盖正在编辑的草稿，避免配方主档和原料明细互相抢职责。
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
        <div className="xl:col-span-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
          <SectionHeader title="新建配方：主数据" subtitle="只维护产品、版本、状态、生效期；不要在这里填写原料行" />
          <div className="rounded-[24px] border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs font-bold leading-6 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-200">
            先填最少必填项就能建档：产品名称、版本、配方类型、配方模式、输出单位、标准批量。密度、固含、工艺、质检等化工细节放在“高级字段”，避免一开始就把录入人员淹没。
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
            <Field
              dataTestId="production-bom-product-name"
              label="产品名称"
              value={bomProductName}
              onChange={value => {
                clearBomFormError('productName');
                setBomProductName(value);
              }}
              placeholder="例如：环氧树脂底胶"
              error={bomFormErrors.productName}
            />
            <Field label="版本" value={bomVersion} onChange={setBomVersion} placeholder="v1" />
            <SelectField label="配方类型" value={bomType} onChange={setBomType} options={BOM_TYPE_OPTIONS} />
            <SelectField label="配方状态" value={bomStatus} onChange={setBomStatus} options={BOM_STATUS_OPTIONS} />
            <SelectField label="配方模式" value={bomFormulationMode} onChange={setBomFormulationMode} options={FORMULATION_MODE_OPTIONS} />
            <Field
              dataTestId="production-bom-output-unit"
              label="输出单位"
              value={bomOutputUnit}
              onChange={value => {
                clearBomFormError('outputUnit');
                setBomOutputUnit(value);
              }}
              placeholder="kg / 吨"
              error={bomFormErrors.outputUnit}
            />
            <Field
              dataTestId="production-bom-standard-batch-size"
              label="标准批量"
              value={bomStandardBatchSize}
              onChange={value => {
                clearBomFormError('standardBatchSize');
                setBomStandardBatchSize(value);
              }}
              placeholder="例如 1000"
              error={bomFormErrors.standardBatchSize}
            />
            <Field label="批量单位" value={bomBatchSizeUnit} onChange={setBomBatchSizeUnit} placeholder="kg" />
          </div>
          <div className="rounded-[24px] border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <button
              type="button"
              data-testid="production-bom-toggle-advanced"
              onClick={() => setShowAdvancedFields(prev => !prev)}
              className="flex w-full items-center justify-between text-left"
            >
              <span>
                <span className="block text-sm font-black text-slate-900 dark:text-white">高级字段：化工参数 / 工艺 / 质检</span>
                <span className="mt-1 block text-xs font-bold text-slate-400">{advancedSummary}</span>
              </span>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-blue-600 shadow-sm dark:bg-slate-900">
                {showAdvancedFields ? '收起' : '展开'}
              </span>
            </button>
            {showAdvancedFields ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
                  <Field label="密度" value={bomDensity} onChange={setBomDensity} placeholder="例如 1.12" />
                  <Field label="固含 %" value={bomSolidContent} onChange={setBomSolidContent} placeholder="例如 55" />
                  <Field label="生效开始" value={bomEffectiveFrom} onChange={setBomEffectiveFrom} placeholder="2026-04-16" type="date" />
                  <Field label="生效结束" value={bomEffectiveTo} onChange={setBomEffectiveTo} placeholder="2026-12-31" type="date" />
                </div>
                <TextareaField label="工艺摘要" value={bomProcessText} onChange={setBomProcessText} placeholder="输入搅拌、升温、熟化、过滤等关键工艺参数" />
                <TextareaField label="质检规范" value={bomQualitySpecText} onChange={setBomQualitySpecText} placeholder="填写固含、粘度、外观、颜色、耐温等放行标准" />
                <TextareaField label="备注" value={bomNotes} onChange={setBomNotes} placeholder="说明适用产品、产线、颜色体系或客户专配信息" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="xl:col-span-3 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-5">
          <SectionHeader title="新建配方：原料明细" subtitle="这里只录组成行；产品、版本、状态和生效期必须回到左侧主数据维护" />
          {!isBomMasterReady ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs font-bold leading-6 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
              请先补齐左侧产品名称、版本和输出单位。这里的明细只会随左侧配方主数据一起保存，不会单独生成配方或独立版本。
            </div>
          ) : null}
          {bomFormulationMode === 'percentage' ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs font-bold text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
              当前配方百分比合计：{bomPercentageSummary.toFixed(2)}%。百分比只代表配方占比；系统会换算为“每 1 {bomOutputUnit || '单位'} 成品的单位单耗”，标准批量只用于展示批量用量，避免完工扣料被重复放大。
            </div>
          ) : null}
          {bomFormErrors.percentage || bomFormErrors.items ? (
            <div data-testid="production-bom-line-error" className="rounded-[24px] border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs font-bold leading-6 text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
              {bomFormErrors.percentage || bomFormErrors.items}
            </div>
          ) : null}
          <ProductionBomLineGrid
            items={bomItems}
            setItems={value => {
              clearBomFormError('items');
              clearBomFormError('percentage');
              setBomItems(value);
            }}
            standardBatchSize={numericStandardBatchSize}
          />
          <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-[28px] border border-blue-100 bg-white/90 p-4 shadow-[0_20px_60px_rgba(37,99,235,0.12)] backdrop-blur-xl dark:border-blue-900/40 dark:bg-slate-900/90 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-black text-slate-900 dark:text-white">保存为一个配方版本</div>
              <div className="text-xs font-bold text-slate-400">保存前确认左侧主数据 + 右侧原料明细；保存后请在下方只读列表回读，确认原料行没有丢失。</div>
            </div>
            <button data-testid="production-bom-save" onClick={handleCreateBom} disabled={loading || bomSaving} aria-busy={bomSaving} className="px-6 py-4 bg-blue-600 text-white rounded-[24px] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/30 hover:scale-[1.01] transition-all active-shrink disabled:opacity-60">{bomSaving ? '保存中...' : '保存配方版本（主数据 + 明细）'}</button>
          </div>
        </div>
      </div>

      <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-5">
        <SectionHeader title="已保存配方版本（只读回读）" subtitle="这里只负责查找、选中、核对；不在列表里直接编辑明细，避免主数据和明细冲突" />
        <Field label="搜索配方" value={bomKeyword} onChange={setBomKeyword} placeholder="搜索产品、编号或版本" />
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tighter uppercase">已保存配方</h3>
          <div className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">{displayedBoms.length} 条</div>
        </div>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100/50 dark:border-slate-800">
                <Th>编号</Th><Th>产品</Th><Th>类型</Th><Th>版本</Th><Th>物料</Th><Th>工单</Th><Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {displayedBoms.map(bom => (
                <tr key={bom.id} className={`transition-all ${selectedBomId === bom.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-blue-50/20 dark:hover:bg-blue-900/5'}`}>
                  <Td mono>{bom.bomNo}</Td>
                  <Td>
                    <div className="font-bold text-slate-900 dark:text-white text-sm">{bom.productName}</div>
                    <div className="text-[11px] text-slate-400 mt-1">{bom.standardBatchSize ? `标准批量 ${bom.standardBatchSize} ${bom.batchSizeUnit || bom.outputUnit}` : `输出单位 ${bom.outputUnit}`}</div>
                  </Td>
                  <Td>{BOM_TYPE_LABELS[(bom.bomType as BomType) || 'standard'] || '标准BOM'}</Td>
                  <Td>
                    <div className="font-bold text-slate-700 dark:text-slate-200">{bom.version}</div>
                    <div className="text-[11px] text-slate-400 mt-1">{FORMULATION_MODE_LABELS[bom.formulationMode || 'fixed'] || ''}</div>
                  </Td>
                  <Td>{bom.items?.length || 0}</Td>
                  <Td>{bom.workOrders?.length || 0}</Td>
                  <Td>
                    <button onClick={() => { setSelectedBomId(bom.id); setWoProductName(bom.productName); }} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">选中回读/带入工单</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedBom ? (
          <div className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">已选配方</div>
                <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{selectedBom.productName}</div>
                <div className="mt-1 text-xs text-slate-400">{selectedBom.bomNo} / {selectedBom.version}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <MiniTag label={BOM_STATUS_LABELS[(selectedBom.status as BomLifecycleStatus) || 'draft'] || '草稿'} />
                <MiniTag label={BOM_TYPE_LABELS[(selectedBom.bomType as BomType) || 'standard'] || '标准BOM'} />
                <MiniTag label={FORMULATION_MODE_LABELS[selectedBom.formulationMode || 'fixed'] || ''} />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
              <SummaryChip label="配方状态" value={BOM_STATUS_LABELS[(selectedBom.status as BomLifecycleStatus) || 'draft'] || '草稿'} />
              <SummaryChip label="输出单位" value={selectedBom.outputUnit || '--'} />
              <SummaryChip label="标准批量" value={selectedBom.standardBatchSize ? `${selectedBom.standardBatchSize} ${selectedBom.batchSizeUnit || selectedBom.outputUnit}` : '--'} />
              <SummaryChip label="密度" value={selectedBom.density ? String(selectedBom.density) : '--'} />
              <SummaryChip label="固含" value={selectedBom.solidContent !== undefined && selectedBom.solidContent !== null ? `${selectedBom.solidContent}%` : '--'} />
              <SummaryChip label="百分比合计" value={selectedBomPercentageSummary > 0 ? `${selectedBomPercentageSummary.toFixed(2)}%` : '--'} />
              <SummaryChip label="生效开始" value={formatDateOnly(selectedBom.effectiveFrom)} />
              <SummaryChip label="生效结束" value={formatDateOnly(selectedBom.effectiveTo)} />
            </div>
            {selectedBomProcessSummary ? (
              <div className="rounded-[22px] bg-white/80 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-700 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">工艺摘要</div>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{selectedBomProcessSummary}</div>
              </div>
            ) : null}
            {selectedBomQualitySummary ? (
              <div className="rounded-[22px] bg-white/80 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-700 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">质检规范</div>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{selectedBomQualitySummary}</div>
              </div>
            ) : null}
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">配方明细快览</div>
              <div className="space-y-2">
                {selectedBom.items?.map(item => {
                  const displayName = item.materialName || item.materialCode || '保密原料';
                  const isCodeOnly = item.materialCode && item.materialName === item.materialCode;
                  return (
                    <div key={item.id || displayName} className="rounded-[20px] bg-white/80 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-700 px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-black text-slate-900 dark:text-white">{displayName}</div>
                        <div className="text-[11px] text-slate-400 mt-1">{isCodeOnly ? '仅代号' : (item.materialCode || '未填代号')} / {CHEMICAL_ROLE_LABELS[item.ingredientRole || 'other'] || '其他'} / {item.processStage || '未分阶段'}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <MiniTag label={DOSAGE_MODE_LABELS[item.dosageMode || 'fixed'] || ''} />
                        {item.percentage !== undefined && item.percentage !== null ? <MiniTag label={`${item.percentage}%`} /> : null}
                        <MiniTag label={`${item.quantityPerUnit} ${item.unit}`} />
                        {item.lossRate !== undefined && item.lossRate !== null ? <MiniTag label={`损耗 ${item.lossRate}%`} /> : null}
                        {item.allowedVarianceRate !== undefined && item.allowedVarianceRate !== null ? <MiniTag label={`允许偏差 ${item.allowedVarianceRate}%`} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
