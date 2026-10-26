import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BomItemDraft } from '../pages/production/productionBomLineModel';
import {
  GovernedBomGridAdapter,
  toBomGridRow,
  type BomGridRow,
} from '../pages/production/bom-grid-lab/bomGridContract';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'tests', 'fixtures', 'bom-grid');
const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')) as T;
const fixture100 = readJson<BomItemDraft[]>('acrylic-emulsion-100-rows.json');
const fixture1000 = readJson<BomItemDraft[]>('acrylic-emulsion-1000-rows.json');
const expected = readJson<BomItemDraft[]>('expected-save-payload.json');
const paste = fs.readFileSync(path.join(fixtureDir, 'paste-300-rows.tsv'), 'utf8')
  .trimEnd()
  .split(/\r?\n/)
  .map((line) => line.split('\t'));

let observed: BomGridRow[] = [];
const adapter = new GovernedBomGridAdapter(
  fixture100.map((row, index) => toBomGridRow(row, index + 1, `fixture-${String(index + 1).padStart(4, '0')}`)),
  (rows) => { observed = rows; },
);

const initial = adapter.getRows();
initial[0] = {
  ...initial[0],
  materialName: `${initial[0].materialName}（已编辑）`,
  dosageMode: 'fixed',
  percentage: '',
  dirtyFields: ['materialName', 'dosageMode', 'percentage'],
};
adapter.replaceRows(initial);
const pasteStart = adapter.getRows()[1];
adapter.setSelection({
  startRowKey: pasteStart.rowKey,
  endRowKey: pasteStart.rowKey,
  startColumnKey: 'materialCode',
  endColumnKey: 'materialCode',
});
const pasteResult = adapter.paste(paste);
assert.equal(pasteResult.updatedCellCount, 2400);
assert.equal(pasteResult.insertedRowCount, 201);
assert.equal(pasteResult.rejectedCellCount, 0);
adapter.deleteRows(['fixture-0004']);
adapter.insertRows(2, [toBomGridRow({
  materialName: '人工插入脱敏原料',
  materialCode: 'LAB-INSERT-0001',
  ingredientRole: 'main_resin',
  dosageMode: 'fixed',
  percentage: '',
  quantityPerUnit: '9.999000',
  unit: 'kg',
  lossRate: '0',
  allowedVarianceRate: '0.200000',
  processStage: '人工确认',
  substituteGroup: '',
  yieldContribution: '',
  notes: '脱敏测试行 9999',
}, 3, 'golden-insert-0001')]);
assert.deepEqual(adapter.exportDraft(), expected, 'golden operation payload must match expected-save-payload.json');

const validation = adapter.validate();
assert.equal(validation.valid, true);
assert.equal(validation.blockingCount, 0);
assert.equal(adapter.getRows().length, 301);
assert.equal(observed.length, 301);

const oversize = adapter.paste(Array.from({ length: 301 }, () => ['blocked']));
assert.equal(oversize.updatedCellCount, 0);
assert.equal(oversize.rejectedCellCount, 301);

const performanceAdapter = new GovernedBomGridAdapter(
  fixture1000.map((row, index) => toBomGridRow(row, index + 1, `perf-${index + 1}`)),
  () => undefined,
);
const startedAt = performance.now();
const performanceValidation = performanceAdapter.validate();
const validationMs = performance.now() - startedAt;
assert.equal(performanceValidation.valid, true);
assert.ok(validationMs < 1000, `1000-row shared validation exceeded 1000ms: ${validationMs.toFixed(2)}ms`);

const historyAdapter = new GovernedBomGridAdapter(
  [toBomGridRow(fixture100[0], 1, 'history-row')],
  () => undefined,
);
for (let index = 1; index <= 101; index += 1) {
  const next = historyAdapter.getRows();
  next[0] = { ...next[0], notes: `history-${index}` };
  historyAdapter.replaceRows(next);
}
for (let index = 0; index < 100; index += 1) historyAdapter.undo();
assert.equal(historyAdapter.getRows()[0].notes, 'history-1', 'history must retain exactly the latest 100 mutations');
historyAdapter.undo();
assert.equal(historyAdapter.getRows()[0].notes, 'history-1', '101st older state must be evicted');
historyAdapter.redo();
assert.equal(historyAdapter.getRows()[0].notes, 'history-2');

console.log(JSON.stringify({
  contract: 'bom-grid-adapter-contract-v1',
  passed: true,
  goldenRows: expected.length,
  pasteCells: pasteResult.updatedCellCount,
  maxPasteRows: 300,
  historyDepth: 100,
  validation1000RowsMs: Number(validationMs.toFixed(3)),
}, null, 2));
