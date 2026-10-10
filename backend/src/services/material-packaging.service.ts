import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import { packagingPercentageQuantityV1 } from '../domain/production-mass-basis';
import { PACKAGING_PERCENTAGE_V1, type PackagingBasis, assertPackagingBasis } from '../domain/production-packaging-basis';
import { createPackagingRevisionSchema } from '../validators/material-packaging';
import type { z } from 'zod';

export type PackagingRevisionInput = z.infer<typeof createPackagingRevisionSchema>;
const audit = (tx: Prisma.TransactionClient, userId: number, action: string, id: number, details: unknown) => tx.auditLog.create({ data: {
  userId, action, resource: 'material_packaging', resourceId: id, details: JSON.stringify(details),
} });
export async function lockPackagingRevision(tx: Prisma.TransactionClient, id: number) {
  await tx.$executeRaw`UPDATE "material_packaging_revisions" SET "status" = "status" WHERE "id" = ${id}`;
}
const requireMaterial = async (tx: Prisma.TransactionClient, materialId: number, packageUnit: string) => {
  const m = await tx.material.findUnique({ where: { id: materialId } });
  if (!m || m.status !== 'active' || m.isTemporary || !['finished_good','semi_finished'].includes(m.category)
    || m.baseUnit !== packageUnit) throw new Error('PACKAGING_MATERIAL_INVALID:请选择已启用、主单位匹配的包装成品或半成品');
  return m;
};
export async function approvedPackagingBasis(tx: Prisma.TransactionClient, id: number, materialId: number, outputUnit: string): Promise<PackagingBasis> {
  await lockPackagingRevision(tx, id);
  const r = await tx.materialPackagingRevision.findUnique({ where: { id } });
  if (!r || r.status !== 'approved' || !r.approvedBy || !r.approvedAt) throw new Error('BOM_UNIT_PACKAGING_NOT_APPROVED:包装规格未获独立批准或已停用');
  const basis: PackagingBasis = { rule: PACKAGING_PERCENTAGE_V1, revisionId: r.id, materialId: r.materialId, specCode: r.specCode,
    version: r.version, packageUnit: r.packageUnit, netMass: r.netMass, massUnit: r.massUnit, sourceReference: r.sourceReference,
    approvedBy: r.approvedBy, approvedAt: r.approvedAt.toISOString() };
  assertPackagingBasis(basis, materialId, outputUnit);
  return basis;
}
export class MaterialPackagingService {
  static list(materialId: number) { return prisma.materialPackagingRevision.findMany({ where: { materialId }, orderBy: { id: 'desc' } }); }
  static create(materialId: number, input: PackagingRevisionInput, userId: number) {
    const value = createPackagingRevisionSchema.parse(input);
    packagingPercentageQuantityV1(100, value.massUnit, value.netMass, value.massUnit);
    return withDbRetry(() => prisma.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "materials" SET "base_unit" = "base_unit" WHERE "id" = ${materialId}`;
      await requireMaterial(tx, materialId, value.packageUnit);
      const r = await tx.materialPackagingRevision.create({ data: { ...value, materialId, createdBy: userId } });
      await audit(tx, userId, 'CREATE_PACKAGING_REVISION', r.id, { ...value, materialId });
      return r;
    }, { isolationLevel: 'Serializable' }));
  }
  static transition(materialId: number, id: number, status: 'approved' | 'retired', expectedUpdatedAt: string, reason: string, userId: number) {
    return withDbRetry(() => prisma.$transaction(async tx => {
      await lockPackagingRevision(tx, id);
      const r = await tx.materialPackagingRevision.findUnique({ where: { id } });
      if (!r || r.materialId !== materialId) throw new Error('PACKAGING_NOT_FOUND');
      if (r.updatedAt.toISOString() !== expectedUpdatedAt) throw new Error('PACKAGING_CONCURRENT_UPDATE:规格已更新，请刷新');
      if (status === 'approved' && r.createdBy === userId) throw new Error('PACKAGING_INDEPENDENT_REVIEW_REQUIRED:编制人不能批准自己的包装净量');
      if ((status === 'approved' && r.status !== 'draft') || (status === 'retired' && !['draft','approved'].includes(r.status))) throw new Error('PACKAGING_STATE_INVALID');
      if (status === 'approved') await requireMaterial(tx, materialId, r.packageUnit);
      const data = { status, updatedAt: new Date(Math.max(Date.now(), r.updatedAt.getTime() + 1)),
        ...(status === 'approved' ? { approvedBy: userId, approvedAt: new Date(), reviewReason: reason } : { retiredBy: userId, retiredAt: new Date(), retireReason: reason }) };
      const changed = await tx.materialPackagingRevision.updateMany({ where: { id, status: r.status, updatedAt: r.updatedAt }, data });
      if (changed.count !== 1) throw new Error('PACKAGING_CONCURRENT_UPDATE');
      await audit(tx, userId, status === 'approved' ? 'APPROVE_PACKAGING_REVISION' : 'RETIRE_PACKAGING_REVISION', id, { beforeStatus: r.status, afterStatus: status, reason });
      return tx.materialPackagingRevision.findUniqueOrThrow({ where: { id } });
    }, { isolationLevel: 'Serializable' }));
  }
}
