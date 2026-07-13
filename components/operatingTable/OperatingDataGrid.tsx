import React from 'react';
import { EnterpriseDataGrid, type EnterpriseColumn } from '../ui/EnterpriseDataGrid';
import { ActionButton, type LabelMap, riskRowClass, text, type Tone } from './BusinessCells';

export type OperatingAction<T> = {
  key: string;
  labelKey: string;
  fallback: string;
  tone?: Tone;
  disabled?: boolean;
  onClick: (row: T) => void;
};

export type OperatingDataGridProps<T> = {
  labels?: LabelMap;
  titleKey: string;
  titleFallback: string;
  descriptionKey?: string;
  descriptionFallback?: string;
  data: T[];
  columns: EnterpriseColumn<T>[];
  rowKey: keyof T | ((row: T) => string);
  loading?: boolean;
  preferenceKey: string;
  exportFileName?: string;
  exportSheetName?: string;
  onImport?: (rows: Record<string, unknown>[]) => void | Promise<void>;
  searchInputTestId?: string;
  getRowTestId?: (row: T) => string;
  searchPlaceholderKey?: string;
  searchPlaceholderFallback?: string;
  emptyTitleKey?: string;
  emptyTitleFallback?: string;
  emptyDescriptionKey?: string;
  emptyDescriptionFallback?: string;
  rowTone?: (row: T) => Tone | undefined;
  rowActions?: (row: T) => OperatingAction<T>[];
  renderRowActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  virtualized?: boolean;
};

export function OperatingDataGrid<T>({
  labels,
  titleKey,
  titleFallback,
  descriptionKey,
  descriptionFallback,
  data,
  columns,
  rowKey,
  loading,
  preferenceKey,
  exportFileName,
  exportSheetName,
  onImport,
  searchInputTestId,
  getRowTestId,
  searchPlaceholderKey,
  searchPlaceholderFallback,
  emptyTitleKey,
  emptyTitleFallback,
  emptyDescriptionKey,
  emptyDescriptionFallback,
  rowTone,
  rowActions,
  renderRowActions,
  onRowClick,
  virtualized = true,
}: OperatingDataGridProps<T>) {
  return (
    <EnterpriseDataGrid
      data={data}
      columns={columns}
      rowKey={rowKey}
      title={text(labels, titleKey, titleFallback)}
      description={descriptionKey ? text(labels, descriptionKey, descriptionFallback || '') : descriptionFallback}
      loading={loading}
      preferenceKey={preferenceKey}
      exportFileName={exportFileName}
      exportSheetName={exportSheetName}
      onImport={onImport}
      searchInputTestId={searchInputTestId}
      getRowTestId={getRowTestId}
      searchPlaceholder={text(labels, searchPlaceholderKey || 'table.search', searchPlaceholderFallback || 'Search by customer, order, product or owner')}
      emptyTitle={text(labels, emptyTitleKey || 'table.emptyTitle', emptyTitleFallback || 'No records')}
      emptyDescription={text(labels, emptyDescriptionKey || 'table.emptyDescription', emptyDescriptionFallback || 'Clear filters or create a new record.')}
      rowClassName={(row) => riskRowClass(rowTone?.(row))}
      rowActions={renderRowActions || (rowActions ? (row) => rowActions(row).map((action) => (
        <ActionButton key={action.key} tone={action.tone} disabled={action.disabled} onClick={() => action.onClick(row)}>
          {text(labels, action.labelKey, action.fallback)}
        </ActionButton>
      )) : undefined)}
      onRowClick={onRowClick}
      paginationTestIdPrefix={preferenceKey}
      virtualized={virtualized}
    />
  );
}
