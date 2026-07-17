const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const findings = [];

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), 'utf8').replace(/^\uFEFF/, '');
}

function add(level, file, message) {
  findings.push({ level, file, message });
}

const storageService = read('backend/src/services/file-storage.service.ts');
const contractController = read('backend/src/controllers/contract.controller.ts');
const receiptService = read('backend/src/services/shipping-receipt-file.service.ts');
const server = read('backend/src/server.ts');

if (!storageService.includes('interface FileStorageProvider') || !storageService.includes('LocalFileStorageProvider')) {
  add('P1', 'backend/src/services/file-storage.service.ts', 'File storage must expose a provider interface and local provider implementation.');
}
for (const token of ['S3FileStorageProvider', 'S3_ENDPOINT', 'S3_BUCKET', 'AWS4-HMAC-SHA256', 'resolveDownload', '.s3-cache']) {
  if (!storageService.includes(token)) {
    add('P1', 'backend/src/services/file-storage.service.ts', `File storage S3/MinIO provider must assert ${token}.`);
  }
}
if (!storageService.includes('FILE_STORAGE_DRIVER')) {
  add('P1', 'backend/src/services/file-storage.service.ts', 'File storage driver selection must be explicit and auditable.');
}
if (/getUploadDir|fs\.writeFileSync|path\.join\(.*upload/i.test(contractController)) {
  add('P1', 'backend/src/controllers/contract.controller.ts', 'Contract controller must not write directly to upload directories.');
}
if (/getUploadDir|fs\.writeFileSync|path\.join\(.*upload/i.test(receiptService)) {
  add('P1', 'backend/src/services/shipping-receipt-file.service.ts', 'Shipping receipt file service must use the file storage abstraction.');
}
if (!server.includes('fileStorage.resolveDownload')) {
  add('P1', 'backend/src/server.ts', 'Protected upload download routes must resolve files through the storage abstraction.');
}
if (/express\.static\(uploadDir/.test(server)) {
  add('P1', 'backend/src/server.ts', 'Uploads must not be exposed through public express.static.');
}

const productionEnv = read('.env.production.example');
for (const token of ['FILE_STORAGE_DRIVER=local', 'S3_ENDPOINT=', 'S3_BUCKET=', 'S3_ACCESS_KEY_ID=', 'S3_SECRET_ACCESS_KEY=', 'S3_FORCE_PATH_STYLE=true']) {
  if (!productionEnv.includes(token)) {
    add('P1', '.env.production.example', `File storage production env example must include ${token}.`);
  }
}

const compose = read('docker-compose.yml');
for (const token of ['minio:', 'profiles:', 'object-storage', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'ailao-minio-data']) {
  if (!compose.includes(token)) {
    add('P1', 'docker-compose.yml', `Docker compose must include MinIO rehearsal token ${token}.`);
  }
}

const report = {
  name: 'File Storage Abstraction Audit',
  version: '1.0',
  status: findings.some(item => item.level === 'P0' || item.level === 'P1') ? 'failed' : 'passed',
  findings,
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'passed') process.exit(1);
