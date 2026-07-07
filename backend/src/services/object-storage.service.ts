import fs from 'fs';
import path from 'path';
import { getUploadDir } from '../config/runtime';

export type ObjectStorageProvider = 'local';

export type PutPublicObjectInput = {
  key: string;
  body: Buffer;
  contentType?: string;
};

export type StoredObject = {
  provider: ObjectStorageProvider;
  key: string;
  url: string;
  size: number;
  contentType?: string;
};

export interface ObjectStorage {
  readonly provider: ObjectStorageProvider;
  putPublicObject(input: PutPublicObjectInput): StoredObject;
  getPublicUrl(key: string): string;
  getLocalPublicRoot(): string | null;
}

const normalizeObjectKey = (key: string) => {
  const normalized = String(key || '').replace(/\\/g, '/').trim();
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length || normalized.startsWith('/')) throw new Error('INVALID_OBJECT_KEY');
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || /[\u0000-\u001F\u007F]/.test(segment)) {
      throw new Error('INVALID_OBJECT_KEY');
    }
  }
  return segments.join('/');
};

const encodeObjectKeyForUrl = (key: string) =>
  normalizeObjectKey(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export class LocalObjectStorage implements ObjectStorage {
  readonly provider = 'local' as const;

  constructor(
    private readonly publicRoot: string,
    private readonly publicBasePath = '/uploads',
  ) {}

  putPublicObject(input: PutPublicObjectInput): StoredObject {
    const key = normalizeObjectKey(input.key);
    const targetPath = path.resolve(this.publicRoot, key);
    const root = path.resolve(this.publicRoot);
    if (!targetPath.startsWith(`${root}${path.sep}`)) throw new Error('INVALID_OBJECT_KEY');

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, input.body);

    return {
      provider: this.provider,
      key,
      url: this.getPublicUrl(key),
      size: input.body.length,
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };
  }

  getPublicUrl(key: string): string {
    return `${this.publicBasePath}/${encodeObjectKeyForUrl(key)}`;
  }

  getLocalPublicRoot() {
    return this.publicRoot;
  }
}

export const objectStorage: ObjectStorage = new LocalObjectStorage(getUploadDir());
