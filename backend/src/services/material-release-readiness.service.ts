import type { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';

export type MaterialReadinessReason =
  | 'missing_material_id'
  | 'material_not_found'
  | 'material_inactive'
  | 'material_temporary'
  | 'unit_mismatch';

export type MaterialReadinessLine = {
  lineKey: string | number;
  rowNumber?: number;
  materialId?: number | null;
  displayName: string;
  unit?: string | null;
};

export type MaterialReadinessIssue = {
  lineKey: string;
  rowNumber: number;
  materialId: number | null;
  materialCode: string | null;
  displayName: string;
  reason: MaterialReadinessReason;
  requestedUnit: string | null;
  baseUnit: string | null;
};

type MaterialReadinessClient = Pick<Prisma.TransactionClient, 'material'>;

const normalizeUnit = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

export const MATERIAL_RELEASE_REQUIRED = 'MATERIAL_RELEASE_REQUIRED';

export function isMaterialReleaseReadinessError(error: unknown): error is AppError {
  return error instanceof AppError && error.message === MATERIAL_RELEASE_REQUIRED;
}

/**
 * Single release boundary for every document that can create financial,
 * inventory, shipment, or production truth. Drafts may remain incomplete;
 * callers must invoke this function in the same transaction that performs the
 * controlled status change or posting.
 */
export async function assertMaterialReleaseReadiness(
  tx: MaterialReadinessClient,
  input: {
    entityType: 'sales_order' | 'purchase_order' | 'shipment' | 'stock_entry' | 'product_batch';
    entityId?: string | number | null;
    action: string;
    lines: MaterialReadinessLine[];
    /** Existing posted identity may remain movable/reversible after archival. */
    allowInactive?: boolean;
  },
) {
  const materialIds = Array.from(new Set(input.lines
    .map(line => Number(line.materialId || 0))
    .filter(id => Number.isInteger(id) && id > 0)));
  const materials = materialIds.length > 0
    ? await tx.material.findMany({
      where: { id: { in: materialIds } },
      select: {
        id: true,
        code: true,
        nameZh: true,
        baseUnit: true,
        status: true,
        isTemporary: true,
      },
    })
    : [];
  const byId = new Map(materials.map(material => [material.id, material]));

  const issues: MaterialReadinessIssue[] = [];
  input.lines.forEach((line, index) => {
    const materialId = Number(line.materialId || 0);
    const rowNumber = line.rowNumber || index + 1;
    const common = {
      lineKey: String(line.lineKey),
      rowNumber,
      materialId: Number.isInteger(materialId) && materialId > 0 ? materialId : null,
      displayName: String(line.displayName || '').trim() || `第 ${rowNumber} 行`,
      requestedUnit: line.unit ? String(line.unit).trim() : null,
    };

    if (!common.materialId) {
      issues.push({
        ...common,
        materialCode: null,
        reason: 'missing_material_id',
        baseUnit: null,
      });
      return;
    }

    const material = byId.get(common.materialId);
    if (!material) {
      issues.push({
        ...common,
        materialCode: null,
        reason: 'material_not_found',
        baseUnit: null,
      });
      return;
    }
    if (material.status !== 'active' && !input.allowInactive) {
      issues.push({
        ...common,
        materialCode: material.code,
        reason: 'material_inactive',
        baseUnit: material.baseUnit,
      });
      return;
    }
    if (material.isTemporary) {
      issues.push({
        ...common,
        materialCode: material.code,
        reason: 'material_temporary',
        baseUnit: material.baseUnit,
      });
      return;
    }
    if (common.requestedUnit && normalizeUnit(common.requestedUnit) !== normalizeUnit(material.baseUnit)) {
      issues.push({
        ...common,
        materialCode: material.code,
        reason: 'unit_mismatch',
        baseUnit: material.baseUnit,
      });
    }
  });

  if (issues.length > 0) {
    throw new AppError(MATERIAL_RELEASE_REQUIRED, 409, ErrorCode.CONFLICT, {
      contract: 'material-release-readiness/v1',
      entityType: input.entityType,
      entityId: input.entityId == null ? null : String(input.entityId),
      action: input.action,
      issueCount: issues.length,
      issues,
      repairRoute: '/materials',
      retryableAfterRepair: true,
    });
  }
}
