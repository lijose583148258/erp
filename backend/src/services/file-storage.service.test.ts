import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalFileStorageProvider, S3FileStorageProvider } from './file-storage.service';
import { renderPrometheusMetrics } from '../middleware/metricsMiddleware';

describe('LocalFileStorageProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-storage-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores files behind the stable protected uploads URL contract', async () => {
    const storage = new LocalFileStorageProvider(tempDir);
    const stored = await storage.save('contracts', 'contract demo.pdf', Buffer.from('contract'));

    expect(stored.namespace).toBe('contracts');
    expect(stored.key).toBe('contract_demo.pdf');
    expect(stored.publicUrl).toBe('/uploads/contracts/contract_demo.pdf');
    expect(fs.readFileSync(path.join(tempDir, 'contracts', 'contract_demo.pdf'), 'utf8')).toBe('contract');
    expect(renderPrometheusMetrics()).toContain(
      'ailaoda_storage_operations_total{action="local_write",namespace="contracts"} 1',
    );
  });

  it('normalizes download keys and never resolves outside the namespace root', async () => {
    const storage = new LocalFileStorageProvider(tempDir);
    await storage.save('pod', 'receipt.png', Buffer.from('receipt'));

    expect((await storage.resolveDownload('pod', 'receipt.png'))?.fileName).toBe('receipt.png');
    expect(await storage.resolveDownload('pod', '../receipt.png')).toBeDefined();
    expect(await storage.resolveDownload('pod', '../../missing.png')).toBeNull();
  });
});

describe('S3FileStorageProvider', () => {
  let tempDir: string;
  const originalFetch = global.fetch;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-s3-cache-'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores through an S3-compatible endpoint while preserving protected upload URLs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      const [url, init] = args;
      calls.push({ url: String(url), init });
      return new Response('', { status: 200 });
    }) as typeof fetch;

    const storage = new S3FileStorageProvider({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'ailaoda',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      cacheDir: tempDir,
      forcePathStyle: true,
    });

    const stored = await storage.save('contracts', 'contract demo.pdf', Buffer.from('contract'));

    expect(stored.publicUrl).toBe('/uploads/contracts/contract_demo.pdf');
    expect(calls[0].url).toBe('http://127.0.0.1:9000/ailaoda/contracts/contract_demo.pdf');
    expect(calls[0].init?.method).toBe('PUT');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toContain('AWS4-HMAC-SHA256');
  });

  it('downloads S3 objects into a namespace-scoped cache for protected sendFile routes', async () => {
    global.fetch = jest.fn(async () => new Response(Buffer.from('receipt'), { status: 200 })) as typeof fetch;
    const storage = new S3FileStorageProvider({
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      bucket: 'ailaoda',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      cacheDir: tempDir,
      forcePathStyle: true,
    });

    const target = await storage.resolveDownload('pod', 'receipt.png');

    expect(target?.fileName).toBe('receipt.png');
    expect(target?.localPath.startsWith(path.join(tempDir, 'pod'))).toBe(true);
    expect(fs.readFileSync(target?.localPath || '', 'utf8')).toBe('receipt');
  });

  it('fails over downloads to a secondary endpoint', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      const [url] = args;
      calls.push(String(url));
      if (String(url).startsWith('http://primary:9000')) throw new Error('primary unavailable');
      return new Response(Buffer.from('secondary-copy'), { status: 200 });
    }) as typeof fetch;
    const storage = new S3FileStorageProvider({
      endpoint: 'http://primary:9000',
      fallbackEndpoints: ['http://secondary:9000'],
      region: 'us-east-1',
      bucket: 'ailaoda',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      cacheDir: tempDir,
      forcePathStyle: true,
    });

    const target = await storage.resolveDownload('contracts', 'ha.pdf');
    expect(calls).toHaveLength(2);
    expect(calls[1].startsWith('http://secondary:9000')).toBe(true);
    expect(fs.readFileSync(target?.localPath || '', 'utf8')).toBe('secondary-copy');
    expect(renderPrometheusMetrics()).toContain(
      'ailaoda_storage_operations_total{action="read_fallback",namespace="contracts"} 1',
    );
  });
});
