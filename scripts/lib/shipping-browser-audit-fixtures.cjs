function createShippingAuditData(runId) {
  return {
    ocrTrackingNo: `OCR-${runId}`,
    linkedTrackingNo: `LINK-${runId}`,
    ocrProduct: `SHIP-OCR-${runId}`,
    linkedProduct: `SHIP-LINK-${runId}`,
    customerName: `SHIP-BROWSER-CUS-${runId}`,
    batchNo: `SHIP-BROWSER-BATCH-${runId}`,
    stockQuantity: 24,
    carrier: `AUDIT-CARRIER-${runId.slice(-4)}`,
    quantity: 12,
  };
}

const REQUIRED_ROUTE_COPY = ['\u53d1\u8d27', 'OCR', '\u8bc6\u522b\u9884\u89c8'];

const MOJIBAKE_MARKERS = [
  'undefined',
  '\ufffd',
  '\u951f\u91d1\u62f7',
];

const TIMEOUTS = {
  login: 15000,
  route: 20000,
  save: 25000,
  api: 15000,
  readBack: 15000,
};

module.exports = {
  MOJIBAKE_MARKERS,
  REQUIRED_ROUTE_COPY,
  TIMEOUTS,
  createShippingAuditData,
};
