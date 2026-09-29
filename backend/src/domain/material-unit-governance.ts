// Count every persisted material reference, including cancelled/zero-balance history.
export const materialUnitReferenceSelect = {
  bomItems: true, productionBoms: true, productionWorkOrders: true,
  salesOrderItems: true, purchaseOrders: true, shipments: true,
  productBatches: true, stockBalances: true, stockMovements: true,
  genealogyInputs: true, genealogyOutputs: true, barterAgreementItems: true, barterItems: true,
} as const;

type MaterialUnitState = { status: string; _count?: Record<string, number> };
export function canEditMaterialBaseUnit(material: MaterialUnitState): boolean {
  return material.status === 'draft' && Object.keys(materialUnitReferenceSelect)
    .every(key => material._count?.[key] === 0);
}
export function withMaterialUnitGovernance<T extends MaterialUnitState>(material: T) {
  return { ...material, baseUnitEditable: canEditMaterialBaseUnit(material) };
}
export function assertMaterialUnitChange(material: MaterialUnitState & { baseUnit: string }, nextUnit: string | undefined, expectedUpdatedAt?: string) {
  if (nextUnit === undefined || nextUnit.trim() === material.baseUnit.trim()) return;
  if (!canEditMaterialBaseUnit(material)) throw new Error('MATERIAL_BASE_UNIT_FROZEN');
  if (!expectedUpdatedAt) throw new Error('MATERIAL_UNIT_VERSION_REQUIRED');
}
