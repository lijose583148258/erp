import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import { createDensityRevisionSchema, reviewDensityRevisionSchema } from '../validators/material-density';

type Input = z.infer<typeof createDensityRevisionSchema>;
const units = new Set(['mg','g','kg','t','毫克','克','千克','公斤','吨','L','l','mL','ml','升','毫升','m3','m³']);
const audit = (tx: Prisma.TransactionClient, userId: number, action: string, id: number, details: unknown) =>
  tx.auditLog.create({ data: { userId, action, resource: 'material_density', resourceId: id, details: JSON.stringify(details) } });

async function requireIdentity(tx: Prisma.TransactionClient, materialId: number, batchNo: string) {
  const material = await tx.material.findUnique({ where: { id: materialId } });
  const batch = await tx.productBatch.findUnique({ where: { batchNo } });
  if (!material || material.status !== 'active' || material.isTemporary
    || !['raw_material','semi_finished'].includes(material.category) || !units.has(material.baseUnit)) {
    throw new Error('DENSITY_MATERIAL_INVALID:请选择已启用的质量/体积原料或半成品');
  }
  if (!batch || batch.materialId !== materialId || batch.unit !== material.baseUnit) {
    throw new Error('DENSITY_BATCH_IDENTITY_INVALID:批次必须属于所选物料，且单位必须一致');
  }
  return { material, batch };
}

export class MaterialDensityService {
  static list(materialId: number) {
    return prisma.materialDensityRevision.findMany({ where: { materialId }, orderBy: { id: 'desc' } });
  }
  static create(materialId: number, input: Input, userId: number) {
    const value = createDensityRevisionSchema.parse(input);
    if (Date.parse(value.measuredAt) > Date.now()) throw new Error('DENSITY_MEASUREMENT_IN_FUTURE:测定时间不能在未来');
    return withDbRetry(() => prisma.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "materials" SET "base_unit" = "base_unit" WHERE "id" = ${materialId}`;
      const { material, batch } = await requireIdentity(tx, materialId, value.batchNo);
      const row = await tx.materialDensityRevision.create({ data: {
        ...value, measuredAt: new Date(value.measuredAt), materialId, batchId: batch.id,
        baseUnit: material.baseUnit, createdBy: userId,
      } });
      await audit(tx, userId, 'CREATE_DENSITY_REVISION', row.id, { ...value, materialId, batchId: batch.id, baseUnit: material.baseUnit });
      return row;
    }, { isolationLevel: 'Serializable' }));
  }
  static transition(materialId: number, id: number, status: 'approved' | 'retired', input: z.infer<typeof reviewDensityRevisionSchema>, userId: number) {
    const { expectedUpdatedAt, reason } = reviewDensityRevisionSchema.parse(input);
    return withDbRetry(() => prisma.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "material_density_revisions" SET "status" = "status" WHERE "id" = ${id}`;
      const row = await tx.materialDensityRevision.findUnique({ where: { id } });
      if (!row || row.materialId !== materialId) throw new Error('DENSITY_NOT_FOUND');
      if (row.updatedAt.toISOString() !== expectedUpdatedAt) throw new Error('DENSITY_CONCURRENT_UPDATE:依据已更新，请刷新');
      if (status === 'approved') {
        if (row.createdBy === userId) throw new Error('DENSITY_INDEPENDENT_REVIEW_REQUIRED:编制人不能自批密度依据');
        if (row.status !== 'draft') throw new Error('DENSITY_STATE_INVALID');
        const { material, batch } = await requireIdentity(tx, materialId, row.batchNo);
        if (batch.id !== row.batchId || material.baseUnit !== row.baseUnit) throw new Error('DENSITY_BATCH_IDENTITY_CHANGED');
      } else if (!['draft','approved'].includes(row.status)) throw new Error('DENSITY_STATE_INVALID');
      const data = { status, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
        ...(status === 'approved' ? { approvedBy: userId, approvedAt: new Date(), reviewReason: reason }
          : { retiredBy: userId, retiredAt: new Date(), retireReason: reason }) };
      const changed = await tx.materialDensityRevision.updateMany({ where: { id, status: row.status, updatedAt: row.updatedAt }, data });
      if (changed.count !== 1) throw new Error('DENSITY_CONCURRENT_UPDATE');
      await audit(tx, userId, status === 'approved' ? 'APPROVE_DENSITY_REVISION' : 'RETIRE_DENSITY_REVISION', id,
        { beforeStatus: row.status, afterStatus: status, reason, batchId: row.batchId, sourceReference: row.sourceReference });
      return tx.materialDensityRevision.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' }));
  }
}
