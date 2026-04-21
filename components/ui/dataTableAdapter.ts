import React from 'react';
import type { Column } from '../DataTable';
import type { EnterpriseColumn } from './EnterpriseDataGrid';

export const stringifyGridValue = (value: React.ReactNode): string => {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifyGridValue).join(' ');
  return '';
};

export const adaptDataTableColumns = <T,>(
  columns: Column<T>[],
  widths: Partial<Record<string, string>> = {},
): EnterpriseColumn<T>[] => columns.map((column) => {
  const accessor = column.accessor;
  const readValue = (row: T) => (
    typeof accessor === 'function'
      ? accessor(row)
      : (row as Record<string, unknown>)[String(accessor)]
  );

  return {
    key: column.key,
    header: column.header,
    render: readValue,
    searchText: (row) => stringifyGridValue(readValue(row)),
    sortable: true,
    isNumeric: column.isNumeric,
    isStatus: column.isStatus,
    width: widths[column.key],
  };
});
