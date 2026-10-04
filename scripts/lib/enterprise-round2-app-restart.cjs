const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const exec = promisify(execFile);

async function restartIsolatedApps(urls, signal, onKilled = async () => {}) {
  assert.equal(process.env.ROUND2_ALLOW_MUTATIONS, 'true');
  assert(urls.length === 2 && urls.every(url => new URL(url).hostname === '127.0.0.1'));
  const startedAt = new Date().toISOString(); let control;
  if (process.env.ROUND2_APP_CONTROL_URL) {
    const url = new URL(process.env.ROUND2_APP_CONTROL_URL); assert.equal(url.hostname, '127.0.0.1');
    const operation = async endpoint => {
      const result = await fetch(`${url.origin}${endpoint}`, { method: 'POST',
      headers: { authorization: `Bearer ${process.env.ROUND2_APP_CONTROL_TOKEN}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
      });
      assert.equal(result.status, 200); return result.json();
    };
    control = await operation('/kill'); assert.equal(control.killed, 2);
    try { await onKilled(); } finally { Object.assign(control, await operation('/start')); }
    assert.equal(control.restarted, 2);
  } else {
    // Never restart a caller-provided PID/project/service. Only the owned
    // GitHub ephemeral compose with its exact image tag can take this path.
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.env.AILAODA_IMAGE_TAG, process.env.GITHUB_RUN_ID);
    assert(/^\d+$/.test(process.env.GITHUB_RUN_ID || ''));
    assert.deepEqual(urls.map(url => new URL(url).port), ['5006', '5008']);
    const root = path.resolve(__dirname, '../..');
    assert.equal(path.resolve(root, process.env.COMPOSE_FILE || ''), path.join(root, 'ops/cloud-sandbox/docker-compose.yml'));
    const services = ['app-primary', 'app-secondary'];
    const docker = args => exec('docker', args, { cwd: root, timeout: 60000, windowsHide: true, signal });
    const ids = (await docker(['compose', 'ps', '-q', ...services])).stdout.trim().split(/\s+/);
    assert.equal(ids.length, 2); assert(ids.every(id => /^[a-f0-9]{12,64}$/.test(id)));
    const inspected = JSON.parse((await docker(['inspect', ...ids])).stdout);
    for (const item of inspected) {
      assert.equal(item.Config.Image, `ailaoda-enterprise-cloud:${process.env.GITHUB_RUN_ID}`);
      assert(services.includes(item.Config.Labels['com.docker.compose.service']));
      assert([root, path.join(root, 'ops/cloud-sandbox')].includes(path.resolve(item.Config.Labels['com.docker.compose.project.working_dir'])));
    }
    await docker(['compose', 'kill', '-s', 'SIGKILL', ...services]);
    const dead = JSON.parse((await docker(['inspect', ...ids])).stdout);
    assert(dead.every(item => !item.State.Running && item.State.ExitCode === 137));
    try { await onKilled(); } finally { await docker(['compose', 'start', ...services]); }
    control = { killed: 2, restarted: 2, exitCodes: dead.map(item => item.State.ExitCode), signal: 'SIGKILL' };
  }
  for (const url of urls) {
    const deadline = Date.now() + 60000; let ready = false;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      try { ready = (await fetch(`${url}/ready`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) })).ok; } catch {}
      if (ready) break; await delay(300, undefined, { signal });
    }
    assert(ready, `Restart readiness failed: ${url}`);
  }
  return { startedAt, finishedAt: new Date().toISOString(), ...control, databaseRestarted: false };
}
module.exports = { restartIsolatedApps };
