import type { Prisma } from '@prisma/client';

type GovernedOrderItem = {
  materialId?: number | null;
  productName: string;
  specification?: string | null;
  unit: string;
  [key: string]: unknown;
};

const normalizeUnit = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

/**
 * Canonicalizes governed sales lines once inside the order transaction.
 * Lines without a materialId remain readable for staged legacy migration.
 */
export async function resolveOrderItemMaterialIdentities<T extends GovernedOrderItem>(
  tx: Pick<Prisma.TransactionClient, 'material'>,
  items: T[],
): Promise<T[]> {
  const ids = Array.from(new Set(items
    .map(item => Number(item.materialId || 0))
    .filter(id => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return items.map(item => ({ ...item, materialId: null }));

  const materials = await tx.material.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      code: true,
      nameZh: true,
      baseUnit: true,
      specification: true,
      status: true,
      isTemporary: true,
    },
  });
  if (materials.length !== ids.length) throw new Error('ORDER_ITEM_MATERIAL_NOT_FOUND');
  const byId = new Map(materials.map(material => [material.id, material]));

  return items.map((item, index) => {
    if (!item.materialId) return { ...item, materialId: null };
    const material = byId.get(Number(item.materialId));
    if (!material) throw new Error(`ORDER_ITEM_MATERIAL_NOT_FOUND:${index + 1}`);
    if (material.status !== 'active' || material.isTemporary) {
      throw new Error(`ORDER_ITEM_MATERIAL_NOT_RELEASED:${material.code}`);
    }
    if (normalizeUnit(item.unit) !== normalizeUnit(material.baseUnit)) {
      throw new Error(`ORDER_ITEM_MATERIAL_UNIT_MISMATCH:${material.code}:${item.unit}:${material.baseUnit}`);
    }
    return {
      ...item,
      materialId: material.id,
      productName: material.nameZh,
      specification: material.specification ?? item.specification ?? null,
      unit: material.baseUnit,
    };
  });
}
