# Browser UI/UX Audit v2

This audit is a local Playwright gate for product-grade ERP usability checks. It focuses on deterministic layout, interaction, accessibility, and runtime signals instead of pixel-perfect visual baselines.

## What It Checks

- desktop, tablet, and mobile viewport coverage
- route discovery plus explicit route overrides
- document and element horizontal overflow
- visible page title, main landmark, and navigation landmark
- button, link, and form-field accessible names
- click target size on desktop and mobile
- keyboard focus sequence sanity
- safe menu/dropdown opening
- safe search empty-state rendering
- table overflow behavior on mobile
- tiny text and clipped text heuristics
- visible mojibake-like text
- console errors, page errors, failed requests, and HTTP 4xx/5xx responses

The audit does not submit, save, approve, delete, cancel, or perform destructive business actions.

## Command

```powershell
npm run test:browser:ui-ux
```

Route-pinned run:

```powershell
$env:UI_UX_AUDIT_ROUTES = '#dashboard,#crm,#orders,#production,#warehouse,#procurement,#financeAnalytics,#team'
npm run test:browser:ui-ux
```

Strict warning gate:

```powershell
$env:UI_UX_AUDIT_FAIL_ON_WARNINGS = '1'
npm run test:browser:ui-ux
```

## Environment Variables

| Variable | Default | Purpose |
|---|---:|---|
| `APP_URL` | `http://127.0.0.1:5001/` | ERP app base URL |
| `AUDIT_ADMIN_USERNAME` | `ui_ux_audit_admin` | Audit login username |
| `AUDIT_ADMIN_PASSWORD` | `AuditSmoke12345!` | Audit login password |
| `UI_UX_AUDIT_ROUTES` | empty | Comma-separated forced route list |
| `UI_UX_AUDIT_MAX_ROUTES` | `30` | Maximum discovered routes |
| `UI_UX_AUDIT_TIMEOUT_MS` | `120000` | Whole audit timeout |
| `UI_UX_AUDIT_PAGE_TIMEOUT_MS` | `15000` | Per route/viewport timeout |
| `UI_UX_AUDIT_FAIL_ON_WARNINGS` | `0` | Exit non-zero on warnings |
| `UI_UX_AUDIT_FAIL_ON_CONSOLE_ERRORS` | `1` | Treat console/page errors as audit errors |
| `UI_UX_AUDIT_IGNORE_CONSOLE_PATTERN` | empty | Regex for noisy console messages |
| `UI_UX_AUDIT_IGNORE_HTTP_PATTERN` | empty | Regex for noisy network URLs |
| `UI_UX_AUDIT_SCREENSHOT_MODE` | `fullPage` | `fullPage` or `viewport` |
| `UI_UX_AUDIT_TRACE_ON_FAILURE` | `0` | Reserved for trace capture |
| `UI_UX_AUDIT_REDUCED_MOTION` | `1` | Force reduced motion and short animations |
| `UI_UX_AUDIT_COLOR_SCHEME` | `light` | `light`, `dark`, or `both` |

Invalid numeric, boolean, enum, or regex values fail fast with a clear setup error.

## Artifacts

Each run writes to:

```text
output/ui-ux-audit/<runId>/
```

Required artifacts:

- `report.json`
- `report.md`
- `summary.txt`
- `screenshots/<routeId>/<viewportId>/<stateId>.png`
- `failures/<routeId>/<viewportId>/<stateId>-failure.png`
- `raw/<routeId>/<viewportId>/<stateId>-dom.json`

Reports are written with atomic file replacement. The script keeps auditing later routes when one route or viewport fails, then exits by policy at the end.

## Failure Policy

The process exits with code `1` when:

- setup/login/browser launch fails
- no route can be audited
- any `error` finding exists
- warnings exist and `UI_UX_AUDIT_FAIL_ON_WARNINGS=1`

Warnings-only runs exit `0` by default.

## Interpreting Results

Use `report.md` first for a quick product review. Use `report.json` when a failing gate needs exact route, viewport, state, selector, bounding box, or screenshot metadata.

Common high-priority failures:

- `VISIBLE_MOJIBAKE_TEXT`: source copy or runtime bundle contains garbled text.
- `DOCUMENT_HORIZONTAL_OVERFLOW`: page content leaks outside viewport.
- `CONTROL_MISSING_NAME` or `FIELD_MISSING_NAME`: the UI is hard to operate with assistive tech and brittle for automated tests.
- `MOBILE_CLICK_TARGET_TOO_SMALL`: touch use is unreliable.
- `HTTP_OR_REQUEST_FAILURE`: page rendering depends on failed API or asset requests.
