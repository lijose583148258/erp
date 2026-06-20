const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function runNodeAuditScript(scriptPath, { timeoutMs, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${scriptPath} exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${scriptPath} failed with exit code ${code}: ${stderr || stdout}`));
    });
  });
}

function createProductionSmokeModule({
  getBodyText,
  openHash,
  safeScreenshot,
  withTimeout,
}) {
  return async function moduleProductionSmoke(page) {
    await openHash(page, '#production', 'production', ['配方主档', '工单']);
    const body = await getBodyText(page);
    const shot = await safeScreenshot(page, 'production-smoke');
    const productionReportPath = path.join(process.cwd(), 'output', 'playwright', 'production-browser-audit-report-v1.json');
    await withTimeout('production-deep-browser-audit', 180000, async () => {
      await runNodeAuditScript(path.join('scripts', 'production-browser-audit-v1.cjs'), {
        timeoutMs: 170000,
        env: { APP_URL: process.env.APP_URL || 'http://127.0.0.1:5001/' },
      });
    });
    const productionReport = JSON.parse(fs.readFileSync(productionReportPath, 'utf8'));
    if (productionReport.status !== 'passed') {
      throw new Error(`production deep browser audit did not pass: ${productionReport.status || 'unknown'}`);
    }
    return {
      status: 'passed',
      evidence: [shot, productionReportPath].filter(Boolean),
      notes: '已纳入生产专项浏览器闭环：化工配方原料明细、工单、质检、不完整耗用阻断、完工、批次与 API/UI 回读均通过。',
      bodySnippet: body.slice(0, 400),
    };
  };
}

module.exports = {
  createProductionSmokeModule,
};
