import { createMaterialSchema, updateMaterialSchema } from './material';

describe('material validators', () => {
  it('does not inject create defaults into a partial update', () => {
    expect(updateMaterialSchema.parse({ shelfLifeDays: 730 })).toEqual({ shelfLifeDays: 730 });
  });

  it('keeps defaults on create requests', () => {
    const parsed = createMaterialSchema.parse({
      code: 'RM-001',
      nameZh: '测试原料',
      baseUnit: 'kg',
    });
    expect(parsed).toMatchObject({
      category: 'raw_material',
      status: 'draft',
      isTemporary: true,
      aliases: [],
    });
  });
});
