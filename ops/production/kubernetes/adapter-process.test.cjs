const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execAdapterFileSync, resolveAdapterInvocation } = require('./adapter-process.cjs');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-adapter-process-'));
try {
  const adapter = path.join(tempRoot, 'non-executable-adapter.cjs');
  fs.writeFileSync(adapter, "process.stdout.write(JSON.stringify({ operation: process.argv[2], value: process.argv[3] }));\n", {
    encoding: 'utf8',
    mode: 0o644,
  });

  const invocation = resolveAdapterInvocation(adapter, 'probe', ['value with spaces']);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [adapter, 'probe', 'value with spaces']);

  const output = execAdapterFileSync(adapter, 'probe', ['value with spaces'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.deepEqual(JSON.parse(output), { operation: 'probe', value: 'value with spaces' });

  const native = resolveAdapterInvocation('/opt/ha-adapters/postgres', 'discover');
  assert.deepEqual(native, { command: '/opt/ha-adapters/postgres', args: ['discover'] });
  assert.throws(() => resolveAdapterInvocation('', 'discover'), /Adapter path is required/);
  assert.throws(() => resolveAdapterInvocation(adapter, ''), /Adapter operation is required/);

  console.log('Adapter process contract tests: PASSED');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
