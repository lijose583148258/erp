import type { Prisma } from '@prisma/client';
import prisma from '../config/database';

export type MaterialAuditContext = {
  userId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type MaterialAliasInput = {
  alias: string;
  language?: 'zh' | 'en' | 'vi' | 'und';
  aliasType?: 'business' | 'supplier' | 'customer' | 'legacy' | 'translation';
};

export type CreateMaterialInput = {
  code: string;
  nameZh: string;
  nameEn?: string | null;
  nameVi?: string | null;
  category?: string;
  baseUnit: string;
  specification?: string | null;
  status?: string;
  isTemporary?: boolean;
  casNumber?: string | null;
  unNumber?: string | null;
  hsCode?: string | null;
  shelfLifeDays?: number | null;
  complianceNotes?: string | null;
  aliases?: MaterialAliasInput[];
};

export type UpdateMaterialInput = Partial<Omit<CreateMaterialInput, 'code' | 'aliases'>> & {
  expectedUpdatedAt?: string;
};

export type ListMaterialsInput = {
  q?: string;
  status?: string;
  category?: string;
  includeRetired?: string;
  limit: number;
  offset: number;
};

const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['draft', 'active', 'blocked', 'retired'],
  active: ['active', 'blocked', 'retired'],
  blocked: ['blocked', 'active', 'retired'],
  retired: ['retired'],
};

const cleanOptional = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};

export const normalizeMaterialCode = (value: string) => String(value || '').trim().toUpperCase();

export const normalizeMaterialAlias = (value: string) => String(value || '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('und');

const buildAliases = (input: CreateMaterialInput) => {
  const entries: MaterialAliasInput[] = [
    { alias: input.nameZh, language: 'zh', aliasType: 'translation' },
    ...(input.nameEn ? [{ alias: input.nameEn, language: 'en', aliasType: 'translation' } as MaterialAliasInput] : []),
    ...(input.nameVi ? [{ alias: input.nameVi, language: 'vi', aliasType: 'translation' } as MaterialAliasInput] : []),
    ...(input.aliases || []),
  ];
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const alias = String(entry.alias || '').trim();
    const language = entry.language || 'und';
    const normalizedAlias = normalizeMaterialAlias(alias);
    const key = `${language}:${normalizedAlias}`;
    if (!alias || !normalizedAlias || seen.has(key)) return [];
    seen.add(key);
    return [{
      alias,
      normalizedAlias,
      language,
      aliasType: entry.aliasType || 'business',
    }];
  });
};

const materialInclude = {
  aliases: {
    orderBy: [{ language: 'asc' as const }, { alias: 'asc' as const }],
  },
  _count: {
    select: { bomItems: true },
  },
};

const writeAudit = (
  tx: Prisma.TransactionClient,
  audit: MaterialAuditContext,
  action: string,
  resourceId: number,
  details: Record<string, unknown>,
) => tx.auditLog.create({
  data: {
    userId: audit.userId,
    action,
    resource: 'material',
    resourceId,
    details: JSON.stringify(details),
    ipAddress: audit.ipAddress || null,
    userAgent: audit.userAgent || null,
  },
});

export const buildMaterialWhere = (input: ListMaterialsInput): Prisma.MaterialWhereInput => {
  const normalizedQuery = input.q ? normalizeMaterialAlias(input.q) : '';
  return {
    ...(input.category ? { category: input.category } : {}),
    ...(input.status
      ? { status: input.status }
      : input.includeRetired === 'true'
        ? {}
        : { status: { not: 'retired' } }),
    ...(normalizedQuery ? {
      OR: [
        { code: { contains: normalizeMaterialCode(input.q || '') } },
        { nameZh: { contains: input.q?.trim() || '' } },
        { nameEn: { contains: input.q?.trim() || '' } },
        { nameVi: { contains: input.q?.trim() || '' } },
        { casNumber: { contains: input.q?.trim() || '' } },
        { hsCode: { contains: input.q?.trim() || '' } },
        { aliases: { some: { normalizedAlias: { contains: normalizedQuery } } } },
      ],
    } : {}),
  };
};

export class MaterialMasterService {
  static async list(input: ListMaterialsInput) {
    const where = buildMaterialWhere(input);

    const [items, total] = await prisma.$transaction([
      prisma.material.findMany({
        where,
        include: materialInclude,
        orderBy: [{ status: 'asc' }, { code: 'asc' }],
        skip: input.offset,
        take: input.limit,
      }),
      prisma.material.count({ where }),
    ]);
    return { items, total, limit: input.limit, offset: input.offset };
  }

  static async getById(id: number) {
    return prisma.material.findUnique({ where: { id }, include: materialInclude });
  }

  static async create(input: CreateMaterialInput, audit: MaterialAuditContext) {
    const code = normalizeMaterialCode(input.code);
    const aliases = buildAliases(input);
    const status = input.status || 'draft';
    const isTemporary = input.isTemporary ?? true;
    if (status === 'active' && isTemporary) throw new Error('MATERIAL_ACTIVE_TEMPORARY');
    return prisma.$transaction(async tx => {
      const created = await tx.material.create({
        data: {
          code,
          nameZh: input.nameZh.trim(),
          nameEn: cleanOptional(input.nameEn),
          nameVi: cleanOptional(input.nameVi),
          category: input.category || 'raw_material',
          baseUnit: input.baseUnit.trim(),
          specification: cleanOptional(input.specification),
          status,
          isTemporary,
          casNumber: cleanOptional(input.casNumber),
          unNumber: cleanOptional(input.unNumber),
          hsCode: cleanOptional(input.hsCode),
          shelfLifeDays: input.shelfLifeDays ?? null,
          complianceNotes: cleanOptional(input.complianceNotes),
          createdBy: audit.userId,
          updatedBy: audit.userId,
          aliases: { create: aliases },
        },
        include: materialInclude,
      });
      await writeAudit(tx, audit, 'CREATE_MATERIAL', created.id, {
        code: created.code,
        status: created.status,
        isTemporary: created.isTemporary,
      });
      return created;
    });
  }

  static async update(id: number, input: UpdateMaterialInput, audit: MaterialAuditContext) {
    return prisma.$transaction(async tx => {
      const current = await tx.material.findUnique({ where: { id } });
      if (!current) throw new Error('MATERIAL_NOT_FOUND');
      if (current.status === 'retired') throw new Error('MATERIAL_RETIRED');
      if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new Error('MATERIAL_CONCURRENT_UPDATE');
      }
      if (input.status && !(STATUS_TRANSITIONS[current.status] || []).includes(input.status)) {
        throw new Error(`MATERIAL_STATUS_TRANSITION:${current.status}->${input.status}`);
      }
      const nextStatus = input.status ?? current.status;
      const nextIsTemporary = input.isTemporary ?? current.isTemporary;
      if (nextStatus === 'active' && nextIsTemporary) throw new Error('MATERIAL_ACTIVE_TEMPORARY');

      const data: Prisma.MaterialUpdateManyMutationInput = {
        updatedBy: audit.userId,
        ...(input.nameZh !== undefined ? { nameZh: input.nameZh.trim() } : {}),
        ...(input.nameEn !== undefined ? { nameEn: cleanOptional(input.nameEn) } : {}),
        ...(input.nameVi !== undefined ? { nameVi: cleanOptional(input.nameVi) } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.baseUnit !== undefined ? { baseUnit: input.baseUnit.trim() } : {}),
        ...(input.specification !== undefined ? { specification: cleanOptional(input.specification) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.isTemporary !== undefined ? { isTemporary: input.isTemporary } : {}),
        ...(input.casNumber !== undefined ? { casNumber: cleanOptional(input.casNumber) } : {}),
        ...(input.unNumber !== undefined ? { unNumber: cleanOptional(input.unNumber) } : {}),
        ...(input.hsCode !== undefined ? { hsCode: cleanOptional(input.hsCode) } : {}),
        ...(input.shelfLifeDays !== undefined ? { shelfLifeDays: input.shelfLifeDays ?? null } : {}),
        ...(input.complianceNotes !== undefined ? { complianceNotes: cleanOptional(input.complianceNotes) } : {}),
      };
      if (input.expectedUpdatedAt) {
        const atomicUpdate = await tx.material.updateMany({
          where: {
            id,
            updatedAt: new Date(input.expectedUpdatedAt),
          },
          data,
        });
        if (atomicUpdate.count !== 1) throw new Error('MATERIAL_CONCURRENT_UPDATE');
      } else {
        await tx.material.update({ where: { id }, data });
      }
      const updated = await tx.material.findUnique({ where: { id }, include: materialInclude });
      if (!updated) throw new Error('MATERIAL_NOT_FOUND');
      await writeAudit(tx, audit, 'UPDATE_MATERIAL', id, {
        code: current.code,
        beforeStatus: current.status,
        afterStatus: updated.status,
        changedFields: Object.keys(input).filter(key => key !== 'expectedUpdatedAt'),
      });
      return updated;
    });
  }

  static async addAlias(id: number, input: MaterialAliasInput, audit: MaterialAuditContext) {
    return prisma.$transaction(async tx => {
      const material = await tx.material.findUnique({ where: { id }, select: { id: true, code: true, status: true } });
      if (!material) throw new Error('MATERIAL_NOT_FOUND');
      if (material.status === 'retired') throw new Error('MATERIAL_RETIRED');
      const alias = input.alias.trim();
      const created = await tx.materialAlias.create({
        data: {
          materialId: id,
          alias,
          normalizedAlias: normalizeMaterialAlias(alias),
          language: input.language || 'und',
          aliasType: input.aliasType || 'business',
        },
      });
      await writeAudit(tx, audit, 'ADD_MATERIAL_ALIAS', id, {
        code: material.code,
        aliasId: created.id,
        language: created.language,
        aliasType: created.aliasType,
      });
      return created;
    });
  }
}
