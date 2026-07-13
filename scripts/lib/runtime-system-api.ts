import { resolveRuntimeAppUrl } from './runtime-stable-restart';
import { createRequire } from 'module';

const requireFromScript = createRequire(import.meta.url);
const { ensureUiAuditUser } = requireFromScript('../lib/ui-audit-user.cjs') as {
  ensureUiAuditUser: (account?: { username: string; password: string; role: string }) => Promise<{ username: string; password: string; role: string }>;
};
const { getSqliteDbPath } = requireFromScript('../../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
};

export type ApiResponse = {
  ok: boolean;
  status: number;
  json: any;
};

export function resolveRuntimeApiUrl() {
  return `${(process.env.APP_URL || resolveRuntimeAppUrl()).replace(/\/+$/, '')}/`;
}

export async function apiFetch(
  appUrl: string,
  endpoint: string,
  options: { method?: string; data?: unknown } = {},
  token = '',
  requestTimeoutMs = 10_000,
): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${appUrl}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function loginAsAdmin(appUrl: string, requestTimeoutMs = 10_000) {
  const runtimeDbPath = getSqliteDbPath();
  if (runtimeDbPath) {
    process.env.DATABASE_URL = `file:${runtimeDbPath.replace(/\\/g, '/')}`;
  }
  const account = await ensureUiAuditUser({
    username: process.env.AUDIT_UI_USERNAME || 'ui_runtime_system_admin',
    password: process.env.AUDIT_UI_PASSWORD || 'AuditSmoke12345!',
    role: 'admin',
  });
  const response = await apiFetch(appUrl, '/auth/login', {
    method: 'POST',
    data: { username: account.username, password: account.password },
  }, '', requestTimeoutMs);

  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status}`);
  }

  const token = response.json?.data?.token;
  if (!token) {
    throw new Error('Login response does not include a token');
  }
  return token as string;
}

export async function createSystemBackup(appUrl: string, token: string, requestTimeoutMs = 10_000) {
  const response = await apiFetch(appUrl, '/system/backups', { method: 'POST' }, token, requestTimeoutMs);
  if (!response.ok) {
    throw new Error(`Create backup failed: HTTP ${response.status}`);
  }
  const fileName = response.json?.data?.fileName;
  if (!fileName) {
    throw new Error('Create backup response does not include fileName');
  }
  return String(fileName);
}

export async function restoreSystemBackup(appUrl: string, token: string, fileName: string, requestTimeoutMs = 10_000) {
  const response = await apiFetch(appUrl, '/system/restore', {
    method: 'POST',
    data: { fileName },
  }, token, requestTimeoutMs);
  if (!response.ok) {
    throw new Error(`Restore backup failed: HTTP ${response.status} ${response.json?.message || ''}`);
  }
  const integrity = response.json?.data?.integrity;
  if (!integrity?.manifestExists || !integrity?.verified) {
    throw new Error(`Restore did not verify backup manifest: ${fileName}`);
  }
  return integrity;
}
