// Reuse the partial-delivery fixture and its lifecycle; do not duplicate setup.
process.env.ROUND2_QUANTITY_CANCELLATION = 'true';
require('./sales-partial-fulfillment-audit-v1.cjs');
