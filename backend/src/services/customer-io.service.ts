import SpreadsheetWorkbook from '../infrastructure/spreadsheet-workbook';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { buildCustomerSearchWhere } from './search.service';
import {
  addImportLimitError,
  BATCH_EXPORT_LIMIT,
  BATCH_IMPORT_LIMIT,
  createImportResult,
  ImportResult,
} from '../types/api.types';
import { getPrimaryCustomerAddress, normalizeCustomerAddresses, type CustomerAddress } from '../utils/customerAddressV2';

export const MAX_EXPORT_SIZE = BATCH_EXPORT_LIMIT;
export const MAX_IMPORT_SIZE = BATCH_IMPORT_LIMIT;

type CustomerSegment = 'direct' | 'channel' | 'mixed';
type ImportRow = Record<string, unknown>;
type ExportFilters = {
  status?: unknown;
  riskLevel?: unknown;
  search?: unknown;
  segment?: unknown;
  viewMode?: unknown;
};

export type CustomerImportData = {
  __row: number;
  name: string;
  nameZh: string | null;
  nameEn: string | null;
  nameVi: string | null;
  nameAliases: string | null;
  licenseNumber: string | null;
  creditLimit: number | null;
  riskLevel: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  addresses: CustomerAddress[];
  contacts: unknown[];
  segment: CustomerSegment;
  poolState: 'public' | 'internal' | 'private';
  status: 'active';
  salespersonId: number | null;
};

const toOptionalString = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

const toNullableString = (value: unknown) => toOptionalString(value) || null;

const toNullableNumber = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function getNormalizedUserSegment(req: AuthRequest): CustomerSegment | null {
  const segment = req.user?.segment;
  return segment === 'direct' || segment === 'channel' || segment === 'mixed' ? segment : null;
}

function normalizeSegment(value: unknown): CustomerSegment | null {
  return value === 'direct' || value === 'channel' || value === 'mixed' ? value : null;
}

function resolveWritableSegment(req: AuthRequest, requestedSegment?: unknown) {
  const normalizedUserSegment = getNormalizedUserSegment(req);
  const normalizedRequestedSegment = normalizeSegment(requestedSegment);

  if (req.user?.role === 'sales') {
    return {
      ok: true as const,
      segment: normalizedUserSegment || 'direct',
    };
  }

  if (req.user?.role === 'manager' && normalizedUserSegment && normalizedUserSegment !== 'mixed') {
    const nextSegment = normalizedRequestedSegment || normalizedUserSegment;
    if (nextSegment !== normalizedUserSegment) {
      return {
        ok: false as const,
        message: '经理只能导入自己业务线的客户',
      };
    }

    return {
      ok: true as const,
      segment: normalizedUserSegment,
    };
  }

  return {
    ok: true as const,
    segment: normalizedRequestedSegment || normalizedUserSegment || 'mixed',
  };
}

function normalizeContacts(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeAliases(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(alias => String(alias).trim()).filter(Boolean)));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map(alias => String(alias).trim()).filter(Boolean)));
      }
    } catch {
      // fall back to human-entered separators
    }

    return Array.from(new Set(
      trimmed
        .split(/[\n,;，、|/]+/)
        .map(alias => alias.trim())
        .filter(Boolean),
    ));
  }

  return [];
}

function serializeAliases(value: unknown): string | null {
  const aliases = normalizeAliases(value);
  return aliases.length > 0 ? JSON.stringify(aliases) : null;
}

function pickImportValue(row: ImportRow, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
}

const normalizeAddressInput = (value: unknown): CustomerAddress[] | string | null => {
  if (Array.isArray(value)) return value as CustomerAddress[];
  if (typeof value === 'string') return value;
  return null;
};

const normalizePoolState = (value: string): CustomerImportData['poolState'] =>
  value === 'public' || value === 'internal' || value === 'private' ? value : 'internal';

export async function buildCustomerImportData(req: AuthRequest, customers: unknown[]) {
  const result: ImportResult = createImportResult();

  if (!Array.isArray(customers) || customers.length === 0) {
    return { result, validCustomers: [] };
  }

  result.attempted = customers.length;
  result.imported = 0;
  const limitedCustomers = customers.slice(0, MAX_IMPORT_SIZE);
  addImportLimitError(result, customers.length, MAX_IMPORT_SIZE);

  const validCustomers = limitedCustomers.map((rawCustomer, i): CustomerImportData | null => {
    const c = rawCustomer && typeof rawCustomer === 'object' && !Array.isArray(rawCustomer)
      ? rawCustomer as ImportRow
      : {};
    const nameZh = pickImportValue(c, ['nameZh', '中文名称', 'Chinese Name']);
    const nameEn = pickImportValue(c, ['nameEn', '英文名称', 'English Name']);
    const nameVi = pickImportValue(c, ['nameVi', '越南文名称', 'Vietnamese Name']);
    const name = pickImportValue(c, ['name', '客户名称', 'Customer Name']) || nameZh || nameEn || nameVi;

    if (!name) {
      result.failed += 1;
      result.errors.push({ row: i + 1, message: '客户名称不能为空' });
      return null;
    }

    const segmentResolution = resolveWritableSegment(req, pickImportValue(c, ['segment', 'Business Line', 'Segment', '业务线']));
    if (!segmentResolution.ok) {
      result.failed += 1;
      result.errors.push({ row: i + 1, message: segmentResolution.message });
      return null;
    }

    const poolState = String(pickImportValue(c, ['poolState', 'Pool State', '客户池']) || 'internal').toLowerCase();
    const salespersonId = req.user?.role === 'sales'
      ? req.user.userId
      : (poolState === 'private' ? Number(pickImportValue(c, ['salespersonId', 'assignedSalespersonId', '销售负责人ID']) || 0) || null : null);

    if (poolState === 'private' && !salespersonId) {
      result.failed += 1;
      result.errors.push({ row: i + 1, message: '私海客户必须指定销售负责人' });
      return null;
    }

    const legacyAddress = pickImportValue(c, ['address', '主地址']);
    const addresses = normalizeCustomerAddresses(
      normalizeAddressInput(pickImportValue(c, ['addresses', 'addressesJson', '地址JSON']) || legacyAddress || null),
    );
    const primaryAddress = getPrimaryCustomerAddress({ addresses, address: toNullableString(legacyAddress) });

    return {
      __row: i + 1,
      name: String(name),
      nameZh: toNullableString(nameZh),
      nameEn: toNullableString(nameEn),
      nameVi: toNullableString(nameVi),
      nameAliases: serializeAliases(pickImportValue(c, ['nameAliases', 'aliasNames', '别名/历史名', 'Aliases'])),
      licenseNumber: toNullableString(pickImportValue(c, ['licenseNumber', '证照号码'])),
      creditLimit: toNullableNumber(pickImportValue(c, ['creditLimit', 'Credit Limit', '信用额度'])),
      riskLevel: String(pickImportValue(c, ['riskLevel', 'Risk Level', '风险等级']) || 'low').toLowerCase(),
      contactName: toNullableString(pickImportValue(c, ['contactName', '联系人'])),
      contactPhone: toNullableString(pickImportValue(c, ['contactPhone', '联系电话'])),
      contactEmail: toNullableString(pickImportValue(c, ['contactEmail', '邮箱'])),
      address: primaryAddress?.fullAddress || toNullableString(legacyAddress),
      addresses,
      contacts: normalizeContacts(pickImportValue(c, ['contacts', 'contactsJson', 'Contacts JSON', '联系人JSON'])),
      segment: segmentResolution.segment,
      poolState: normalizePoolState(poolState),
      status: 'active',
      salespersonId,
    };
  }).filter((customer): customer is CustomerImportData => Boolean(customer));

  result.success = validCustomers.length;
  result.imported = validCustomers.length;
  return { result, validCustomers };
}

export async function buildCustomerExportWorkbook(
  req: AuthRequest,
  filters: ExportFilters,
  accessWhere: Prisma.CustomerWhereInput = {},
) {
  const filterWhere: Prisma.CustomerWhereInput = {};
  if (filters.status) filterWhere.status = String(filters.status);
  if (filters.riskLevel) filterWhere.riskLevel = String(filters.riskLevel);
  if (filters.segment) filterWhere.segment = String(filters.segment);
  if (filters.viewMode === 'public') filterWhere.poolState = 'public';
  if (filters.viewMode === 'my') filterWhere.NOT = { poolState: 'public' };
  Object.assign(filterWhere, buildCustomerSearchWhere(filters.search));
  const where: Prisma.CustomerWhereInput = Object.keys(filterWhere).length > 0
    ? { AND: [accessWhere, filterWhere] }
    : accessWhere;

  const customers = await prisma.customer.findMany({
    where,
    take: MAX_EXPORT_SIZE,
    select: {
      id: true,
      name: true,
      nameZh: true,
      nameEn: true,
      nameVi: true,
      nameAliases: true,
      addressesJson: true,
      contactsJson: true,
      licenseNumber: true,
      creditLimit: true,
      overdueAmount: true,
      riskLevel: true,
      status: true,
      contactName: true,
      contactPhone: true,
      contactEmail: true,
      address: true,
      segment: true,
      poolState: true,
      createdAt: true,
      salesperson: { select: { username: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const workbook = new SpreadsheetWorkbook();
  const worksheet = workbook.addWorksheet('客户列表');
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: '客户名称', key: 'name', width: 30 },
    { header: '中文名称', key: 'nameZh', width: 30 },
    { header: '英文名称', key: 'nameEn', width: 30 },
    { header: '越南文名称', key: 'nameVi', width: 30 },
    { header: '别名/历史名', key: 'nameAliases', width: 36 },
    { header: '证照号码', key: 'licenseNumber', width: 20 },
    { header: '信用额度', key: 'creditLimit', width: 15 },
    { header: '逾期金额', key: 'overdueAmount', width: 15 },
    { header: '风险等级', key: 'riskLevel', width: 12 },
    { header: '状态', key: 'status', width: 10 },
    { header: '联系人', key: 'contactName', width: 15 },
    { header: '联系电话', key: 'contactPhone', width: 15 },
    { header: '邮箱', key: 'contactEmail', width: 25 },
    { header: '主地址', key: 'address', width: 40 },
    { header: '地址JSON', key: 'addressesJson', width: 48 },
    { header: '联系人JSON', key: 'contactsJson', width: 48 },
    { header: '客户池', key: 'poolState', width: 12 },
    { header: '业务线', key: 'segment', width: 12 },
    { header: '销售负责人', key: 'salesperson', width: 15 },
    { header: '创建时间', key: 'createdAt', width: 20 },
  ];

  customers.forEach((customer) => {
    const addresses = normalizeCustomerAddresses(customer.addressesJson || customer.address || null);
    const primaryAddress = getPrimaryCustomerAddress({ addresses, address: customer.address || null });
    worksheet.addRow({
      id: customer.id,
      name: customer.name,
      nameZh: customer.nameZh || '',
      nameEn: customer.nameEn || '',
      nameVi: customer.nameVi || '',
      nameAliases: normalizeAliases(customer.nameAliases).join(' / '),
      licenseNumber: customer.licenseNumber || '',
      creditLimit: customer.creditLimit != null ? Number(customer.creditLimit) : '',
      overdueAmount: Number(customer.overdueAmount || 0),
      riskLevel: customer.riskLevel || '',
      status: customer.status === 'active' ? '启用' : '停用',
      contactName: customer.contactName || '',
      contactPhone: customer.contactPhone || '',
      contactEmail: customer.contactEmail || '',
      address: primaryAddress?.fullAddress || customer.address || '',
      addressesJson: customer.addressesJson || '',
      contactsJson: customer.contactsJson || '',
      poolState: customer.poolState || (customer.salesperson?.username ? 'private' : 'internal'),
      segment: customer.segment || 'mixed',
      salesperson: customer.salesperson?.username || '',
      createdAt: customer.createdAt.toISOString().split('T')[0],
    });
  });

  return { customers, workbook };
}
