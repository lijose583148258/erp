import type { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import {
  normalizeJsonList,
  serializeJsonList,
  serializeSupplierAliases,
} from './procurement-domain.service';
import type { TransactionClient } from './stock-movement.service';

export interface CreateSupplierInput {
  name?: unknown;
  nameZh?: unknown;
  nameEn?: unknown;
  nameVi?: unknown;
  nameAliases?: unknown;
  contacts?: unknown;
  addresses?: unknown;
  category?: unknown;
  rating?: unknown;
  leadTimeDays?: unknown;
  riskLevel?: unknown;
  contact?: unknown;
  status?: unknown;
}

const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);
const VALID_SUPPLIER_STATUSES = new Set(['active', 'inactive']);

function toOptionalText(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

function toRequiredText(value: unknown, code: string) {
  const text = toOptionalText(value);
  if (!text) {
    throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return text;
}

function toOptionalRating(value: unknown) {
  if (value === undefined || value === null || value === '') return 4;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
    throw new AppError('SUPPLIER_INVALID_RATING', 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return parsed;
}

function toOptionalLeadTimeDays(value: unknown) {
  if (value === undefined || value === null || value === '') return 7;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError('SUPPLIER_INVALID_LEAD_TIME', 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return parsed;
}

function normalizeRiskLevel(value: unknown) {
  const riskLevel = String(value || 'medium').trim();
  if (!VALID_RISK_LEVELS.has(riskLevel)) {
    throw new AppError('SUPPLIER_INVALID_RISK_LEVEL', 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return riskLevel;
}

function normalizeSupplierStatus(value: unknown) {
  const status = String(value || 'active').trim();
  if (!VALID_SUPPLIER_STATUSES.has(status)) {
    throw new AppError('SUPPLIER_INVALID_STATUS', 400, ErrorCode.VALIDATION_ERROR, { value });
  }
  return status;
}

function normalizeEntityList(value: unknown, code: string) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    const rows = value.filter(item => item && typeof item === 'object');
    if (rows.length !== value.length) {
      throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR, { value });
    }
    return rows as Record<string, unknown>[];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeEntityList(parsed, code);
      }
    } catch {}
  }
  throw new AppError(code, 400, ErrorCode.VALIDATION_ERROR, { value });
}

export async function getSupplierColumnSet(tx: TransactionClient) {
  // SAFE: 参数为硬编码表名 'suppliers'，无用户输入拼接
  const rows = await tx.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info('suppliers')`);
  return new Set((rows || []).map(row => String(row.name)));
}

export async function createSupplierRecord(tx: TransactionClient, input: CreateSupplierInput) {
  const nameZh = toOptionalText(input.nameZh);
  const nameEn = toOptionalText(input.nameEn);
  const nameVi = toOptionalText(input.nameVi);
  const primaryName = toOptionalText(input.name) || nameZh || nameEn || nameVi;
  if (!primaryName) {
    throw new AppError('SUPPLIER_INVALID_NAME', 400, ErrorCode.VALIDATION_ERROR);
  }

  const contacts = normalizeEntityList(input.contacts, 'SUPPLIER_INVALID_CONTACTS');
  const addresses = normalizeEntityList(input.addresses, 'SUPPLIER_INVALID_ADDRESSES');
  const supplierColumns = await getSupplierColumnSet(tx);
  const supplierData: Prisma.SupplierCreateInput = {
    name: primaryName,
    category: toRequiredText(input.category, 'SUPPLIER_INVALID_CATEGORY'),
    rating: toOptionalRating(input.rating),
    leadTimeDays: toOptionalLeadTimeDays(input.leadTimeDays),
    riskLevel: normalizeRiskLevel(input.riskLevel),
    contact: toOptionalText(input.contact) || String(contacts[0]?.name || contacts[0]?.phone || ''),
    status: normalizeSupplierStatus(input.status),
  };

  if (supplierColumns.has('name_zh')) supplierData.nameZh = nameZh;
  if (supplierColumns.has('name_en')) supplierData.nameEn = nameEn;
  if (supplierColumns.has('name_vi')) supplierData.nameVi = nameVi;
  if (supplierColumns.has('name_aliases')) supplierData.nameAliases = serializeSupplierAliases(input.nameAliases);
  if (supplierColumns.has('contacts_json')) supplierData.contactsJson = serializeJsonList(normalizeJsonList(contacts));
  if (supplierColumns.has('addresses_json')) supplierData.addressesJson = serializeJsonList(normalizeJsonList(addresses));

  return tx.supplier.create({ data: supplierData });
}
