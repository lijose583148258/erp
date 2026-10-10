import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPaymentRecordStatus } from './payment-record-status.ts';

test('order payment read-back retains verified, pending and immutable reversed states', () => {
  for (const state of ['pending', 'verified', 'reversed'] as const) assert.equal(mapPaymentRecordStatus(state), state);
  assert.equal(mapPaymentRecordStatus('REVERSED'), 'reversed');
});
test('unknown, missing and malformed payment states never become actionable pending', () => {
  for (const state of [undefined, null, '', 'failed', 'posted', ' verified ', 0, {}, []]) assert.equal(mapPaymentRecordStatus(state), 'unknown');
});
