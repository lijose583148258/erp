const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createPaymentEventReceiver } = require('./fixtures/payment-event-receiver.cjs');
test('cash verification and reversal for the same payment are separate durable effects, each replayed once', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-reversal-consumer-')), secret = crypto.randomBytes(32).toString('hex');
  let receiver;
  const send = async event => {
    const body = JSON.stringify(event), timestamp = new Date().toISOString();
    return fetch(`http://127.0.0.1:${receiver.port}/events`, { method:'POST',body,headers:{'x-ailaoda-event-id':event.id,'x-ailaoda-timestamp':timestamp,
      'x-ailaoda-signature':`sha256=${crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex')}`},signal:AbortSignal.timeout(5000) });
  };
  const verified = { id:crypto.randomUUID(),type:'payment.verified',data:{paymentId:7,orderId:9,amount:300} };
  const reversed = { id:crypto.randomUUID(),type:'payment.reversed',data:{paymentId:7,orderId:9,amount:-300,currency:'CNY',reversalId:crypto.randomUUID()} };
  try {
    receiver = await createPaymentEventReceiver({ secret,folder });
    for (const event of [verified,verified,reversed,reversed]) assert.equal((await send(event)).status,202);
    await receiver.close(); receiver = await createPaymentEventReceiver({ secret,folder });
    assert.equal((await send(reversed)).status,202);
    const rows = fs.readFileSync(path.join(folder,'receipts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,2); assert.equal(new Set(rows.map(r=>r.eventId)).size,2);
    assert.deepEqual(rows.map(r=>r.amount),[300,-300]); assert(rows.every(r=>r.effects===1));
    assert.equal((await send({...reversed,data:{...reversed.data,amount:-299}})).status,409);
    assert.equal((await send({...reversed,id:crypto.randomUUID(),data:{...reversed.data,amount:300}})).status,400);
  } finally { if(receiver) await receiver.close(); }
});
