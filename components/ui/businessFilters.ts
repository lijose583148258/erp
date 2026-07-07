export type BusinessFilterKind =
  | 'text'
  | 'dateRange'
  | 'numberRange'
  | 'amountRange'
  | 'multiSelect'
  | 'entitySelect'
  | 'boolean';

export type BusinessFilterOperator =
  | 'contains'
  | 'equals'
  | 'in'
  | 'between'
  | 'gte'
  | 'lte'
  | 'isTrue'
  | 'isFalse';

export type BusinessFilterPrimitive = string | number | boolean | Date | null | undefined;

export type BusinessFilterRangeValue = {
  from?: BusinessFilterPrimitive;
  to?: BusinessFilterPrimitive;
  min?: BusinessFilterPrimitive;
  max?: BusinessFilterPrimitive;
};

export type BusinessFilterValue =
  | BusinessFilterPrimitive
  | BusinessFilterPrimitive[]
  | BusinessFilterRangeValue;

export type BusinessFilterOption = {
  label: string;
  value: string;
};

export type BusinessFilterDefinition<T = Record<string, unknown>> = {
  key: string;
  label: string;
  kind: BusinessFilterKind;
  field?: keyof T | string;
  operator?: BusinessFilterOperator;
  options?: BusinessFilterOption[];
  entity?: 'customer' | 'supplier' | 'sku' | 'user' | 'warehouse' | 'status';
  defaultValue?: BusinessFilterValue;
  serverParam?: string;
  clientAccessor?: (row: T) => unknown;
};

export type BusinessFilterState = {
  keyword?: string;
  values: Record<string, BusinessFilterValue>;
  quickPreset?: string;
  updatedAt: string;
};

export type BusinessFilterMode = 'client' | 'manual';

export const createEmptyBusinessFilterState = (): BusinessFilterState => ({
  keyword: '',
  values: {},
  updatedAt: new Date(0).toISOString(),
});

export const isEmptyBusinessFilterValue = (value: BusinessFilterValue): boolean => {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && !(value instanceof Date)) {
    const range = value as BusinessFilterRangeValue;
    return [range.from, range.to, range.min, range.max].every((item) => item === null || item === undefined || item === '');
  }
  return false;
};

export const hasActiveBusinessFilters = (state?: BusinessFilterState): boolean => {
  if (!state) return false;
  if (state.quickPreset) return true;
  if (state.keyword?.trim()) return true;
  return Object.values(state.values || {}).some((value) => !isEmptyBusinessFilterValue(value));
};

const stringify = (value: unknown): string => {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join(' ');
  return String(value);
};

const normalizeComparable = (value: unknown): string => stringify(value).trim().toLowerCase();

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/[,，\s]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDateTime = (value: unknown, endOfDay = false): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.getTime();
};

const getRangeBound = (value: BusinessFilterValue, fromKeys: Array<keyof BusinessFilterRangeValue>) => {
  if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) return null;
  const range = value as BusinessFilterRangeValue;
  for (const key of fromKeys) {
    if (range[key] !== null && range[key] !== undefined && range[key] !== '') return range[key];
  }
  return null;
};

export const getBusinessFilterRowValue = <T,>(row: T, definition: BusinessFilterDefinition<T>): unknown => {
  if (definition.clientAccessor) return definition.clientAccessor(row);
  if (definition.field) return (row as Record<string, unknown>)[String(definition.field)];
  return (row as Record<string, unknown>)[definition.key];
};

export const matchesBusinessFilter = <T,>(
  row: T,
  definition: BusinessFilterDefinition<T>,
  value: BusinessFilterValue,
): boolean => {
  if (isEmptyBusinessFilterValue(value)) return true;
  const rowValue = getBusinessFilterRowValue(row, definition);

  if (definition.kind === 'dateRange') {
    const current = toDateTime(rowValue);
    if (current === null) return false;
    const from = toDateTime(getRangeBound(value, ['from', 'min']));
    const to = toDateTime(getRangeBound(value, ['to', 'max']), true);
    return (from === null || current >= from) && (to === null || current <= to);
  }

  if (definition.kind === 'numberRange' || definition.kind === 'amountRange') {
    const current = toNumber(rowValue);
    if (current === null) return false;
    const min = toNumber(getRangeBound(value, ['from', 'min']));
    const max = toNumber(getRangeBound(value, ['to', 'max']));
    return (min === null || current >= min) && (max === null || current <= max);
  }

  if (definition.kind === 'multiSelect' || definition.kind === 'entitySelect') {
    const selectedValues = Array.isArray(value) ? value : [value];
    const allowed = selectedValues.map(normalizeComparable).filter(Boolean);
    if (allowed.length === 0) return true;
    const rowValues = Array.isArray(rowValue) ? rowValue : [rowValue];
    return rowValues.some((item) => allowed.includes(normalizeComparable(item)));
  }

  if (definition.kind === 'boolean') {
    if (value === true || value === 'true') return rowValue === true || rowValue === 'true' || rowValue === 1;
    if (value === false || value === 'false') return rowValue === false || rowValue === 'false' || rowValue === 0;
    return true;
  }

  const needle = normalizeComparable(value);
  if (!needle) return true;
  const haystack = normalizeComparable(rowValue);
  return definition.operator === 'equals' ? haystack === needle : haystack.includes(needle);
};

export const applyBusinessFilters = <T,>(
  rows: T[],
  definitions: BusinessFilterDefinition<T>[] = [],
  state?: BusinessFilterState,
): T[] => {
  if (!definitions.length || !state || !hasActiveBusinessFilters(state)) return rows;
  return rows.filter((row) =>
    definitions.every((definition) => matchesBusinessFilter(row, definition, state.values?.[definition.key])),
  );
};
