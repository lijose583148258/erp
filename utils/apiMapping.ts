export type ApiRecord = Record<string, unknown>;

export type ApiDataResponse<T> = {
  success?: boolean;
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
};

export const isApiRecord = (value: unknown): value is ApiRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const toApiRecord = (value: unknown): ApiRecord =>
  isApiRecord(value) ? value : {};

export const toApiRecordArray = (value: unknown): ApiRecord[] =>
  Array.isArray(value) ? value.map(toApiRecord) : [];

export const toUnknownArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export const toStringValue = (value: unknown, fallback = ''): string =>
  value == null ? fallback : String(value);

export const toOptionalString = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  const text = String(value);
  return text ? text : undefined;
};

export const toNumberValue = (value: unknown, fallback = 0): number => {
  const numberValue = Number(value ?? fallback);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};
