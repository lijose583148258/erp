import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { normalizeMaterialAlias, normalizeMaterialCode, type MaterialAuditContext } from './material-master.service';

export type BomBackfillSource = {
  materialName: string;
  materialCode: string | null;
  unit: string;
};

export type BomBackfillMapping = {
  source: BomBackfillSource;
  materialId: number;
  expectedCount: number;
  expectedFingerprint: string;
};

type MatchReason = 'code' | 'name_zh' | 'name_en' | 'name_vi' | 'alias';

const MAX_GROUPS_PER_PAGE = 50;
const MAX_CHANGES_PER_RUN = 500;

const normalizeUnit = (value: string) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('und');

export const buildBomBackfillSourceKey = (source: BomBackfillSource) => [
  normalizeMaterialCode(source.materialCode || ''),
  normalizeMaterialAlias(source.materialName),
  normalizeUnit(source.unit),
].join('|');

export const buildBomBackfillFingerprint = (source: BomBackfillSource, itemIds: number[]) => createHash('sha256')
  .update(JSON.stringify({
    sourceKey: buildBomBackfillSourceKey(source),
    itemIds: [...itemIds].sort((left, right) => left - right),
  }))
  .digest('hex');

const stableDigest = (mappings: BomBackfillMapping[]) => {
  const canonical = mappings
    .map(mapping => ({
      sourceKey: buildBomBackfillSourceKey(mapping.source),
      materialId: mapping.materialId,
      expectedCount: mapping.expectedCount,
      expectedFingerprint: mapping.expectedFingerprint,
    }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const sourceWhere = (source: BomBackfillSource): Prisma.ProductionBomItemWhereInput => ({
  materialId: null,
  materialName: source.materialName,
  materialCode: source.materialCode,
  unit: source.unit,
});

const sourceSnapshot = (source: BomBackfillSource) => ({
  materialName: source.materialName,
  materialCode: source.materialCode,
  unit: source.unit,
});

const materialIndexKeys = (material: {
  code: string;
  nameZh: string;
  nameEn: string | null;
  nameVi: string | null;
  aliases: Array<{ normalizedAlias: string }>;
}) => {
  const keys: Array<{ key: string; reason: MatchReason; confidence: number }> = [
    { key: normalizeMaterialCode(material.code), reason: 'code', confidence: 1 },
    { key: normalizeMaterialAlias(material.nameZh), reason: 'name_zh', confidence: 0.99 },
  ];
  if (material.nameEn) keys.push({ key: normalizeMaterialAlias(material.nameEn), reason: 'name_en', confidence: 0.99 });
  if (material.nameVi) keys.push({ key: normalizeMaterialAlias(material.nameVi), reason: 'name_vi', confidence: 0.99 });
  material.aliases.forEach(alias => keys.push({
    key: alias.normalizedAlias,
    reason: 'alias',
    confidence: 0.98,
  }));
  return keys.filter(entry => Boolean(entry.key));
};

export class MaterialGovernanceService {
  static async listBomBackfillCandidates(input: { limit: number; offset: number }) {
    const limit = Math.min(MAX_GROUPS_PER_PAGE, input.limit);
    const groups = await prisma.productionBomItem.groupBy({
      by: ['materialName', 'materialCode', 'unit'],
      where: { materialId: null },
      _count: { id: true },
      orderBy: [{ materialName: 'asc' }, { materialCode: 'asc' }, { unit: 'asc' }],
      skip: input.offset,
      take: limit,
    });
    const totalUnlinkedItems = await prisma.productionBomItem.count({ where: { materialId: null } });

    const materials = await prisma.material.findMany({
      where: { status: { not: 'retired' } },
      include: { aliases: true },
      orderBy: { code: 'asc' },
    });
    const index = new Map<string, Array<{
      material: typeof materials[number];
      reason: MatchReason;
      confidence: number;
    }>>();
    materials.forEach(material => {
      materialIndexKeys(material).forEach(entry => {
        const bucket = index.get(entry.key) || [];
        const existing = bucket.find(candidate => candidate.material.id === material.id);
        if (!existing || existing.confidence < entry.confidence) {
          if (existing) bucket.splice(bucket.indexOf(existing), 1);
          bucket.push({ material, reason: entry.reason, confidence: entry.confidence });
        }
        index.set(entry.key, bucket);
      });
    });

    const sourceRows = await Promise.all(groups.map(group => prisma.productionBomItem.findMany({
      where: sourceWhere({
        materialName: group.materialName,
        materialCode: group.materialCode,
        unit: group.unit,
      }),
      select: {
        id: true,
        bom: { select: { bomNo: true, productName: true, version: true } },
      },
      orderBy: { id: 'asc' },
      take: MAX_CHANGES_PER_RUN + 1,
    })));

    const items = groups.map((group, groupIndex) => {
      const source: BomBackfillSource = {
        materialName: group.materialName,
        materialCode: group.materialCode,
        unit: group.unit,
      };
      const sourceKeys = Array.from(new Set([
        normalizeMaterialCode(source.materialCode || ''),
        normalizeMaterialAlias(source.materialName),
      ].filter(Boolean)));
      const matched = new Map<number, {
        material: typeof materials[number];
        reason: MatchReason;
        confidence: number;
      }>();
      sourceKeys.forEach(key => {
        (index.get(key) || []).forEach(candidate => {
          const existing = matched.get(candidate.material.id);
          if (!existing || existing.confidence < candidate.confidence) matched.set(candidate.material.id, candidate);
        });
      });
      const suggestions = Array.from(matched.values())
        .map(candidate => ({
          materialId: candidate.material.id,
          code: candidate.material.code,
          nameZh: candidate.material.nameZh,
          baseUnit: candidate.material.baseUnit,
          status: candidate.material.status,
          isTemporary: candidate.material.isTemporary,
          reason: candidate.reason,
          confidence: candidate.confidence,
          unitCompatible: normalizeUnit(candidate.material.baseUnit) === normalizeUnit(source.unit),
          eligible: candidate.material.status === 'active'
            && !candidate.material.isTemporary
            && normalizeUnit(candidate.material.baseUnit) === normalizeUnit(source.unit),
        }))
        .sort((left, right) => Number(right.eligible) - Number(left.eligible)
          || right.confidence - left.confidence
          || left.code.localeCompare(right.code));
      const eligible = suggestions.filter(suggestion => suggestion.eligible);
      const matchingRows = sourceRows[groupIndex];
      const overLimit = group._count.id > MAX_CHANGES_PER_RUN;
      const sampleBoms = Array.from(new Map(
        matchingRows.map(sample => [
          `${sample.bom.bomNo}|${sample.bom.version}`,
          sample.bom,
        ]),
      ).values()).slice(0, 3);
      const matchState = eligible.length === 1
        ? 'exact_unique'
        : eligible.length > 1
          ? 'exact_ambiguous'
          : suggestions.length > 0
            ? 'unit_or_lifecycle_blocked'
            : 'no_exact_match';
      return {
        source,
        sourceKey: buildBomBackfillSourceKey(source),
        occurrenceCount: group._count.id,
        expectedFingerprint: overLimit
          ? null
          : buildBomBackfillFingerprint(source, matchingRows.map(row => row.id)),
        overLimit,
        matchState,
        recommendedMaterialId: !overLimit && eligible.length === 1 ? eligible[0].materialId : null,
        suggestions,
        sampleBoms,
      };
    });

    return {
      items,
      limit,
      offset: input.offset,
      totalUnlinkedItems,
      hasMoreGroups: groups.length === limit,
      policy: {
        automaticWrite: false,
        exactMatchOnly: true,
        requiresActiveNonTemporaryMaterial: true,
        requiresUnitMatch: true,
        maxChangesPerRun: MAX_CHANGES_PER_RUN,
      },
    };
  }

  static async applyBomBackfill(mappings: BomBackfillMapping[], audit: MaterialAuditContext) {
    const digest = stableDigest(mappings);
    const existing = await prisma.materialGovernanceRun.findFirst({
      where: {
        runType: 'bom_backfill',
        status: 'applied',
        inputDigest: digest,
        createdBy: audit.userId,
      },
      include: {
        changes: { select: { entityId: true, afterValue: true } },
        _count: { select: { changes: true } },
      },
    });
    if (existing) {
      const grouped = new Map<number, number[]>();
      existing.changes.forEach(change => {
        const materialId = Number(change.afterValue);
        if (!Number.isInteger(materialId) || materialId <= 0) {
          throw new Error('MATERIAL_BACKFILL_IDEMPOTENCY_STATE_DRIFT');
        }
        const ids = grouped.get(materialId) || [];
        ids.push(change.entityId);
        grouped.set(materialId, ids);
      });
      for (const [materialId, ids] of grouped) {
        const unchanged = await prisma.productionBomItem.count({
          where: { id: { in: ids }, materialId },
        });
        if (unchanged !== ids.length) throw new Error('MATERIAL_BACKFILL_IDEMPOTENCY_STATE_DRIFT');
      }
      const { changes: _changes, ...run } = existing;
      return { run, idempotent: true };
    }

    return prisma.$transaction(async tx => {
      const sourceKeys = new Set<string>();
      mappings.forEach(mapping => {
        const key = buildBomBackfillSourceKey(mapping.source);
        if (sourceKeys.has(key)) throw new Error('MATERIAL_BACKFILL_DUPLICATE_SOURCE');
        sourceKeys.add(key);
      });
      const targetIds = Array.from(new Set(mappings.map(mapping => mapping.materialId)));
      const targets = await tx.material.findMany({ where: { id: { in: targetIds } } });
      if (targets.length !== targetIds.length) throw new Error('MATERIAL_BACKFILL_TARGET_NOT_FOUND');
      const targetById = new Map(targets.map(target => [target.id, target]));

      const planned: Array<{
        mapping: BomBackfillMapping;
        itemIds: number[];
        target: typeof targets[number];
      }> = [];
      let totalChanges = 0;
      for (const mapping of mappings) {
        const target = targetById.get(mapping.materialId)!;
        if (target.status !== 'active' || target.isTemporary) throw new Error('MATERIAL_BACKFILL_TARGET_NOT_ACTIVE');
        if (normalizeUnit(target.baseUnit) !== normalizeUnit(mapping.source.unit)) {
          throw new Error('MATERIAL_BACKFILL_UNIT_MISMATCH');
        }
        const rows = await tx.productionBomItem.findMany({
          where: sourceWhere(mapping.source),
          select: { id: true },
          orderBy: { id: 'asc' },
          take: MAX_CHANGES_PER_RUN + 1,
        });
        if (rows.length !== mapping.expectedCount) throw new Error('MATERIAL_BACKFILL_SOURCE_CHANGED');
        if (buildBomBackfillFingerprint(mapping.source, rows.map(row => row.id)) !== mapping.expectedFingerprint) {
          throw new Error('MATERIAL_BACKFILL_SOURCE_CHANGED');
        }
        totalChanges += rows.length;
        if (totalChanges > MAX_CHANGES_PER_RUN) throw new Error('MATERIAL_BACKFILL_LIMIT_EXCEEDED');
        planned.push({ mapping, itemIds: rows.map(row => row.id), target });
      }
      if (totalChanges === 0) throw new Error('MATERIAL_BACKFILL_EMPTY');

      const run = await tx.materialGovernanceRun.create({
        data: {
          runNo: buildBusinessNo('MAT-BF'),
          runType: 'bom_backfill',
          status: 'applied',
          inputDigest: digest,
          createdBy: audit.userId,
          appliedAt: new Date(),
          summaryJson: JSON.stringify({
            mappingCount: mappings.length,
            changedItems: totalChanges,
          }),
        },
      });

      for (const entry of planned) {
        const update = await tx.productionBomItem.updateMany({
          where: { id: { in: entry.itemIds }, materialId: null },
          data: { materialId: entry.target.id },
        });
        if (update.count !== entry.itemIds.length) throw new Error('MATERIAL_BACKFILL_CONCURRENT_UPDATE');
        await tx.materialGovernanceChange.createMany({
          data: entry.itemIds.map(entityId => ({
            runId: run.id,
            entityType: 'production_bom_item',
            entityId,
            fieldName: 'materialId',
            beforeValue: null,
            afterValue: String(entry.target.id),
            beforeSnapshotJson: JSON.stringify(sourceSnapshot(entry.mapping.source)),
            afterSnapshotJson: JSON.stringify({
              ...sourceSnapshot(entry.mapping.source),
              materialId: entry.target.id,
              materialCode: entry.target.code,
              materialName: entry.target.nameZh,
            }),
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          userId: audit.userId,
          action: 'APPLY_MATERIAL_BOM_BACKFILL',
          resource: 'material_governance_run',
          resourceId: run.id,
          details: JSON.stringify({
            runNo: run.runNo,
            mappingCount: mappings.length,
            changedItems: totalChanges,
            inputDigest: digest,
          }),
          ipAddress: audit.ipAddress || null,
          userAgent: audit.userAgent || null,
        },
      });
      const completed = await tx.materialGovernanceRun.findUnique({
        where: { id: run.id },
        include: { _count: { select: { changes: true } } },
      });
      return { run: completed, idempotent: false };
    });
  }

  static async listRuns(input: { limit: number; offset: number }) {
    const where = { runType: 'bom_backfill' };
    const [items, total] = await prisma.$transaction([
      prisma.materialGovernanceRun.findMany({
        where,
        include: { _count: { select: { changes: true } } },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        skip: input.offset,
      }),
      prisma.materialGovernanceRun.count({ where }),
    ]);
    return { items, total, limit: input.limit, offset: input.offset };
  }

  static async rollbackRun(runId: number, audit: MaterialAuditContext) {
    return prisma.$transaction(async tx => {
      const run = await tx.materialGovernanceRun.findUnique({
        where: { id: runId },
        include: { changes: true },
      });
      if (!run) throw new Error('MATERIAL_GOVERNANCE_RUN_NOT_FOUND');
      if (run.runType !== 'bom_backfill') throw new Error('MATERIAL_GOVERNANCE_RUN_TYPE_UNSUPPORTED');
      if (run.status === 'rolled_back') return { run, idempotent: true };
      if (run.status !== 'applied') throw new Error('MATERIAL_GOVERNANCE_RUN_NOT_APPLIED');
      if (!run.changes.length) throw new Error('MATERIAL_GOVERNANCE_RUN_EMPTY');

      const grouped = new Map<string, number[]>();
      run.changes.forEach(change => {
        const key = String(change.afterValue || '');
        const ids = grouped.get(key) || [];
        ids.push(change.entityId);
        grouped.set(key, ids);
      });
      for (const [afterValue, ids] of grouped) {
        const materialId = Number(afterValue);
        if (!Number.isInteger(materialId) || materialId <= 0) throw new Error('MATERIAL_GOVERNANCE_CHANGE_CORRUPT');
        const update = await tx.productionBomItem.updateMany({
          where: { id: { in: ids }, materialId },
          data: { materialId: null },
        });
        if (update.count !== ids.length) throw new Error('MATERIAL_GOVERNANCE_ROLLBACK_CONFLICT');
      }
      const rolledBack = await tx.materialGovernanceRun.update({
        where: { id: run.id },
        data: { status: 'rolled_back', rolledBackAt: new Date() },
        include: { _count: { select: { changes: true } } },
      });
      await tx.auditLog.create({
        data: {
          userId: audit.userId,
          action: 'ROLLBACK_MATERIAL_BOM_BACKFILL',
          resource: 'material_governance_run',
          resourceId: run.id,
          details: JSON.stringify({ runNo: run.runNo, restoredItems: run.changes.length }),
          ipAddress: audit.ipAddress || null,
          userAgent: audit.userAgent || null,
        },
      });
      return { run: rolledBack, idempotent: false };
    });
  }
}
