import { CustomerPoolState } from './customer.types';

export type CustomerRequestBody = Record<string, unknown>;

export const asRequestBody = (value: unknown): CustomerRequestBody =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as CustomerRequestBody : {};

export const toOptionalString = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

export const toNullableString = (value: unknown) => toOptionalString(value) || null;

export const toCustomerPoolState = (value: unknown, fallback: CustomerPoolState): CustomerPoolState => {
  return value === 'public' || value === 'internal' || value === 'private' ? value : fallback;
};
