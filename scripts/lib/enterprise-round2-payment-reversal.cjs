const { paymentReversalApiProbe } = require('./payment-reversal-api-probe.cjs');
const { verifyPaymentReversalApiProof } = require('./payment-reversal-api-proof.cjs');
const { paymentReversalBrowserProbe } = require('./payment-reversal-browser-probe.cjs');
const { verifyPaymentReversalBrowserProof } = require('./payment-reversal-browser-proof.cjs');

async function paymentReversalAcceptanceProbe(ctx, signal) {
  const evidence = { version: 'payment-reversal-acceptance/v1' };
  try {
    evidence.api = await paymentReversalApiProbe(ctx, signal);
    verifyPaymentReversalApiProof(evidence.api);
    evidence.browser = await paymentReversalBrowserProbe(ctx, signal);
    verifyPaymentReversalBrowserProof(evidence.browser, process.env.AUDIT_PRISMA_PROVIDER || 'sqlite');
    return evidence;
  } catch (error) {
    if (error.evidence?.version === 'payment-reversal-api/v1') evidence.api = error.evidence;
    else if (error.evidence?.version?.startsWith('payment-reversal-browser/')) evidence.browser = error.evidence;
    error.evidence = evidence;
    throw error;
  }
}
module.exports = { paymentReversalAcceptanceProbe };
