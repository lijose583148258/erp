const { paymentReversalApiProbe } = require('./payment-reversal-api-probe.cjs');
const { verifyPaymentReversalApiProof } = require('./payment-reversal-api-proof.cjs');
const { paymentReversalBrowserProbe } = require('./payment-reversal-browser-probe.cjs');
const { verifyPaymentReversalBrowserProof, verifyPaymentReversalWorkforceProof } = require('./payment-reversal-browser-proof.cjs');
const { paymentWorkforceActors } = require('./enterprise-round2-payment-actor-proof.cjs');

async function paymentReversalAcceptanceProbe(ctx, signal) {
  const evidence = { version: 'payment-reversal-acceptance/v1' };
  try {
    evidence.api = await paymentReversalApiProbe(ctx, signal);
    verifyPaymentReversalApiProof(evidence.api);
    evidence.browser = await paymentReversalBrowserProbe(ctx, signal);
    verifyPaymentReversalBrowserProof(evidence.browser, process.env.AUDIT_PRISMA_PROVIDER || 'sqlite');
    const people=paymentWorkforceActors(ctx);
    if(people) evidence.workforceProof=verifyPaymentReversalWorkforceProof(evidence.browser.workforce,{people,payables:ctx.workforce.byJob.payables[0],bootstrapId:ctx.actors.admin.id});
    return evidence;
  } catch (error) {
    if (error.evidence?.version === 'payment-reversal-api/v1') evidence.api = error.evidence;
    else if (error.evidence?.version?.startsWith('payment-reversal-browser/')) evidence.browser = error.evidence;
    error.evidence = evidence;
    throw error;
  }
}
module.exports = { paymentReversalAcceptanceProbe };
