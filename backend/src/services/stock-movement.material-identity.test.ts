import { resolveStockMaterialIdentity } from './stock-movement.material-identity';

const line = {
  materialId: 7,
  productName: 'Legacy resin name',
  unit: 'kg',
};

describe('stock material identity', () => {
  it('canonicalizes controlled stock writes from the released material master', async () => {
    const tx = {
      material: {
        findUnique: jest.fn(async () => ({
          id: 7,
          code: 'RM-0007',
          nameZh: '水性树脂 A',
          baseUnit: 'kg',
          status: 'active',
          isTemporary: false,
          shelfLifeDays: 180,
        })),
      },
    } as any;

    await expect(resolveStockMaterialIdentity(tx, line)).resolves.toEqual({
      materialId: 7,
      productName: '水性树脂 A',
      unit: 'kg',
      shelfLifeDays: 180,
    });
  });

  it.each([
    [{ status: 'draft', isTemporary: false }, 'STOCK_MATERIAL_NOT_RELEASED'],
    [{ status: 'active', isTemporary: true }, 'STOCK_MATERIAL_NOT_RELEASED'],
  ])('rejects an unreleased material (%o)', async (state, message) => {
    const tx = {
      material: {
        findUnique: jest.fn(async () => ({
          id: 7,
          code: 'RM-0007',
          nameZh: '水性树脂 A',
          baseUnit: 'kg',
          ...state,
          shelfLifeDays: 180,
        })),
      },
    } as any;

    await expect(resolveStockMaterialIdentity(tx, line)).rejects.toMatchObject({ message });
  });

  it('rejects a unit that does not match the material base unit', async () => {
    const tx = {
      material: {
        findUnique: jest.fn(async () => ({
          id: 7,
          code: 'RM-0007',
          nameZh: '水性树脂 A',
          baseUnit: 'kg',
          status: 'active',
          isTemporary: false,
          shelfLifeDays: 180,
        })),
      },
    } as any;

    await expect(resolveStockMaterialIdentity(tx, { ...line, unit: 'L' })).rejects.toMatchObject({
      message: 'STOCK_MATERIAL_UNIT_MISMATCH',
    });
  });
});
