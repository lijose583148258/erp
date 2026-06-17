const fs = require('fs');
const path = require('path');
const bcrypt = require('../backend/node_modules/bcryptjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const ORIGIN_REPORT = path.resolve(process.cwd(), 'output', 'audit', 'stable-runtime-origin-v1.json');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'role-audit-diff-api-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'role-audit-diff-api-audit-v1.md');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const ADMIN = { username: `role_audit_admin_${RUN_ID}`, password: 'AuditAdmin12345' };
const ROLE_CODE = `audit_role_${RUN_ID}`;

if (!process.env.DATABASE_URL) {
  try {
    const origin = JSON.parse(fs.readFileSync(ORIGIN_REPORT, 'utf8').replace(/^\uFEFF/, ''));
    if (origin?.runtimeDbPath) process.env.DATABASE_URL = `file:${String(origin.runtimeDbPath).replace(/\\/g, '/')}`;
  } catch {}
}

const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
const report = { status: 'running', appUrl: APP_URL, runId: RUN_ID, steps: [] };

function record(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function fail(message, details) {
  const error = new Error(message);
  error.details = details || null;
  throw error;
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.data === undefined ? undefined : JSON.stringify(options.data),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  return { status: response.status, ok: response.ok, json };
}

function dataOf(response) {
  return response?.json?.data ?? null;
}

async function ensureAuditAdmin() {
  const passwordHash = await bcrypt.hash(ADMIN.password, 12);
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: {
      passwordHash,
      role: 'admin',
      segment: 'mixed',
      email: `${ADMIN.username}@example.com`,
      isActive: true,
      mustChangePassword: false,
    },
    create: {
      username: ADMIN.username,
      passwordHash,
      role: 'admin',
      segment: 'mixed',
      email: `${ADMIN.username}@example.com`,
      isActive: true,
      mustChangePassword: false,
    },
  });
}

async function loginAdmin() {
  await ensureAuditAdmin();
  const response = await apiFetch('/auth/login', { method: 'POST', data: ADMIN });
  if (response.status !== 200 || !dataOf(response)?.token) fail('audit admin login failed', response.json);
  record({ step: 'login-audit-admin', result: 'passed' });
  return dataOf(response);
}

async function main() {
  let token = '';
  try {
    const admin = await loginAdmin();
    token = admin.token;

    const createResponse = await apiFetch('/roles', {
      method: 'POST',
      data: {
        code: ROLE_CODE,
        name: 'Audit role',
        description: 'Role audit diff probe',
        isActive: true,
        dataScopes: ['own_customers'],
        permissions: ['dashboard.read'],
      },
    }, token);
    if (createResponse.status !== 201) fail('create role failed', createResponse.json);
    record({ step: 'create-role', result: 'passed', roleCode: ROLE_CODE });

    const updateResponse = await apiFetch(`/roles/${ROLE_CODE}`, {
      method: 'PUT',
      data: {
        name: 'Audit role updated',
        description: 'Role audit diff probe updated',
        isActive: true,
        dataScopes: ['own_customers', 'team_customers'],
        permissions: ['dashboard.read', 'customers.read'],
      },
    }, token);
    if (updateResponse.status !== 200) fail('update role failed', updateResponse.json);
    record({ step: 'update-role', result: 'passed' });

    const rows = await prisma.auditLog.findMany({
      where: { action: 'UPDATE_ROLE', resource: 'authorization.role' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const audit = rows.find((row) => {
      try {
        return JSON.parse(row.details || '{}').roleCode === ROLE_CODE;
      } catch {
        return false;
      }
    });
    if (!audit) fail('role update audit log missing', rows.map((row) => ({ id: row.id, details: row.details })));

    const details = JSON.parse(audit.details || '{}');
    if (!details.before || !details.after || !details.changed) fail('role audit details missing before/after/changed', details);
    if (!details.changed.addedPermissions?.includes('customers.read')) fail('role audit missing added permission diff', details.changed);
    if (!details.changed.addedDataScopes?.includes('team_customers')) fail('role audit missing added data scope diff', details.changed);
    record({ step: 'assert-structured-audit-diff', result: 'passed', auditLogId: audit.id });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = { message: String(error.message || error), details: error.details || null };
    throw error;
  } finally {
    await prisma.authRolePermission.deleteMany({ where: { roleCode: ROLE_CODE } }).catch(() => {});
    await prisma.authRole.deleteMany({ where: { code: ROLE_CODE } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: ADMIN.username } }).catch(() => {});
    await prisma.$disconnect();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(MD_REPORT, [
      '# Role Audit Diff API Audit v1',
      '',
      `- status: ${report.status}`,
      `- roleCode: ${ROLE_CODE}`,
      '',
      '## Steps',
      ...report.steps.map((step) => `- ${step.result || 'info'} ${step.step}`),
      '',
      report.failure ? `## Failure\n\n${report.failure.message}` : '## Failure\n\nnone',
      '',
    ].join('\n'), 'utf8');
  }
}

main()
  .then(() => {
    console.log(JSON.stringify({ status: report.status, jsonReport: JSON_REPORT, markdownReport: MD_REPORT }, null, 2));
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
