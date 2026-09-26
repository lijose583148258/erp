const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, 'tests', 'fixtures', 'bom-grid');
fs.mkdirSync(fixtureDir, { recursive: true });

const draft = (index, total, mode = 'percentage') => ({
  materialName: `脱敏丙烯酸原料-${String(index).padStart(4, '0')}`,
  materialCode: `LAB-MAT-${String(index).padStart(4, '0')}`,
  ingredientRole: index % 7 === 0 ? 'additive' : index % 5 === 0 ? 'solvent' : 'main_resin',
  dosageMode: mode,
  percentage: mode === 'percentage' ? (100 / total).toFixed(6) : '',
  quantityPerUnit: mode === 'percentage' ? (1 / total).toFixed(6) : (index / 1000).toFixed(6),
  unit: 'kg',
  lossRate: index % 9 === 0 ? '0.500000' : '0',
  allowedVarianceRate: '0.200000',
  processStage: index % 3 === 0 ? '后添加' : index % 2 === 0 ? '分散' : '预混',
  substituteGroup: index % 20 === 0 ? `SUB-${Math.ceil(index / 20)}` : '',
  yieldContribution: '',
  notes: `脱敏测试行 ${index}`,
});
const emptyDraft = () => ({
  materialName: '',
  materialCode: '',
  ingredientRole: 'other',
  dosageMode: 'fixed',
  percentage: '',
  quantityPerUnit: '',
  unit: 'kg',
  lossRate: '0',
  allowedVarianceRate: '',
  processStage: '',
  substituteGroup: '',
  yieldContribution: '',
  notes: '',
});

const rows100 = Array.from({ length: 100 }, (_, index) => draft(index + 1, 100));
const rows1000 = Array.from({ length: 1000 }, (_, index) => draft(index + 1, 1000, 'fixed'));
const pasteRows = Array.from({ length: 300 }, (_, index) => {
  const row = draft(index + 2001, 300, 'fixed');
  return [
    row.materialCode,
    row.materialName,
    row.ingredientRole,
    row.dosageMode,
    row.percentage,
    row.quantityPerUnit,
    row.unit,
    row.lossRate,
  ];
});

const edited = rows100.map((row) => ({ ...row }));
edited[0].materialName = `${edited[0].materialName}（已编辑）`;
edited[0].dosageMode = 'fixed';
edited[0].percentage = '';
pasteRows.forEach((values, offset) => {
  const index = offset + 1;
  const target = edited[index] || emptyDraft();
  edited[index] = {
    ...target,
    materialCode: values[0],
    materialName: values[1],
    ingredientRole: values[2],
    dosageMode: values[3],
    percentage: values[4],
    quantityPerUnit: values[5],
    unit: values[6],
    lossRate: values[7],
  };
});
edited.splice(3, 1);
edited.splice(2, 0, {
  ...emptyDraft(),
  materialCode: 'LAB-INSERT-0001',
  materialName: '人工插入脱敏原料',
  ingredientRole: 'main_resin',
  quantityPerUnit: '9.999000',
  allowedVarianceRate: '0.200000',
  processStage: '人工确认',
  notes: '脱敏测试行 9999',
});

const multilingual = {
  cases: [
    { locale: 'zh-CN', input: '水性丙烯酸乳液（测试）', expected: '水性丙烯酸乳液（测试）' },
    { locale: 'vi-VN', input: 'Nhựa acrylic gốc nước thử nghiệm', expected: 'Nhựa acrylic gốc nước thử nghiệm' },
    { locale: 'mixed', input: '丙烯酸 nhựa acrylic A-01', expected: '丙烯酸 nhựa acrylic A-01' },
  ],
  compositionRules: {
    enterDuringCompositionMustNotCommit: true,
    compositionEndMustPreserveText: true,
  },
};

const writeJson = (name, value) => {
  fs.writeFileSync(path.join(fixtureDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

writeJson('acrylic-emulsion-100-rows.json', rows100);
writeJson('acrylic-emulsion-1000-rows.json', rows1000);
fs.writeFileSync(path.join(fixtureDir, 'paste-300-rows.tsv'), `${pasteRows.map((row) => row.join('\t')).join('\n')}\n`, 'utf8');
writeJson('chinese-vietnamese-input.json', multilingual);
writeJson('expected-save-payload.json', edited);

console.log(JSON.stringify({
  fixtureDir,
  rows100: rows100.length,
  rows1000: rows1000.length,
  pasteRows: pasteRows.length,
  expectedRows: edited.length,
}, null, 2));
