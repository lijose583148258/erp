import assert from 'node:assert/strict';
import { AilaoDaApiClient } from '../sdk/ailaoda-api-client';

let observedUrl = '';
let observedInit: RequestInit | undefined;

const client = new AilaoDaApiClient({
  baseUrl: 'https://erp.example',
  token: 'sdk-test-token',
  fetchImpl: async (input, init) => {
    observedUrl = String(input);
    observedInit = init;
    return new Response(JSON.stringify({
      success: true,
      data: { success: 1, failed: 0, errors: [], attempted: 1, imported: 1 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});

const response = await client.importOrders([
  {
    customerId: 41,
    paymentTerms: 30,
    items: [{ productName: 'SDK contract probe', quantity: 2, unitPrice: 25 }],
  },
], 'sdk-import-0001', {
  headers: {
    'X-Trace-Id': 'sdk-runtime-audit',
    'Idempotency-Key': 'caller-cannot-override-method-argument',
  },
});

const headers = observedInit?.headers as Record<string, string>;
assert.equal(observedUrl, 'https://erp.example/api/v1/orders/import');
assert.equal(observedInit?.method, 'POST');
assert.equal(headers.Authorization, 'Bearer sdk-test-token');
assert.equal(headers['Idempotency-Key'], 'sdk-import-0001');
assert.equal(headers['X-Trace-Id'], 'sdk-runtime-audit');
assert.deepEqual(JSON.parse(String(observedInit?.body)), {
  orders: [{
    customerId: 41,
    paymentTerms: 30,
    items: [{ productName: 'SDK contract probe', quantity: 2, unitPrice: 25 }],
  }],
});
assert.deepEqual(response.data, { success: 1, failed: 0, errors: [], attempted: 1, imported: 1 });

console.log('API SDK Runtime Audit: PASS');
console.log('- Bulk order import emits the versioned URL, Bearer token, required idempotency key, and typed body.');
