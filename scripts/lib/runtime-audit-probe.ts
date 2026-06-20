import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { normalizeDatabasePath } from './business-data-fingerprint';

export const RUNTIME_PROBE_ACTION = 'RUNTIME_WRITE_PERSISTENCE_PROBE';
export const RUNTIME_PROBE_RESOURCE = 'runtime_persistence_probe';

export type ProbeUserRow = {
  id: number;
  username: string;
};

export type AuditLogProbeRow = {
  id: number;
  user_id: number;
  action: string;
  resource: string;
  resource_id: number | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export async function pickProbeUser(client: PrismaClientType) {
  const users = await client.$queryRawUnsafe<ProbeUserRow[]>(
    "SELECT id, username FROM users ORDER BY CASE WHEN username = 'admin' THEN 0 ELSE 1 END, id ASC LIMIT 1",
  );
  const user = users[0];
  if (!user) {
    throw new Error('No user exists for runtime persistence probe');
  }
  return user;
}

export async function readAuditProbe(
  client: PrismaClientType,
  probeId: string,
  action = RUNTIME_PROBE_ACTION,
  resource = RUNTIME_PROBE_RESOURCE,
) {
  const rows = await client.$queryRawUnsafe<AuditLogProbeRow[]>(
    `SELECT
      id,
      user_id,
      action,
      resource,
      resource_id,
      details,
      ip_address,
      user_agent,
      created_at
    FROM audit_logs
    WHERE action = ?
      AND resource = ?
      AND details LIKE ?
    ORDER BY id DESC
    LIMIT 1`,
    action,
    resource,
    `%${probeId}%`,
  );
  return rows[0] || null;
}

export async function insertAuditProbe(
  client: PrismaClientType,
  params: {
    probeId: string;
    databasePath: string;
    purpose: string;
    userAgent: string;
    action?: string;
    resource?: string;
  },
) {
  const user = await pickProbeUser(client);
  const action = params.action || RUNTIME_PROBE_ACTION;
  const resource = params.resource || RUNTIME_PROBE_RESOURCE;
  const details = JSON.stringify({
    probeId: params.probeId,
    purpose: params.purpose,
    databasePath: normalizeDatabasePath(params.databasePath),
    generatedAt: new Date().toISOString(),
  });

  await client.$executeRawUnsafe(
    `INSERT INTO audit_logs (
      user_id,
      action,
      resource,
      resource_id,
      details,
      ip_address,
      user_agent,
      created_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)`,
    user.id,
    action,
    resource,
    details,
    '127.0.0.1',
    params.userAgent,
  );

  const row = await readAuditProbe(client, params.probeId, action, resource);
  if (!row) {
    throw new Error(`Probe was inserted but could not be read immediately: ${params.probeId}`);
  }
  return row;
}

export function assertSameAuditProbe(
  before: AuditLogProbeRow,
  after: AuditLogProbeRow | null,
  probeId: string,
) {
  if (!after) return [`Probe row missing after operation: ${probeId}`];
  const mismatches: string[] = [];
  for (const field of ['id', 'user_id', 'action', 'resource', 'details'] as const) {
    if (before[field] !== after[field]) {
      mismatches.push(`Probe field changed after operation: ${field}`);
    }
  }
  if (!after.details?.includes(probeId)) {
    mismatches.push(`Probe details no longer include probeId: ${probeId}`);
  }
  return mismatches;
}
