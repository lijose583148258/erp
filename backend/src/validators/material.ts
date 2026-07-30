import { z } from 'zod';

export const MATERIAL_CATEGORIES = [
  'raw_material',
  'finished_good',
  'semi_finished',
  'packaging',
  'consumable',
  'service',
] as const;

export const MATERIAL_STATUSES = ['draft', 'active', 'blocked', 'retired'] as const;
export const MATERIAL_ALIAS_LANGUAGES = ['zh', 'en', 'vi', 'und'] as const;
export const MATERIAL_ALIAS_TYPES = ['business', 'supplier', 'customer', 'legacy', 'translation'] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const materialAliasInputSchema = z.object({
  alias: z.string().trim().min(1).max(160),
  language: z.enum(MATERIAL_ALIAS_LANGUAGES).default('und'),
  aliasType: z.enum(MATERIAL_ALIAS_TYPES).default('business'),
}).strict();

export const createMaterialSchema = z.object({
  code: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, '物料编码只能包含字母、数字、点、斜线、下划线和短横线'),
  nameZh: z.string().trim().min(1).max(160),
  nameEn: optionalText(160),
  nameVi: optionalText(160),
  category: z.enum(MATERIAL_CATEGORIES).default('raw_material'),
  baseUnit: z.string().trim().min(1).max(24),
  specification: optionalText(240),
  status: z.enum(MATERIAL_STATUSES).default('draft'),
  isTemporary: z.boolean().default(true),
  casNumber: optionalText(64),
  unNumber: optionalText(64),
  hsCode: optionalText(64),
  shelfLifeDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  complianceNotes: optionalText(2000),
  aliases: z.array(materialAliasInputSchema).max(50).default([]),
}).strict();

export const updateMaterialSchema = createMaterialSchema
  .omit({ code: true, aliases: true })
  .partial()
  .extend({
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, '至少填写一个需要修改的字段');

export const materialIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

export const listMaterialsQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  status: z.enum(MATERIAL_STATUSES).optional(),
  category: z.enum(MATERIAL_CATEGORIES).optional(),
  includeRetired: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export const materialGovernanceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

const bomBackfillSourceSchema = z.object({
  materialName: z.string().min(1).max(160),
  materialCode: z.string().max(64).nullable(),
  unit: z.string().min(1).max(24),
}).strict();

export const applyBomBackfillSchema = z.object({
  mappings: z.array(z.object({
    source: bomBackfillSourceSchema,
    materialId: z.coerce.number().int().positive(),
    expectedCount: z.coerce.number().int().min(1).max(500),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1).max(50),
}).strict();

export const materialGovernanceRunIdParamSchema = z.object({
  runId: z.coerce.number().int().positive(),
}).strict();
