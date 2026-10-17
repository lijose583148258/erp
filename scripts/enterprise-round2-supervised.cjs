const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { spawn } = require('node:child_process');
const { createRound2Supervisor } = require('./lib/enterprise-round2-supervision.cjs');
const { killSpawnedProcessTree } = require('./lib/win32-audit-process-guard.cjs');
const root = path.resolve(__dirname, '..'), key = randomUUID();
const reportPath = path.resolve(process.env.ROUND2_REPORT_PATH || path.join(root, 'output/audit/enterprise-round2-v1.json'));
const child = spawn(process.execPath, [path.join(__dirname, 'enterprise-round2-audit-v1.cjs')], {
  cwd: root, env: { ...process.env, ROUND2_SUPERVISION_KEY: key }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true,
});
const inspect = createRound2Supervisor(performance.now());
let failure, forceKill, progress = null;
const read = () => { try { const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return report.metadata?.supervisionKey === key ? report : null;
} catch { return null; } };
const stop = reason => {
  if (failure || child.exitCode !== null || child.signalCode) return;
  failure = reason; console.error(`Round2 supervision stopped owned audit: ${reason}`);
  if (process.platform === 'win32') void killSpawnedProcessTree(child.pid);
  else child.kill();
  forceKill = setTimeout(() => child.kill('SIGKILL'), 5000); forceKill.unref();
};
// IPC avoids opening the report while its Windows atomic rename is in flight.
// The on-disk terminal report is independently checked only after child exit.
child.on('message', message => {
  if (message?.type === 'enterprise-round2-progress/v1' && message.key === key) progress = message;
});
const timer = setInterval(() => { const reason = inspect(progress, performance.now()); if (reason) stop(reason); }, 1000);
const cleanup = () => { clearInterval(timer); clearTimeout(forceKill); };
child.once('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  cleanup(); const report = read();
  // Never synthesize terminal timestamps or turn a killed/incomplete report green.
  process.exitCode = failure || signal || !report?.finishedAt ? 1 : code ?? 1;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(reportPath), 'round2-supervision.json'), JSON.stringify({
    key, reportPath, childCode: code, childSignal: signal, reason: failure || null, terminalReport: Boolean(report?.finishedAt), exitCode: process.exitCode,
  }, null, 2) + '\n');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(`parent-${signal}`));
