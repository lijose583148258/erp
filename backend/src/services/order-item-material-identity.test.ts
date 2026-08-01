import { resolveOrderItemMaterialIdentities } from './order-item-material-identity';

describe('order item material identity', () => {
  const line = { materialId: 7, productName: '客户旧叫法', specification: null, unit: 'kg', quantity: 2 };

  it('canonicalizes name, specification and unit from an active material', async () => {
    const tx = { material: { findMany: jest.fn().mockResolvedValue([{
      id: 7, code: 'FG-0007', nameZh: '水性丙烯酸乳液 A', baseUnit: 'kg', specification: '200kg/桶', status: 'active', isTemporary: false,
    }]) } } as any;
    await expect(resolveOrderItemMaterialIdentities(tx, [line])).resolves.toEqual([expect.objectContaining({
      materialId: 7,
      productName: '水性丙烯酸乳液 A',
      specification: '200kg/桶',
      unit: 'kg',
    })]);
  });

  it('rejects a governed line whose unit differs from the master', async () => {
    const tx = { material: { findMany: jest.fn().mockResolvedValue([{
      id: 7, code: 'FG-0007', nameZh: '水性丙烯酸乳液 A', baseUnit: '吨', specification: null, status: 'active', isTemporary: false,
    }]) } } as any;
    await expect(resolveOrderItemMaterialIdentities(tx, [line])).rejects.toThrow('ORDER_ITEM_MATERIAL_UNIT_MISMATCH');
  });

  it('keeps legacy text lines unlinked without querying material master', async () => {
    const findMany = jest.fn();
    const result = await resolveOrderItemMaterialIdentities({ material: { findMany } } as any, [{ ...line, materialId: null }]);
    expect(result[0]).toMatchObject({ materialId: null, productName: '客户旧叫法' });
    expect(findMany).not.toHaveBeenCalled();
  });
});
