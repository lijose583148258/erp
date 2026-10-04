const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./cloud-postgres-promotion-audit-v1.cjs'), 'utf8');

test('read recovery changes trigger cloud replay and exercise write non-retry on CI', () => {
  const workflow = fs.readFileSync(require('node:path').join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  for (const file of ['backend/src/utils/readOnlyDbRetry.ts', 'backend/src/controllers/customer/customer-query.controller.ts',
    'backend/src/controllers/customer/customer-read-recovery.test.ts']) assert(workflow.includes(`- '${file}'`));
  assert.match(workflow, /--runTestsByPath backend\/src\/controllers\/customer\/customer-read-recovery\.test\.ts backend\/src\/utils\/dbRetry\.test\.ts/);
});

test('promotion audit verdict and name cannot be overwritten by detail fields', () => {
  const checkSource = source.slice(source.indexOf('const check ='), source.indexOf('const compose ='));
  const report = { checks: [] };
  const check = vm.runInNewContext(`${checkSource}; check;`, { report });
  check('write', true, { name: 'wrong', status: 201, httpStatus: 201 });
  assert.equal(report.checks[0].name, 'write'); assert.equal(report.checks[0].status, 'passed');
  assert.equal(report.checks[0].httpStatus, 201);
  assert.throws(() => check('read', false, { status: 'passed', httpStatus: 500 }), /Check failed: read/);
  assert.equal(report.checks[1].status, 'failed'); assert.equal(report.checks[1].httpStatus, 500);
});

test('promotion keeps HTTP status separate and never masks a failed business request by replay', () => {
  assert.match(source, /httpStatus: create\.status/);
  assert.match(source, /httpStatus: read\.status/);
  assert.doesNotMatch(source, /\{\s*status: (?:create|read)\.status/);
  const start = source.indexOf('  const create =');
  const end = source.indexOf("  compose(\n", start) >= 0 ? source.indexOf("  compose(\n", start) : source.indexOf("  compose(\r\n", start);
  const requests = source.slice(start, end);
  assert.equal((requests.match(/await fetch\(/g) || []).length, 2);
  assert.equal((requests.match(/method: 'POST'/g) || []).length, 1);
  assert.doesNotMatch(requests, /waitFor|retry|while\s*\(|for\s*\(/i);
});
