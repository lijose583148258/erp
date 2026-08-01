const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'output', 'audit', 'bom-grid-poc');
fs.mkdirSync(outputDir, { recursive: true });

const baseUrl = process.env.APP_URL || 'http://127.0.0.1:3000';
const username = process.env.AUDIT_UI_USERNAME;
const password = process.env.AUDIT_UI_PASSWORD;
if (!username || !password) throw new Error('AUDIT_UI_USERNAME and AUDIT_UI_PASSWORD are required');
const restrictedAuditEnabled = Boolean(process.env.DATABASE_URL);
const restrictedUser = {
  username: 'bom_grid_restricted_auditor',
  password: crypto.randomBytes(18).toString('base64url'),
};
const paste300 = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'bom-grid', 'paste-300-rows.tsv'), 'utf8').trimEnd();
const pasteLines = paste300.split(/\r?\n/);
const firstPasteCode = pasteLines[0].split('\t')[0];
const lastPasteLossRate = pasteLines.at(-1).split('\t').at(-1);

const candidates = [
  { id: 'revogrid', route: '/production/bom-grid-lab/revogrid' },
  { id: 'react-data-grid', route: '/production/bom-grid-lab/react-data-grid' },
];
const waitForResult = async (locator, pattern, timeoutMs) => {
  const startedAt = Date.now();
  let text = '';
  while (Date.now() - startedAt < timeoutMs) {
    text = String(await locator.textContent().catch(() => '') || '');
    if (pattern.test(text)) return text;
    if (/失败|不一致|错误|找不到|存在阻断/.test(text)) {
      throw new Error(`BOM Grid Lab reported failure: ${text}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${pattern}: ${text}`);
};

const provisionRestrictedUser = async () => {
  if (!restrictedAuditEnabled) return null;
  const bcrypt = require('../backend/node_modules/bcryptjs');
  const { PrismaClient } = require('../backend/node_modules/@prisma/client');
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(restrictedUser.password, 12);
    return await prisma.user.upsert({
      where: { username: restrictedUser.username },
      update: {
        passwordHash,
        role: 'sales',
        segment: 'direct',
        isActive: true,
        mustChangePassword: false,
      },
      create: {
        username: restrictedUser.username,
        passwordHash,
        role: 'sales',
        segment: 'direct',
        email: `${restrictedUser.username}@example.invalid`,
        isActive: true,
        mustChangePassword: false,
      },
      select: { id: true, username: true, role: true },
    });
  } finally {
    await prisma.$disconnect();
  }
};

const run = async () => {
  const restrictedUserRecord = await provisionRestrictedUser();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  let restrictedAccess = {
    executed: false,
    passed: false,
    reason: 'DATABASE_URL was not provided, so the restricted-role browser gate was not executed.',
  };
  try {
    for (const candidate of candidates) {
      const context = await browser.newContext({
        viewport: { width: 1600, height: 1000 },
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      const startedAt = Date.now();
      await page.goto(`${baseUrl}${candidate.route}`, { waitUntil: 'domcontentloaded' });
      await page.locator('#login-username').pressSequentially(username, { delay: 35 });
      await page.locator('#login-password').pressSequentially(password, { delay: 28 });
      await page.getByRole('button', { name: /登录系统|Sign In|Đăng nhập/ }).click();
      await page.getByTestId(`bom-grid-lab-page-${candidate.id}`).waitFor({ state: 'visible', timeout: 30_000 });
      await page.getByText('已载入 100 行脱敏黄金数据。').waitFor({ state: 'visible', timeout: 15_000 });

      const gridHost = page.getByTestId(`bom-grid-lab-${candidate.id}`);
      await gridHost.evaluate((element, text) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        element.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }));
      }, paste300);
      const clipboardDeadline = Date.now() + 15_000;
      let clipboardState = {};
      while (Date.now() < clipboardDeadline) {
        clipboardState = await gridHost.evaluate((element) => ({
          rows: element.getAttribute('data-row-count'),
          firstMaterialCode: element.getAttribute('data-first-material-code'),
          lastLossRate: element.getAttribute('data-last-loss-rate'),
        }));
        if (
          clipboardState.rows === '300'
          && clipboardState.firstMaterialCode === firstPasteCode
          && clipboardState.lastLossRate === lastPasteLossRate
        ) break;
        await page.waitForTimeout(100);
      }
      if (
        clipboardState.rows !== '300'
        || clipboardState.firstMaterialCode !== firstPasteCode
        || clipboardState.lastLossRate !== lastPasteLossRate
      ) {
        throw new Error(`300-row clipboard integration mismatch for ${candidate.id}: ${JSON.stringify({
          expected: { rows: '300', firstMaterialCode: firstPasteCode, lastLossRate: lastPasteLossRate },
          actual: clipboardState,
        })}`);
      }

      const load1000StartedAt = Date.now();
      await page.getByTestId('bom-grid-load-1000').click();
      await page.getByText('已载入 1000 行脱敏数据。').waitFor({ state: 'visible' });
      const load1000Ms = Date.now() - load1000StartedAt;

      await page.getByTestId('bom-grid-run-golden').click();
      const result = page.getByTestId('bom-grid-lab-result');
      const goldenMessage = await waitForResult(result, /黄金操作通过/, 15_000);

      await page.getByTestId('bom-grid-undo').click();
      await page.getByTestId('bom-grid-redo').click();
      await page.getByTestId('bom-grid-validate').click();
      await waitForResult(result, /共享验证规则通过/, 15_000);

      await page.getByTestId('bom-grid-save-readback').click();
      const saveReadbackMessage = await waitForResult(result, /后端保存与回读逐字段一致/, 60_000);

      const screenshot = path.join(outputDir, `${candidate.id}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      const uniqueConsoleErrors = Array.from(new Set(consoleErrors));
      const rejectionReasons = uniqueConsoleErrors.map((message) => (
        message.includes('Content Security Policy')
          ? 'Browser console reported a CSP violation.'
          : 'Browser console reported an error.'
      )).filter((reason, index, values) => values.indexOf(reason) === index);
      results.push({
        candidate: candidate.id,
        route: candidate.route,
        passed: rejectionReasons.length === 0,
        rejectionReasons,
        clipboardPaste300: {
          passed: true,
          rows: pasteLines.length,
          firstMaterialCode: firstPasteCode,
          lastLossRate: lastPasteLossRate,
        },
        load1000Ms,
        goldenMessage,
        saveReadbackMessage,
        consoleErrors: uniqueConsoleErrors,
        screenshot: path.relative(root, screenshot).replace(/\\/g, '/'),
        durationMs: Date.now() - startedAt,
      });
      await context.close();
    }

    if (restrictedUserRecord) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/production/bom-grid-lab/revogrid`, { waitUntil: 'domcontentloaded' });
      await page.locator('#login-username').pressSequentially(restrictedUser.username, { delay: 30 });
      await page.locator('#login-password').pressSequentially(restrictedUser.password, { delay: 24 });
      await page.getByRole('button', { name: /登录系统|Sign In|Đăng nhập/ }).click();
      await page.getByTestId('bom-grid-lab-disabled').waitFor({ state: 'visible', timeout: 30_000 });
      const candidateGridCount = await page.getByTestId('bom-grid-lab-revogrid').count();
      const apiWriteProbe = await page.evaluate(async () => {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/production/boms', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        return { status: response.status, body: await response.text() };
      });
      if (candidateGridCount !== 0 || apiWriteProbe.status !== 403) {
        throw new Error(`Restricted BOM Grid access gate failed: ${JSON.stringify({ candidateGridCount, apiWriteProbe })}`);
      }
      restrictedAccess = {
        executed: true,
        passed: true,
        userId: restrictedUserRecord.id,
        role: restrictedUserRecord.role,
        uiDenied: true,
        apiWriteStatus: apiWriteProbe.status,
      };
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidenceClass: 'local-human-style-browser-simulation',
    limitations: [
      'Keyboard typing uses Playwright pressSequentially rather than a physical keyboard.',
      'Operating-system Chinese/Vietnamese IME composition remains a manual veto gate.',
      'The runtime uses an isolated SQLite fixture; this is not PostgreSQL production certification.',
    ],
    results,
    restrictedAccess,
    passed: results.length === candidates.length
      && results.every((result) => result.passed && result.consoleErrors.length === 0)
      && (!restrictedAccess.executed || restrictedAccess.passed),
  };
  const reportPath = path.join(outputDir, 'bom-grid-browser-poc-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
