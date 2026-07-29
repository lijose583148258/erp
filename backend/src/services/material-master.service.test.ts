import {
  buildMaterialWhere,
  normalizeMaterialAlias,
  normalizeMaterialCode,
} from './material-master.service';

describe('material master foundation', () => {
  it('normalizes multilingual aliases without destroying Unicode', () => {
    expect(normalizeMaterialAlias('  Acrylic   Emulsion  ')).toBe('acrylic emulsion');
    expect(normalizeMaterialAlias('ＡＢＣ 乳液')).toBe('abc 乳液');
    expect(normalizeMaterialAlias('Nhựa   acrylic')).toBe('nhựa acrylic');
  });

  it('normalizes canonical codes predictably', () => {
    expect(normalizeMaterialCode(' rm-acr/001 ')).toBe('RM-ACR/001');
  });

  it('preserves an explicit status filter instead of replacing it with the retired guard', () => {
    expect(buildMaterialWhere({
      status: 'active',
      limit: 30,
      offset: 0,
    }).status).toBe('active');
  });

  it('excludes retired materials by default and permits an explicit retired query', () => {
    expect(buildMaterialWhere({ limit: 30, offset: 0 }).status).toEqual({ not: 'retired' });
    expect(buildMaterialWhere({
      status: 'retired',
      limit: 30,
      offset: 0,
    }).status).toBe('retired');
  });

  it('searches exact identifiers and normalized aliases in one relational query', () => {
    const where = buildMaterialWhere({
      q: ' Acrylic   Emulsion ',
      limit: 12,
      offset: 0,
    });
    expect(where.OR).toEqual(expect.arrayContaining([
      { code: { contains: 'ACRYLIC   EMULSION' } },
      { aliases: { some: { normalizedAlias: { contains: 'acrylic emulsion' } } } },
    ]));
  });
});
