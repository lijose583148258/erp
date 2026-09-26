import {
  assertMaterialReleaseReadiness,
  MATERIAL_RELEASE_REQUIRED,
} from './material-release-readiness.service';

describe('assertMaterialReleaseReadiness', () => {
  it('allows only active, non-temporary materials in the base unit', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 7,
      code: 'RM-0007',
      nameZh: '丙烯酸',
      baseUnit: 'kg',
      status: 'active',
      isTemporary: false,
    }]);

    await expect(assertMaterialReleaseReadiness(
      { material: { findMany } } as never,
      {
        entityType: 'sales_order',
        entityId: 42,
        action: 'confirm',
        lines: [{ lineKey: 3, materialId: 7, displayName: '旧名称', unit: 'KG' }],
      },
    )).resolves.toBeUndefined();
  });

  it('returns stable row-level repair details instead of a generic failure', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 8,
      code: 'TMP-0008',
      nameZh: '临时树脂',
      baseUnit: 'kg',
      status: 'active',
      isTemporary: true,
    }]);

    await expect(assertMaterialReleaseReadiness(
      { material: { findMany } } as never,
      {
        entityType: 'sales_order',
        entityId: 42,
        action: 'confirm',
        lines: [
          { lineKey: 11, materialId: null, displayName: '乳液 A', unit: 'kg' },
          { lineKey: 12, materialId: 8, displayName: '临时树脂', unit: 'kg' },
        ],
      },
    )).rejects.toMatchObject({
      message: MATERIAL_RELEASE_REQUIRED,
      statusCode: 409,
      details: {
        contract: 'material-release-readiness/v1',
        issueCount: 2,
        repairRoute: '/materials',
        issues: [
          { lineKey: '11', rowNumber: 1, reason: 'missing_material_id' },
          { lineKey: '12', rowNumber: 2, reason: 'material_temporary', materialCode: 'TMP-0008' },
        ],
      },
    });
  });

  it('allows an archived but canonical identity only for an explicit historical movement policy', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 7,
      code: 'RM-0007',
      nameZh: '停用原料',
      baseUnit: 'kg',
      status: 'inactive',
      isTemporary: false,
    }]);
    const input = {
      entityType: 'stock_entry' as const,
      entityId: 'REV-1',
      action: 'reverse',
      lines: [{ lineKey: 1, materialId: 7, displayName: '停用原料', unit: 'kg' }],
    };

    await expect(assertMaterialReleaseReadiness(
      { material: { findMany } } as never,
      input,
    )).rejects.toMatchObject({ message: MATERIAL_RELEASE_REQUIRED });
    await expect(assertMaterialReleaseReadiness(
      { material: { findMany } } as never,
      { ...input, allowInactive: true },
    )).resolves.toBeUndefined();
  });
});
