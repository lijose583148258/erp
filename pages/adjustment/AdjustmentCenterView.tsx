import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../app/AppContext';
import { DocumentInputGuide } from '../../components/ui/DocumentInputGuide';
import {
  adjustmentDomainMeta,
  adjustmentStatusMeta,
  adjustmentTemplates,
  emptyAdjustmentForm,
  type AdjustmentStatCounts,
  type AdjustmentFormState,
} from './adjustment.constants';
import { buildAdjustmentPayload, buildAdjustmentSearchText, renderAdjustmentDelta } from './adjustment.helpers';
import { adjustmentService, AdjustmentRecord, AdjustmentStatus, AdjustmentSummary, AdjustmentTargetType } from '../../services/adjustment.service';
import { isCanceledApiError } from '../../utils/api';
import AdjustmentHero from './AdjustmentHeroClean';
import AdjustmentFilters from './AdjustmentFiltersClean';
import AdjustmentRecordTable from './AdjustmentRecordTable';
import AdjustmentForm from './AdjustmentFormClean';
import AdjustmentDetail from './AdjustmentDetail';

const AdjustmentCenterView = () => {
  const { formatPrice, notify, t } = useAppContext();
  const [summary, setSummary] = useState<AdjustmentSummary>({ total: 0, byDomain: {}, byStatus: {}, byReasonCategory: {}, amountDelta: 0, quantityDelta: 0 });
  const [records, setRecords] = useState<AdjustmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<'all' | keyof typeof adjustmentDomainMeta>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AdjustmentStatus>('all');
  const [targetTypeFilter, setTargetTypeFilter] = useState<'all' | AdjustmentTargetType>('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(12);
  const [reverseNote, setReverseNote] = useState('\u4eba\u5de5\u51b2\u9500');
  const [form, setForm] = useState<AdjustmentFormState>({ ...emptyAdjustmentForm });

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    try {
      setSummary(await adjustmentService.getSummary({ signal }));
    } catch (error) {
      if (isCanceledApiError(error)) return;
      notify('error', error instanceof Error ? error.message : '加载调账汇总失败，请刷新后再核对');
    }
  }, [notify]);

  const loadRecords = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      const res = await adjustmentService.getAll({
        page,
        pageSize,
        domain: domainFilter === 'all' ? undefined : domainFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        targetType: targetTypeFilter === 'all' ? undefined : targetTypeFilter,
      }, { signal });
      setRecords(res.data || []);
      setSelectedId(prev => (prev && res.data.some(item => item.id === prev) ? prev : res.data[0]?.id ?? null));
    } catch (error) {
      if (isCanceledApiError(error)) return;
      notify('error', error instanceof Error ? error.message : '\u52a0\u8f7d\u8c03\u8d26\u8bb0\u5f55\u5931\u8d25');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [domainFilter, notify, page, pageSize, statusFilter, targetTypeFilter]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  }, [loadSummary]);

  useEffect(() => {
    const controller = new AbortController();
    void loadRecords(controller.signal);
    return () => controller.abort();
  }, [loadRecords]);

  const selected = useMemo(() => records.find(item => item.id === selectedId) || null, [records, selectedId]);
  const filteredRecords = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return records;
    return records.filter(record => buildAdjustmentSearchText(record).includes(kw));
  }, [records, query]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadRecords()]);
  }, [loadRecords, loadSummary]);

  const resetForm = () => setForm({ ...emptyAdjustmentForm });

  const create = async () => {
    try {
      if (!form.reason.trim()) {
        notify('warning', '\u8bf7\u5148\u586b\u5199\u8c03\u8d26\u539f\u56e0');
        return;
      }

      const result = await adjustmentService.create(buildAdjustmentPayload(form));
      notify('success', `\u5df2\u521b\u5efa ${result.adjustment.adjustmentNo}`);
      setSelectedId(result.adjustment.id);
      resetForm();
      await refreshAll();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '\u521b\u5efa\u5931\u8d25');
    }
  };

  const apply = async (id: number) => {
    try {
      const result = await adjustmentService.apply(id);
      notify('success', `\u5df2\u751f\u6548 ${result.adjustment.adjustmentNo}`);
      setSelectedId(result.adjustment.id);
      await refreshAll();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '\u751f\u6548\u5931\u8d25');
    }
  };

  const reverse = async (id: number) => {
    try {
      const result = await adjustmentService.reverse(id, reverseNote.trim() || '\u4eba\u5de5\u51b2\u9500');
      notify('success', '\u5df2\u5b8c\u6210\u51b2\u9500');
      setSelectedId(result.reverse?.id || result.original.id);
      await refreshAll();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '\u51b2\u9500\u5931\u8d25');
    }
  };

  const stat: AdjustmentStatCounts = {
    total: summary.total || 0,
    posted: summary.byStatus?.posted || 0,
    pending: summary.byStatus?.pending || 0,
    reversed: summary.byStatus?.reversed || 0,
  };

  return (
    <div className="space-y-8 pb-16">
      <DocumentInputGuide
        testId="adjustment-input-guide"
        eyebrow="调账 / 调整单路线"
        title="先确定调整域，再建调整凭证，最后过账或冲回"
        description="调账不是万能修改入口。财务、生产、库存和应收调整虽然都叫调整，但影响的数据链不同。这里必须先选清楚调整域和对象，再填写原因和数量/金额，过账后才影响真实台账；冲回必须保留原单和原因。"
        tone="amber"
        steps={[
          { title: '选择调整域', description: '先判断是财务、生产、库存还是应收，避免跨域乱改。', badge: '边界' },
          { title: '填写凭证', description: '选择对象、金额/数量、原因、备注，原因必须能对账。', badge: '凭证' },
          { title: '过账生效', description: '过账后才影响台账，未过账不能当作真实结果。', badge: '过账' },
          { title: '冲回留痕', description: '冲回不是删除，必须保留原调整单、冲回人、时间和原因。', badge: '审计' },
        ]}
        boundaries={[
          { title: '本区负责', items: ['调整凭证', '过账', '冲回', '调账台账', '原因追溯'] },
          { title: '不要在本区替代', items: ['真实回款', '采购收货', '生产完工', '发货签收'] },
        ]}
        evidence={['调整单能查到', '过账后台账变化', '冲回保留记录', '原业务链可回读']}
      />
      <AdjustmentHero stat={stat} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-6">
          <AdjustmentFilters
            query={query}
            onQueryChange={setQuery}
            domainFilter={domainFilter}
            onDomainFilterChange={setDomainFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            targetTypeFilter={targetTypeFilter}
            onTargetTypeFilterChange={setTargetTypeFilter}
            onRefresh={refreshAll}
          />

          <AdjustmentRecordTable
            records={filteredRecords}
            filteredCount={filteredRecords.length}
            loading={loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            page={page}
            pageSize={pageSize}
            onPrevPage={() => setPage(prev => Math.max(1, prev - 1))}
            onNextPage={() => setPage(prev => prev + 1)}
            renderDelta={record => renderAdjustmentDelta(record, formatPrice)}
            domainMeta={adjustmentDomainMeta}
            statusMeta={adjustmentStatusMeta}
          />
        </div>

        <div className="xl:col-span-4 space-y-6">
          <AdjustmentForm
            form={form}
            setForm={setForm}
            templates={adjustmentTemplates}
            onCreate={create}
            onReset={resetForm}
          />

          <AdjustmentDetail
            t={t}
            selected={selected}
            reverseNote={reverseNote}
            onReverseNoteChange={setReverseNote}
            onApply={apply}
            onReverse={reverse}
            formatPrice={formatPrice}
          />
        </div>
      </div>
    </div>
  );
};

export default AdjustmentCenterView;
