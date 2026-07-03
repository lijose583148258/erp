# Isolated Parallel Playwright Runner

This runner is the browser execution foundation for ERP/CRM audits. It runs route-level Playwright checks in isolated worker processes and writes stable JSON evidence.

It intentionally does not implement the full commercial ERP/CRM UI/UX audit. Commercial scoring, ERP table judgment, form UX scoring, and dangerous-action product review are follow-up work that should reuse this runner.

## What It Does

- Runs headless Chromium through Playwright.
- Splits validated route definitions across isolated Node worker processes.
- Gives each worker its own Chromium persistent profile.
- Gives each worker its own writable output directory.
- Captures screenshots, console errors, page errors, failed requests, and HTTP 4xx/5xx responses.
- Supports optional `sandbox-runtime` wrapping.
- Writes per-worker `report.json` files and one aggregate `parallel-report.json`.

## Isolation Model

Each worker owns this directory:

```text
output/playwright/isolated-parallel/<runId>/worker-<n>/
```

Inside that directory the worker writes:

```text
worker-config.json
stdout.log
stderr.log
report.json
screenshots/
user-data/
```

The Chromium `userDataDir` must live inside the worker output directory. This is deliberate: a sandbox runtime can grant the repository as read-only and grant only that worker output directory as writable.

## Usage

Start the stable ERP runtime first:

```powershell
npm run start:stable
```

Run the isolated browser audit:

```powershell
npm run test:browser:isolated:parallel
```

## Environment Variables

```text
APP_URL=http://127.0.0.1:5001/
ISOLATED_PLAYWRIGHT_WORKERS=4
ISOLATED_PLAYWRIGHT_WORKER_TIMEOUT_MS=240000
ISOLATED_PLAYWRIGHT_ROUTES_FILE=scripts/audit-routes/example-routes.cjs
ISOLATED_PLAYWRIGHT_FAIL_ON_CONSOLE_ERRORS=1
ISOLATED_PLAYWRIGHT_FAIL_ON_HTTP_FAILURES=1
```

Login variables:

```text
PLAYWRIGHT_USERNAME=ui_isolated_parallel_admin
PLAYWRIGHT_PASSWORD=AuditSmoke12345!
```

The runner creates per-worker audit users from those credentials through `scripts/lib/ui-audit-user.cjs`. It avoids default demo credentials in release mode.

## Route Files

If `ISOLATED_PLAYWRIGHT_ROUTES_FILE` is unset, the runner loads:

```text
scripts/lib/isolated-playwright-routes.cjs
```

External route files are opt-in:

```powershell
$env:ISOLATED_PLAYWRIGHT_ROUTES_FILE = 'scripts/audit-routes/commercial-erp-crm-routes.cjs'
npm run test:browser:isolated:parallel
```

The route file may export either:

```js
module.exports = routes;
```

or:

```js
module.exports.routes = routes;
```

Route schema:

```js
{
  id: 'dashboard',
  hash: '#dashboard',
  title: 'Dashboard',
  expected: ['Dashboard', '仪表盘'],
  category: 'smoke',
  severity: 'error',
  tags: ['core', 'navigation'],
  viewport: null
}
```

Validation fails before workers start if:

- `id` is missing, empty, or duplicated.
- `hash` is missing or does not begin with `#`.
- `expected` is empty.
- `severity` is not `info`, `warning`, `error`, or `blocker`.
- `tags` is not an array of strings.
- `viewport` is not `null` or a positive `{ width, height }` object.

## Sandbox Runtime

Set `SANDBOX_RUNTIME_COMMAND` to wrap each worker.

Template style A:

```text
sandbox-runtime run --read {repo} --write {output} --net 127.0.0.1 -- {workerCommand}
```

Template style B:

```text
sandbox-runtime run --read {repo} --write {output} --net 127.0.0.1 -- {node} {workerScript} {configFile}
```

The runner substitutes only known safe values. Route data is written to `worker-config.json`; route content is never inlined into shell text.

Supported placeholders:

```text
{workerCommand}
{node}
{workerScript}
{configFile}
{repo}
{output}
{outputRoot}
{appUrl}
{workerId}
```

Invalid templates fail fast before workers start. Templates that omit `{repo}` or `{output}` produce warnings in the aggregate report.

## Reports

Aggregate report:

```text
output/playwright/isolated-parallel/<runId>/parallel-report.json
```

Per-worker report:

```text
output/playwright/isolated-parallel/<runId>/worker-<n>/report.json
```

Aggregate schema summary:

```json
{
  "schemaVersion": 1,
  "runId": "20260702T120000-12345",
  "appUrl": "http://127.0.0.1:5001/",
  "routesFile": "scripts/lib/isolated-playwright-routes.cjs",
  "workerCount": 4,
  "sandboxRuntimeEnabled": false,
  "status": "passed",
  "summary": {
    "routesTotal": 8,
    "routesPassed": 8,
    "routesFailed": 0,
    "workersPassed": 4,
    "workersFailed": 0,
    "findingsBySeverity": {
      "info": 0,
      "warning": 0,
      "error": 0,
      "blocker": 0
    }
  },
  "workers": [],
  "routes": [],
  "failures": []
}
```

Exit code is `0` only when workers complete and there are no failed `error` or `blocker` route results. Warning-only route findings do not fail the runner unless future strict warning policy is added.

## Negative Tests

These commands should fail quickly with clear errors:

```powershell
$env:ISOLATED_PLAYWRIGHT_WORKERS = '0'; npm run test:browser:isolated:parallel
$env:ISOLATED_PLAYWRIGHT_WORKERS = 'abc'; npm run test:browser:isolated:parallel
$env:ISOLATED_PLAYWRIGHT_WORKER_TIMEOUT_MS = '1000'; npm run test:browser:isolated:parallel
$env:SANDBOX_RUNTIME_COMMAND = 'sandbox-runtime run --read {repo} --write {output}'; npm run test:browser:isolated:parallel
```

Use a temporary invalid route file to verify route schema fail-fast behavior.

## Using This For Commercial ERP/CRM UI Audits

The commercial audit should provide its own external route file through `ISOLATED_PLAYWRIGHT_ROUTES_FILE` and then layer ERP/CRM-specific checks on top of the isolated execution evidence.

This runner is responsible for isolation, browser execution, screenshots, failure capture, and machine-readable reports. It is not responsible for visual maturity scoring or product judgment.

## Artifact Hygiene

Generated artifacts stay under:

```text
output/playwright/isolated-parallel/
```

Do not commit:

```text
output/
reports/
screenshots/
logs/
*.db
*.sqlite
node_modules/
dist/
backend/dist/
```
