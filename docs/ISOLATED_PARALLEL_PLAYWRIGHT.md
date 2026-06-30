# Isolated Parallel Playwright Audit

This audit runs route-level browser smoke checks in parallel while keeping each worker isolated.

Each worker gets:

- its own Node process
- its own headless Playwright persistent Chromium context
- its own temporary browser user data directory
- its own `output/playwright/isolated-parallel/<runId>/worker-*` report directory
- optional local sandbox process isolation through `SANDBOX_RUNTIME_COMMAND`

## Usage

Start the ERP stable runtime first, then run:

```powershell
npm run test:browser:isolated:parallel
```

The runner creates or refreshes a dedicated audit user through `scripts/lib/ui-audit-user.cjs`. It does not use default administrator credentials.
The default worker count is two to avoid overloading the local stable runtime. Increase `ISOLATED_PLAYWRIGHT_WORKERS` only when the machine and backend can handle more parallel browser sessions.

## Environment Variables

```powershell
$env:APP_URL = 'http://127.0.0.1:5001/'
$env:ISOLATED_PLAYWRIGHT_WORKERS = '2'
$env:ISOLATED_PLAYWRIGHT_RUN_ID = 'local-001'
npm run test:browser:isolated:parallel
```

Optional audit account override:

```powershell
$env:ISOLATED_PLAYWRIGHT_USERNAME = 'ui_isolated_parallel_admin'
$env:ISOLATED_PLAYWRIGHT_PASSWORD = 'AuditSmoke12345!'
```

## Optional Sandbox Runtime

The runner does not hard-code a sandbox CLI shape. It accepts a command template so local installs can keep their own policy syntax.

Available placeholders:

- `{workerCommand}`: quoted `node scripts/lib/isolated-playwright-worker.cjs`
- `{node}`: quoted current Node executable
- `{workerScript}`: quoted worker script path
- `{repo}`: quoted repository root
- `{output}`: quoted per-worker output directory
- `{outputRoot}`: quoted run output root
- `{appUrl}`: quoted app URL
- `{workerId}`: quoted worker id

Example:

```powershell
$env:SANDBOX_RUNTIME_COMMAND = 'sandbox-runtime run --read {repo} --write {output} --net 127.0.0.1 -- {workerCommand}'
npm run test:browser:isolated:parallel
```

Use the exact flags supported by the local sandbox runtime. Do not pass untrusted text into `SANDBOX_RUNTIME_COMMAND`.

## Reports

Aggregate report:

```text
output/playwright/isolated-parallel/<runId>/parallel-report.json
```

Per-worker reports and screenshots:

```text
output/playwright/isolated-parallel/<runId>/worker-*/report.json
output/playwright/isolated-parallel/<runId>/worker-*/*.png
```
