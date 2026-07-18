const assert = require('assert');
const { uniqueAddresses, verifyAddressBinding } = require('./verify-public-dns-ingress.cjs');

assert.deepEqual(uniqueAddresses([' 203.0.113.10 ', '203.0.113.10', '2001:DB8::1']), [
  '203.0.113.10', '2001:db8::1',
]);
assert.equal(verifyAddressBinding(['203.0.113.10'], ['203.0.113.10']), true);
assert.equal(verifyAddressBinding(['203.0.113.10', '2001:db8::1'], ['2001:db8::1']), true);
assert.equal(verifyAddressBinding(['203.0.113.10'], ['203.0.113.11']), false);
assert.equal(verifyAddressBinding([], ['203.0.113.10']), false);
assert.equal(verifyAddressBinding(['203.0.113.10'], []), false);

console.log('Public DNS to Ingress contract: PASSED');
