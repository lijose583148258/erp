import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { getUploadDir, runtime } from '../config/runtime';
import { recordStorageMetric } from '../middleware/metricsMiddleware';

export type FileStorageNamespace = 'contracts' | 'pod';

export type StoredFile = {
  namespace: FileStorageNamespace;
  key: string;
  publicUrl: string;
  localPath?: string;
};

export type FileDownloadTarget = {
  localPath: string;
  fileName: string;
};

export interface FileStorageProvider {
  save(namespace: FileStorageNamespace, key: string, buffer: Buffer): Promise<StoredFile>;
  resolveDownload(namespace: FileStorageNamespace, key: string): Promise<FileDownloadTarget | null>;
}

const normalizeKey = (key: string) => {
  const basename = path.basename(String(key || '').replace(/\\/g, '/'));
  const cleaned = basename.replace(/[^\w.%-]+/g, '_').slice(0, 180);
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('INVALID_FILE_KEY');
  return cleaned;
};

export class LocalFileStorageProvider implements FileStorageProvider {
  constructor(private readonly rootDir: string) {}

  async save(namespace: FileStorageNamespace, key: string, buffer: Buffer): Promise<StoredFile> {
    const safeKey = normalizeKey(key);
    const namespaceRoot = path.resolve(this.rootDir, namespace);
    const localPath = path.resolve(namespaceRoot, safeKey);
    if (!localPath.startsWith(namespaceRoot + path.sep)) throw new Error('INVALID_FILE_PATH');

    fs.mkdirSync(namespaceRoot, { recursive: true });
    fs.writeFileSync(localPath, buffer);
    recordStorageMetric('local_write', namespace);

    return {
      namespace,
      key: safeKey,
      publicUrl: `/uploads/${namespace}/${encodeURIComponent(safeKey)}`,
      localPath,
    };
  }

  async resolveDownload(namespace: FileStorageNamespace, key: string): Promise<FileDownloadTarget | null> {
    const safeKey = normalizeKey(key);
    const namespaceRoot = path.resolve(this.rootDir, namespace);
    const localPath = path.resolve(namespaceRoot, safeKey);
    if (!localPath.startsWith(namespaceRoot + path.sep)) return null;
    if (!fs.existsSync(localPath)) {
      recordStorageMetric('read_not_found', namespace);
      return null;
    }
    recordStorageMetric('local_read', namespace);
    return { localPath, fileName: safeKey };
  }
}

type S3StorageConfig = {
  endpoint: string;
  fallbackEndpoints?: string[];
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  cacheDir: string;
  forcePathStyle: boolean;
};

const sha256Hex = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

const hmac = (key: Buffer | string, value: string) => crypto.createHmac('sha256', key).update(value).digest();

const hmacHex = (key: Buffer | string, value: string) => crypto.createHmac('sha256', key).update(value).digest('hex');

const encodeS3PathSegment = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const toAmzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

const getSigningKey = (secretAccessKey: string, dateStamp: string, region: string) => {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
};

const buildS3Url = (config: S3StorageConfig, objectKey: string) => {
  const endpoint = new URL(config.endpoint);
  const encodedKey = objectKey.split('/').map(encodeS3PathSegment).join('/');
  if (config.forcePathStyle) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${encodeS3PathSegment(config.bucket)}/${encodedKey}`;
    return endpoint;
  }
  endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${encodedKey}`;
  return endpoint;
};

const signS3Request = (method: 'GET' | 'PUT', url: URL, body: Buffer | null, config: S3StorageConfig) => {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body ? sha256Hex(body) : sha256Hex('');
  const canonicalUri = url.pathname.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
  const canonicalQuery = url.searchParams.toString();
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmacHex(getSigningKey(config.secretAccessKey, dateStamp, config.region), stringToSign);
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHash,
  };
};

const requireEnv = (key: string) => {
  const value = String(process.env[key] || '').trim();
  if (!value) throw new Error(`Missing required ${key} for FILE_STORAGE_DRIVER=s3`);
  return value;
};

const createS3Config = (): S3StorageConfig => ({
  endpoint: requireEnv('S3_ENDPOINT'),
  fallbackEndpoints: String(process.env.S3_ENDPOINTS || '').split(',').map(value => value.trim()).filter(Boolean),
  region: String(process.env.S3_REGION || 'us-east-1').trim(),
  bucket: requireEnv('S3_BUCKET'),
  accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
  secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
  publicBaseUrl: String(process.env.S3_PUBLIC_BASE_URL || '').trim() || undefined,
  cacheDir: path.resolve(getUploadDir(), '.s3-cache'),
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false',
});

export class S3FileStorageProvider implements FileStorageProvider {
  constructor(private readonly config: S3StorageConfig) {}

  private getObjectKey(namespace: FileStorageNamespace, key: string) {
    return `${namespace}/${normalizeKey(key)}`;
  }

  private getEndpoints() {
    return Array.from(new Set([this.config.endpoint, ...(this.config.fallbackEndpoints || [])].map(value => value.replace(/\/$/, ''))));
  }

  private configForEndpoint(endpoint: string): S3StorageConfig {
    return { ...this.config, endpoint };
  }

  private getCachePath(namespace: FileStorageNamespace, key: string) {
    const safeKey = normalizeKey(key);
    const cacheRoot = path.resolve(this.config.cacheDir, namespace);
    const cachePath = path.resolve(cacheRoot, safeKey);
    if (!cachePath.startsWith(cacheRoot + path.sep)) throw new Error('INVALID_FILE_PATH');
    return { cacheRoot, cachePath, safeKey };
  }

  async save(namespace: FileStorageNamespace, key: string, buffer: Buffer): Promise<StoredFile> {
    const safeKey = normalizeKey(key);
    const objectKey = this.getObjectKey(namespace, safeKey);
    const results = await Promise.allSettled(this.getEndpoints().map(async endpoint => {
      const endpointConfig = this.configForEndpoint(endpoint);
      const url = buildS3Url(endpointConfig, objectKey);
      const signature = signS3Request('PUT', url, buffer, endpointConfig);
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: signature.authorization,
          'x-amz-content-sha256': signature.payloadHash,
          'x-amz-date': signature.amzDate,
          'content-length': String(buffer.length),
        },
        body: buffer,
        signal: AbortSignal.timeout(Math.max(250, Number(process.env.S3_REQUEST_TIMEOUT_MS || 3000))),
      });
      if (!response.ok) throw new Error(`S3_UPLOAD_FAILED_${response.status}`);
    }));
    const successes = results.filter(result => result.status === 'fulfilled').length;
    const endpointCount = this.getEndpoints().length;
    const minimumSuccesses = Math.min(endpointCount, Math.max(1, Number(process.env.S3_MIN_WRITE_SUCCESSES || 1)));
    if (successes < minimumSuccesses) {
      recordStorageMetric('write_error', namespace);
      throw new Error(`S3_UPLOAD_REPLICAS_INSUFFICIENT_${successes}_OF_${minimumSuccesses}`);
    }
    recordStorageMetric(successes < endpointCount ? 'write_partial' : 'write_success', namespace);

    return {
      namespace,
      key: safeKey,
      publicUrl: `/uploads/${namespace}/${encodeURIComponent(safeKey)}`,
    };
  }

  async resolveDownload(namespace: FileStorageNamespace, key: string): Promise<FileDownloadTarget | null> {
    const objectKey = this.getObjectKey(namespace, key);
    const { cacheRoot, cachePath, safeKey } = this.getCachePath(namespace, key);
    let allNotFound = true;
    let lastError: unknown = null;
    for (const [endpointIndex, endpoint] of this.getEndpoints().entries()) {
      try {
        const endpointConfig = this.configForEndpoint(endpoint);
        const url = buildS3Url(endpointConfig, objectKey);
        const signature = signS3Request('GET', url, null, endpointConfig);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: signature.authorization,
            'x-amz-content-sha256': signature.payloadHash,
            'x-amz-date': signature.amzDate,
          },
          signal: AbortSignal.timeout(Math.max(250, Number(process.env.S3_REQUEST_TIMEOUT_MS || 3000))),
        });
        if (response.status === 404) continue;
        allNotFound = false;
        if (!response.ok) throw new Error(`S3_DOWNLOAD_FAILED_${response.status}`);
        fs.mkdirSync(cacheRoot, { recursive: true });
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(cachePath, buffer);
        recordStorageMetric(endpointIndex === 0 ? 'read_primary' : 'read_fallback', namespace);
        return { localPath: cachePath, fileName: safeKey };
      } catch (error) {
        allNotFound = false;
        lastError = error;
      }
    }
    if (allNotFound) {
      recordStorageMetric('read_not_found', namespace);
      return null;
    }
    recordStorageMetric('read_error', namespace);
    throw lastError instanceof Error ? lastError : new Error('S3_DOWNLOAD_ALL_ENDPOINTS_FAILED');
  }
}

const createFileStorageProvider = (): FileStorageProvider => {
  const driver = String(process.env.FILE_STORAGE_DRIVER || 'local').trim().toLowerCase();
  if (driver === 'local') {
    return new LocalFileStorageProvider(getUploadDir());
  }
  if (driver === 's3' || driver === 'minio') {
    return new S3FileStorageProvider(createS3Config());
  }
  throw new Error(`Unsupported FILE_STORAGE_DRIVER '${driver}'. Configure local, s3, or minio.`);
};

export const fileStorage = createFileStorageProvider();

export const getFileStorageStatus = () => ({
  driver: String(process.env.FILE_STORAGE_DRIVER || 'local').trim().toLowerCase(),
  uploadDir: runtime.uploadDir,
  s3Bucket: process.env.S3_BUCKET || null,
  s3Endpoint: process.env.S3_ENDPOINT || null,
  s3EndpointCount: Array.from(new Set([process.env.S3_ENDPOINT, ...String(process.env.S3_ENDPOINTS || '').split(',')].filter(Boolean))).length,
});
