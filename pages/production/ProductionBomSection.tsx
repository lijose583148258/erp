import React, { Dispatch, SetStateAction } from 'react';
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
  return (
    <section className="xl:col-span-5 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-8">
      <SectionHeader title="BOM 管理" subtitle="标准 BOM / 化工配方" />
      <Field label="搜索 BOM" value={bomKeyword} onChange={setBomKeyword} placeholder="搜索产品、编号或版本" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Field label="产品名称" value={bomProductName} onChange={setBomProductName} placeholder="例如：环氧树脂底胶" />
        <Field label="版本" value={bomVersion} onChange={setBomVersion} placeholder="v1" />
        <SelectField label="BOM 类型" value={bomType} onChange={setBomType} options={BOM_TYPE_OPTIONS} />
        <SelectField label="配方状态" value={bomStatus} onChange={setBomStatus} options={BOM_STATUS_OPTIONS} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <SelectField label="配方模式" value={bomFormulationMode} onChange={setBomFormulationMode} options={FORMULATION_MODE_OPTIONS} />
        <Field label="输出单位" value={bomOutputUnit} onChange={setBomOutputUnit} placeholder="kg / 吨" />
        <Field label="标准批量" value={bomStandardBatchSize} onChange={setBomStandardBatchSize} placeholder="例如 1000" />
        <Field label="批量单位" value={bomBatchSizeUnit} onChange={setBomBatchSizeUnit} placeholder="kg" />
        <Field label="密度" value={bomDensity} onChange={setBomDensity} placeholder="例如 1.12" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="固含 %" value={bomSolidContent} onChange={setBomSolidContent} placeholder="例如 55" />
        <TextareaField label="工艺摘要" value={bomProcessText} onChange={setBomProcessText} placeholder="输入搅拌、升温、熟化、过滤等关键工艺参数" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Field label="生效开始" value={bomEffectiveFrom} onChange={setBomEffectiveFrom} placeholder="2026-04-16" type="date" />
        <Field label="生效结束" value={bomEffectiveTo} onChange={setBomEffectiveTo} placeholder="2026-12-31" type="date" />
        <div className="xl:col-span-2">
          <TextareaField label="质检规范" value={bomQualitySpecText} onChange={setBomQualitySpecText} placeholder="填写固含、粘度、外观、颜色、耐温等放行标准" />
        </div>
      </div>
      <TextareaField label="备注" value={bomNotes} onChange={setBomNotes} placeholder="说明适用产品、产线、颜色体系或客户专配信息" />
      {bomFormulationMode === 'percentage' ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs font-bold text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
          当前配方百分比合计：{bomPercentageSummary.toFixed(2)}%。系统会优先使用“标准批量 x 百分比”换算单耗，财务仍按单耗口径核算。
        </div>
      ) : null}
      <div className="space-y-3">
        <ProductionBomLineGrid items={bomItems} setItems={setBomItems} standardBatchSize={numericStandardBatchSize} />
      </div>
      <button onClick={handleCreateBom} disabled={loading} className="px-6 py-4 bg-blue-600 text-white rounded-[24px] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/30 hover:scale-[1.01] transition-all active-shrink disabled:opacity-60">创建 BOM</button>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tighter uppercase">BOM 列表</h3>
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
                    <button onClick={() => { setSelectedBomId(bom.id); setWoProductName(bom.productName); }} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">选中</button>
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
                <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">已选 BOM</div>
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
