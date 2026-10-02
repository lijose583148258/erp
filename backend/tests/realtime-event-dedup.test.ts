import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

const load = () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../services/realtime-event-dedup.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context: { exports: any } = { exports: {} };
  vm.runInNewContext(js, context);
  return context.exports.createRealtimeEventDeduplicator(2);
};
test('stable event ids are suppressed but legacy no-id frames are accepted', () => {
  const dedup = load();
  expect(dedup.accept('one')).toBe(true); expect(dedup.accept('one')).toBe(false);
  expect(dedup.accept(undefined)).toBe(true); expect(dedup.accept(undefined)).toBe(true);
});
test('notification history is bounded and can be cleared on logout', () => {
  const dedup = load();
  dedup.accept('one'); dedup.accept('two'); dedup.accept('three');
  expect(dedup.accept('one')).toBe(true);
  dedup.clear(); expect(dedup.accept('one')).toBe(true);
});
