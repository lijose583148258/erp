const fs = require('fs');
const path = require('path');

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

function createOcrText(customerName, data) {
  return [
    `\u5ba2\u6237\u540d\u79f0: ${customerName}`,
    `\u4ea7\u54c1: ${data.ocrProduct}`,
    `\u6570\u91cf: ${data.quantity} \u4ef6`,
    `\u627f\u8fd0\u5546: ${data.carrier}`,
    `\u8ffd\u8e2a\u53f7: ${data.ocrTrackingNo}`,
  ].join('\n');
}

function createReceiptFixture(shotDir, runId) {
  const filePath = path.join(shotDir, `receipt-${runId}.png`);
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';
  fs.writeFileSync(filePath, Buffer.from(pngBase64, 'base64'));
  return filePath;
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
  createOcrText,
  createReceiptFixture,
  createShippingAuditData,
};
