import fs from 'fs';
import path from 'path';
import { getUploadDir } from '../config/runtime';

const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export const RECEIPT_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const sanitizeFileStem = (value: string) =>
  String(value || 'receipt')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 80) || 'receipt';

function looksLikeReceiptFile(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (mimeType === 'application/pdf') return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-';
  return false;
}

function decodeReceiptDataUrl(dataUrl: string, mimeType: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('INVALID_DATA_URL');
  if (match[1] !== mimeType) throw new Error('MIME_MISMATCH');
  if (!RECEIPT_MIME_EXT[mimeType]) throw new Error('UNSUPPORTED_MIME');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(match[2])) throw new Error('INVALID_BASE64');

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length <= 0 || buffer.length > RECEIPT_MAX_BYTES) throw new Error('INVALID_SIZE');
  if (!looksLikeReceiptFile(buffer, mimeType)) throw new Error('INVALID_FILE_SIGNATURE');
  return buffer;
}

export function storeReceiptFile(shipmentNo: string, fileName: string, mimeType: string, dataUrl: string) {
  const buffer = decodeReceiptDataUrl(dataUrl, mimeType);
  const uploadRoot = path.join(getUploadDir(), 'pod');
  fs.mkdirSync(uploadRoot, { recursive: true });

  const ext = RECEIPT_MIME_EXT[mimeType];
  const safeStem = sanitizeFileStem(fileName);
  const storedFileName = `${shipmentNo}-${Date.now()}-${safeStem}${ext}`;
  const storedPath = path.join(uploadRoot, storedFileName);
  if (!path.resolve(storedPath).startsWith(path.resolve(uploadRoot) + path.sep)) {
    throw new Error('INVALID_STORED_PATH');
  }
  fs.writeFileSync(storedPath, buffer);
  return `/uploads/pod/${encodeURIComponent(storedFileName)}`;
}
