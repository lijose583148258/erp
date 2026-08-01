import { resolveFinishedGoodsMaterial } from './production-mutation.service';

describe('production output material identity', () => {
  it('requires a released finished-good identity for a controlled BOM', async () => {
    await expect(resolveFinishedGoodsMaterial({} as any, null, true)).rejects.toThrow('BOM_OUTPUT_MATERIAL_MASTER_REQUIRED');
  });

  it('rejects raw material as a BOM output', async () => {
    const tx = { material: { findUnique: jest.fn().mockResolvedValue({
      id: 1, code: 'RM-1', nameZh: '原料', category: 'raw_material', baseUnit: 'kg', shelfLifeDays: 365, status: 'active', isTemporary: false,
    }) } } as any;
    await expect(resolveFinishedGoodsMaterial(tx, 1, true)).rejects.toThrow('BOM_OUTPUT_MATERIAL_CATEGORY_INVALID');
  });

  it('returns the canonical name, unit and shelf-life policy', async () => {
    const material = { id: 2, code: 'FG-2', nameZh: '成品乳液', category: 'finished_good', baseUnit: 'kg', shelfLifeDays: 180, status: 'active', isTemporary: false };
    const tx = { material: { findUnique: jest.fn().mockResolvedValue(material) } } as any;
    await expect(resolveFinishedGoodsMaterial(tx, 2, true)).resolves.toEqual(material);
  });
});
