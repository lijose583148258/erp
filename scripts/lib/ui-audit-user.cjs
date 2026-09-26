const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { applyAuditDatabaseContext } = require('./audit-runtime-context.cjs');

function resolveDefaultAccount() {
  const username = String(process.env.AUDIT_UI_USERNAME || '').trim();
  const passwordFile = String(process.env.AUDIT_UI_PASSWORD_FILE || '').trim();
  const password = passwordFile
    ? fs.readFileSync(path.resolve(passwordFile), 'utf8').trim()
    : String(process.env.AUDIT_UI_PASSWORD || '').trim();
  const role = String(process.env.AUDIT_UI_ROLE || 'admin').trim();

  if (!username || !password) {
    throw new Error('UI audit credentials are required through environment or a private password file.');
  }
  if (!['admin', 'manager', 'sales', 'finance', 'warehouse'].includes(role)) {
    throw new Error(`Unsupported UI audit role: ${role}`);
  }
  return { username, password, role };
}

function createAuditPrismaClient() {
  const provider = String(process.env.AUDIT_PRISMA_PROVIDER || 'sqlite').trim().toLowerCase();
  if (provider === 'sqlite') {
    applyAuditDatabaseContext(process.env);
    const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
    return new PrismaClient();
  }

  if (provider !== 'postgresql') {
    throw new Error(`Unsupported AUDIT_PRISMA_PROVIDER: ${provider}`);
  }

  const databaseUrl = String(process.env.AUDIT_DATABASE_URL || '').trim();
  const clientPath = String(process.env.AUDIT_PRISMA_CLIENT_PATH || '').trim();
  if (!databaseUrl || !clientPath) {
    throw new Error('PostgreSQL UI audit requires AUDIT_DATABASE_URL and AUDIT_PRISMA_CLIENT_PATH.');
  }

  const { PrismaClient } = require(path.resolve(process.cwd(), clientPath));
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function ensureUiAuditAccounts(scope, roles, options = {}) {
  const normalizedScope = String(scope || 'audit').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'audit';
  const password = options.password || crypto.randomBytes(24).toString('base64url') + '!aA1';
  const accounts = {};
  for (const role of roles) {
    const account = {
      username: `${normalizedScope}_${role}`.slice(0, 48),
      password,
      role,
      segment: options.segmentByRole?.[role] || options.segment || 'mixed',
    };
    await ensureUiAuditUser(account);
    accounts[role] = account;
  }
  return accounts;
}

async function ensureUiAuditUser(account) {
  const resolvedAccount = account || resolveDefaultAccount();
  if (!resolvedAccount.username || !resolvedAccount.password || !resolvedAccount.role) {
    throw new Error('UI audit account is incomplete.');
  }
  const segment = resolvedAccount.segment || 'mixed';
  if (!['direct', 'channel', 'mixed'].includes(segment)) {
    throw new Error(`Unsupported UI audit segment: ${segment}`);
  }
  const bcrypt = require('../../backend/node_modules/bcryptjs');
  const prisma = createAuditPrismaClient();
  const passwordHash = await bcrypt.hash(resolvedAccount.password, 12);
  try {
    await prisma.user.upsert({
      where: { username: resolvedAccount.username },
      update: {
        passwordHash,
        role: resolvedAccount.role,
        segment,
        email: `${resolvedAccount.username}@local.test`,
        isActive: true,
        mustChangePassword: false,
      },
      create: {
        username: resolvedAccount.username,
        passwordHash,
        role: resolvedAccount.role,
        segment,
        email: `${resolvedAccount.username}@local.test`,
        isActive: true,
        mustChangePassword: false,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  return resolvedAccount;
}

async function loginUiAuditUser(page, appUrl, options = {}) {
  const account = await ensureUiAuditUser(options.account);
  const response = await page.request.post(`${appUrl}api/auth/login`, {
    data: { username: account.username, password: account.password },
  });
  if (!response.ok()) {
    throw new Error(`audit user login failed: ${response.status()}`);
  }

  const json = await response.json();
  const token = json?.data?.token;
  const user = json?.data?.user;
  if (!token || !user || user.mustChangePassword) {
    throw new Error('audit user login returned invalid ready state');
  }

  const session = {
    savedToken: token,
    savedUser: user,
    storage: options.storage || {},
    defaultStorage: options.defaultStorage || {},
  };
  const applySession = ({ savedToken, savedUser, storage, defaultStorage }) => {
    window.localStorage.setItem('token', savedToken);
    window.localStorage.setItem('user', JSON.stringify(savedUser));
    window.localStorage.setItem('auth_token', savedToken);
    window.localStorage.setItem('erp_auth_token', savedToken);
    window.localStorage.setItem('currentUser', JSON.stringify(savedUser));
    window.localStorage.setItem('erp_current_user', JSON.stringify(savedUser));
    for (const [key, value] of Object.entries(storage)) {
      window.localStorage.setItem(key, value);
    }
    for (const [key, value] of Object.entries(defaultStorage)) {
      if (!window.localStorage.getItem(key)) {
        window.localStorage.setItem(key, value);
      }
    }
  };

  if (options.persistInitScript !== false) {
    await page.addInitScript(applySession, session);
  }
  await page.evaluate(applySession, session).catch(() => {});

  return { token, user, account };
}

module.exports = {
  createAuditPrismaClient,
  ensureUiAuditAccounts,
  ensureUiAuditUser,
  loginUiAuditUser,
  resolveDefaultAccount,
};
