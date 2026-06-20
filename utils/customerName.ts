import type { Customer, Language } from '../types';
import { splitCustomerTextList } from './customerAlias';

type CustomerNameSource = Pick<Customer, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'displayName'> & {
  nameAliases?: string[] | string | null;
};

const sanitizeName = (name?: string | null) => {
  const value = name?.trim() || '';
  if (!value) return '';

  // Ignore visibly corrupted placeholders so the UI can fall back to another locale.
  if (/[?？\uFFFD]{3,}/u.test(value)) return '';
  if (/^[?？\uFFFD_\-0-9\s]+$/u.test(value)) return '';

  return value;
};

const pickName = (...names: Array<string | undefined | null>) => {
  const value = names
    .map((name) => sanitizeName(name))
    .find((name) => name.length > 0);
  return value || '';
};

export const normalizeCustomerAliases = (aliases?: string[] | string | null) => {
  return splitCustomerTextList(aliases);
};

export const getCustomerDisplayName = (customer: CustomerNameSource, language: Language = 'zh') => {
  if (language === 'en') {
    return pickName(customer.nameEn, customer.name, customer.nameZh, customer.nameVi, customer.displayName);
  }

  if (language === 'vi') {
    return pickName(customer.nameVi, customer.nameEn, customer.nameZh, customer.name, customer.displayName);
  }

  return pickName(customer.nameZh, customer.name, customer.nameEn, customer.nameVi, customer.displayName);
};

export const getCustomerDisplayNames = (customer: CustomerNameSource) => {
  const zh = sanitizeName(customer.nameZh);
  const en = sanitizeName(customer.nameEn);
  const vi = sanitizeName(customer.nameVi);
  const aliases = splitCustomerTextList(customer.nameAliases);
  const primary = pickName(customer.name, zh, en, vi, customer.displayName);

  return {
    zh,
    en,
    vi,
    aliases,
    primary,
  };
};
