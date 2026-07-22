const path = require('path');
const { execFileSync } = require('child_process');

const nodeScriptExtensions = new Set(['.cjs', '.mjs', '.js']);

const resolveAdapterInvocation = (adapter, operation, operationArgs = []) => {
  const adapterPath = String(adapter || '').trim();
  const adapterOperation = String(operation || '').trim();
  if (!adapterPath) throw new Error('Adapter path is required.');
  if (!adapterOperation) throw new Error('Adapter operation is required.');

  const args = [adapterOperation, ...operationArgs.map(String)];
  if (nodeScriptExtensions.has(path.extname(adapterPath).toLowerCase())) {
    return { command: process.execPath, args: [adapterPath, ...args] };
  }
  return { command: adapterPath, args };
};

const execAdapterFileSync = (adapter, operation, operationArgs = [], options = {}) => {
  const invocation = resolveAdapterInvocation(adapter, operation, operationArgs);
  return execFileSync(invocation.command, invocation.args, options);
};

module.exports = { execAdapterFileSync, resolveAdapterInvocation };
