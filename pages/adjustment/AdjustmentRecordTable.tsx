import React, { ReactNode } from 'react';
import { History } from 'lucide-react';
import type { AdjustmentRecord } from '../../services/adjustment.service';
import { useAppContext } from '../../app/AppContext';
import type { AdjustmentDomainMeta, AdjustmentStatusMeta } from './adjustment.constants';
import { getAdjustmentTargetLabel } from './adjustment.helpers';
import { MobileRecordCard, MobileRecordState } from '../../components/ui/MobileRecordCard';

interface AdjustmentRecordTableProps {
  records: AdjustmentRecord[];
  filteredCount: number;
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  page: number;
  pageSize: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  renderDelta: (record: AdjustmentRecord) => ReactNode;
  domainMeta: AdjustmentDomainMeta;
  statusMeta: AdjustmentStatusMeta;
}

const getAdjustmentLabel = (record: AdjustmentRecord) =>
  record.customerDisplayName ||
  record.customerNameZh ||
  record.customerNameEn ||
  record.customerNameVi ||
  record.customerName ||
  record.productName ||
  record.targetRef ||
  '未命名对象';

const AdjustmentRecordTable = ({
  records,
  filteredCount,
  loading,
  selectedId,
  onSelect,
  page,
  pageSize,
  onPrevPage,
  onNextPage,
  renderDelta,
  domainMeta,
  statusMeta,
}: AdjustmentRecordTableProps) => {
  const { t, language } = useAppContext();
  const mobileActionCopy = {
    zh: { selected: '当前已选中', view: '查看调整详情' },
    en: { selected: 'Currently selected', view: 'View adjustment details' },
    vi: { selected: 'Đang được chọn', view: 'Xem chi tiết điều chỉnh' },
  }[language];

  return (
    <div className="rounded-[36px] border border-slate-100 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-50 p-6 dark:border-slate-800 lg:p-7">
        <div>
          <h2 className="text-xl font-black italic tracking-tight text-slate-900 dark:text-white lg:text-2xl">
            {t.adjustmentTitle}
          </h2>
          <p className="mt-2 text-sm font-bold tracking-wide text-slate-400">
            {t.adjustmentSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-bold tracking-wide text-slate-400">
          <History size={14} />
          {loading ? t.adjustmentLoading : `${filteredCount} ${t.records}`}
        </div>
      </div>
      <div data-mobile-card-list className="space-y-3 p-4 md:hidden">
        {loading ? <MobileRecordState text={t.adjustmentLoading} /> : records.length ? records.map(record => (
          <MobileRecordCard
            key={`${record.id}-mobile`}
            title={record.adjustmentNo}
            subtitle={record.targetRef || record.orderNo || record.batchNo || t.adjustmentManual}
            status={statusMeta[record.status].label}
            fields={[
              { label: t.adjustmentColDomain, value: domainMeta[record.domain].label },
              { label: t.adjustmentColTarget, value: getAdjustmentLabel(record) },
              { label: t.adjustmentColDelta, value: renderDelta(record) },
              { label: t.adjustmentColTime, value: new Date(record.createdAt).toLocaleString() },
              { label: t.adjustmentColReason, value: record.reason, fullWidth: true },
            ]}
            action={(
              <button
                type="button"
                data-testid={`adjustment-mobile-row-${record.id}`}
                onClick={() => onSelect(record.id)}
                className={`min-h-11 w-full rounded-xl px-4 py-3 text-sm font-black transition-colors duration-150 motion-reduce:transition-none ${record.id === selectedId ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700'}`}
              >
                {record.id === selectedId ? mobileActionCopy.selected : mobileActionCopy.view}
              </button>
            )}
          />
        )) : <MobileRecordState text={t.adjustmentNoRecords} />}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-50 dark:border-slate-800">
              <th className="px-6 py-4 text-xs font-bold tracking-wide text-slate-400">{t.adjustmentColNo}</th>
              <th className="px-6 py-4 text-xs font-bold tracking-wide text-slate-400">{t.adjustmentColDomain}</th>
              <th className="px-6 py-4 text-xs font-bold tracking-wide text-slate-400">{t.adjustmentColTarget}</th>
              <th className="px-6 py-4 text-xs font-bold tracking-wide text-slate-400">{t.adjustmentColDelta}</th>
              <th className="px-6 py-4 text-xs font-bold tracking-wide text-slate-400">{t.adjustmentColStatus}</th>
              <th className="px-6 py-4 text-xs font-bold tracking-wide text-slate-400">{t.adjustmentColReason}</th>
              <th className="px-6 py-4 text-xs font-bold tracking-wide text-slate-400">{t.adjustmentColTime}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {records.map(record => {
              const selected = record.id === selectedId;
              return (
                <tr
                  key={record.id}
                  data-testid={`adjustment-row-${record.id}`}
                  onClick={() => onSelect(record.id)}
                  className={`cursor-pointer ${
                    selected
                      ? 'bg-blue-50/40 dark:bg-blue-900/10'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <td className="px-6 py-5">
                    <div className="font-mono text-xs font-black text-slate-700 dark:text-slate-200">
                      {record.adjustmentNo}
                    </div>
                    <div className="mt-1 text-xs font-bold tracking-wide text-slate-400">
                      {record.targetRef || record.orderNo || record.batchNo || t.adjustmentManual}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-black tracking-wide ${domainMeta[record.domain].className}`}
                    >
                      {domainMeta[record.domain].icon}
                      {domainMeta[record.domain].label}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {getAdjustmentLabel(record)}
                    </div>
                    <div className="mt-1 text-xs font-bold tracking-wide text-slate-400">
                      {getAdjustmentTargetLabel(record.targetType)}
                    </div>
                  </td>
                  <td className="px-6 py-5">{renderDelta(record)}</td>
                  <td className="px-6 py-5">
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black tracking-wide ${statusMeta[record.status].className}`}
                    >
                      {statusMeta[record.status].label}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div
                      className="max-w-[220px] truncate text-sm font-bold text-slate-700 dark:text-slate-200"
                      title={record.reason}
                    >
                      {record.reason}
                    </div>
                    <div className="mt-1 text-xs font-bold tracking-wide text-slate-400">
                      {record.reasonCategory || t.adjustmentUncategorized}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-xs font-bold tracking-wide text-slate-400">
                    {new Date(record.createdAt).toLocaleString()}
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center text-sm font-bold tracking-wide text-slate-400">
                  {t.adjustmentNoRecords}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-5 border-t border-slate-50 dark:border-slate-800 flex items-center justify-between">
        <p className="text-xs font-bold tracking-wide text-slate-400">
          {t.adjustmentPageInfo.replace('{page}', String(page)).replace('{pageSize}', String(pageSize))}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onPrevPage}
            disabled={page <= 1}
            className="rounded-full bg-slate-100 px-4 py-2 text-xs font-bold tracking-wide text-slate-600 disabled:opacity-40 dark:bg-slate-800"
          >
            {t.prev}
          </button>
          <button
            onClick={onNextPage}
            className="rounded-full bg-slate-100 px-4 py-2 text-xs font-bold tracking-wide text-slate-600 dark:bg-slate-800"
          >
            {t.next}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdjustmentRecordTable;
