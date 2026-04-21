import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../app/AppContext';
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
      console.error(error);
    }
  }, []);

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
