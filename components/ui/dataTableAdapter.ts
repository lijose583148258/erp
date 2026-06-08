import React from 'react';
import type { Column } from '../DataTable';
import type { EnterpriseColumn } from './EnterpriseDataGrid';

export const stringifyGridValue = (value: React.ReactNode): string => {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(stringifyGridValue).join(' ');
  if (React.isValidElement(value)) {
    const props = value.props as { children?: React.ReactNode };
    return stringifyGridValue(props.children);
  }
  return '';
};

export const adaptDataTableColumns = <T,>(
  columns: Column<T>[],
  widths: Partial<Record<string, string>> = {},
): EnterpriseColumn<T>[] => columns.map((column) => {
  const accessor = column.accessor;
  const readValue = (row: T): React.ReactNode => (
    typeof accessor === 'function'
      ? accessor(row)
      : (row as Record<string, React.ReactNode>)[String(accessor)]
  );

  return {
    key: column.key,
    header: column.header,
    render: readValue,
    searchText: column.searchText || ((row) => stringifyGridValue(readValue(row))),
    sortable: true,
    isNumeric: column.isNumeric,
    isStatus: column.isStatus,
    width: widths[column.key],
  };
});
