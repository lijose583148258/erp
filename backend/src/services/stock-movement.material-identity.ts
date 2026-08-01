import { AppError, ErrorCode } from '../middleware/errorHandler';
import { normalizeId, normalizeText } from './stock-movement.helpers';
import type { StockMovementLineInput, TransactionClient } from './stock-movement.types';

const normalizeUnit = (value: unknown) => normalizeText(value).toLocaleLowerCase();

/**
 * Resolves the canonical identity once, before any inventory row is touched.
 * Legacy callers may omit materialId; controlled callers must use an active,
 * released material and the material's base unit.
 */
export const resolveStockMaterialIdentity = async (
  tx: TransactionClient,
  line: Pick<StockMovementLineInput, 'materialId' | 'productName' | 'unit'>,
) => {
  if (line.materialId === undefined || line.materialId === null || line.materialId === 0) {
    return {
      materialId: null,
      productName: normalizeText(line.productName),
      unit: normalizeText(line.unit || 'kg') || 'kg',
      shelfLifeDays: null,
    };
  }

  const materialId = normalizeId(line.materialId, 'materialId');
  const material = await tx.material.findUnique({
    where: { id: materialId },
    select: {
      id: true,
      code: true,
      nameZh: true,
      baseUnit: true,
      status: true,
      isTemporary: true,
      shelfLifeDays: true,
    },
  });

  if (!material) {
    throw new AppError('STOCK_MATERIAL_NOT_FOUND', 404, ErrorCode.NOT_FOUND, { materialId });
  }
  if (material.status !== 'active' || material.isTemporary) {
    throw new AppError('STOCK_MATERIAL_NOT_RELEASED', 409, ErrorCode.CONFLICT, {
      materialId,
      materialCode: material.code,
      status: material.status,
      isTemporary: material.isTemporary,
    });
  }

  const requestedUnit = normalizeText(line.unit || material.baseUnit) || material.baseUnit;
  if (normalizeUnit(requestedUnit) !== normalizeUnit(material.baseUnit)) {
    throw new AppError('STOCK_MATERIAL_UNIT_MISMATCH', 409, ErrorCode.CONFLICT, {
      materialId,
      materialCode: material.code,
      requestedUnit,
      baseUnit: material.baseUnit,
    });
  }

  return {
    materialId: material.id,
    productName: material.nameZh,
    unit: material.baseUnit,
    shelfLifeDays: material.shelfLifeDays,
  };
};
