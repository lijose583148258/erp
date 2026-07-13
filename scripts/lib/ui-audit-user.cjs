const fs = require('fs');
const path = require('path');

const ORIGIN_REPORT = path.resolve(process.cwd(), 'output', 'audit', 'stable-runtime-origin-v1.json');
const DEFAULT_ACCOUNT = {
  username: process.env.AUDIT_UI_USERNAME || 'ui_smoke_admin',
  password: process.env.AUDIT_UI_PASSWORD || 'AuditSmoke12345!',
  role: process.env.AUDIT_UI_ROLE || 'admin',
};

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

async function ensureUiAuditUser(account = DEFAULT_ACCOUNT) {
  const bcrypt = require('../../backend/node_modules/bcryptjs');
  const prisma = createAuditPrismaClient();
  const passwordHash = await bcrypt.hash(account.password, 12);
  try {
    await prisma.user.upsert({
      where: { username: account.username },
      update: {
        passwordHash,
        role: account.role,
        segment: 'mixed',
        email: `${account.username}@local.test`,
        isActive: true,
        mustChangePassword: false,
      },
      create: {
        username: account.username,
        passwordHash,
        role: account.role,
        segment: 'mixed',
        email: `${account.username}@local.test`,
        isActive: true,
        mustChangePassword: false,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  return account;
}

async function loginUiAuditUser(page, appUrl, options = {}) {
  const account = await ensureUiAuditUser(options.account || DEFAULT_ACCOUNT);
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
