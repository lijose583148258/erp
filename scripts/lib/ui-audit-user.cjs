const fs = require('fs');
const path = require('path');

const ORIGIN_REPORT = path.resolve(process.cwd(), 'output', 'audit', 'stable-runtime-origin-v1.json');
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

function prepareDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  try {
    const origin = JSON.parse(fs.readFileSync(ORIGIN_REPORT, 'utf8').replace(/^\uFEFF/, ''));
    if (origin?.runtimeDbPath) {
      process.env.DATABASE_URL = `file:${String(origin.runtimeDbPath).replace(/\\/g, '/')}`;
    }
  } catch {
    // Prisma will use the project's default DATABASE_URL if no runtime report exists.
  }
}

function createAuditPrismaClient() {
  const provider = String(process.env.AUDIT_PRISMA_PROVIDER || 'sqlite').trim().toLowerCase();
  if (provider === 'sqlite') {
    prepareDatabaseUrl();
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

async function ensureUiAuditUser(account) {
  const resolvedAccount = account || resolveDefaultAccount();
  if (!resolvedAccount.username || !resolvedAccount.password || !resolvedAccount.role) {
    throw new Error('UI audit account is incomplete.');
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
        segment: 'mixed',
        email: `${resolvedAccount.username}@local.test`,
        isActive: true,
        mustChangePassword: false,
      },
      create: {
        username: resolvedAccount.username,
        passwordHash,
        role: resolvedAccount.role,
        segment: 'mixed',
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

  await page.addInitScript(applySession, session);
  await page.evaluate(applySession, session).catch(() => {});

  return { token, user, account };
}

module.exports = {
  createAuditPrismaClient,
  ensureUiAuditUser,
  loginUiAuditUser,
};
