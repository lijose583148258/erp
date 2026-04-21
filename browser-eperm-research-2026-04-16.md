# Browser EPERM Research and Execution Plan (2026-04-16)

## Symptom
- Browser audits fail with `PLAYWRIGHT_SPAWN_EPERM`.
- API audits can still pass, so this is not automatically a business-logic failure.

## Findings from primary references
- `EPERM` in Node indicates an OS permission/policy layer error.  
  Source: https://nodejs.org/api/errors.html
- Playwright browser launch depends on process spawn and executable access (`browserType.launch`, `executablePath`).  
  Source: https://playwright.dev/docs/api/class-browsertype
- Windows Defender Controlled Folder Access can block allowed process actions unless apps are explicitly allowed.  
  Sources:
  - https://learn.microsoft.com/en-us/defender-endpoint/enable-controlled-folders
  - https://learn.microsoft.com/en-us/defender-endpoint/customize-controlled-folders

## Execution policy now applied
1. Run spawn policy probe first (`node scripts/browser-spawn-policy-probe.cjs`).
2. Run runtime probe (`node scripts/browser-runtime-probe.cjs`).
3. If pure `spawn EPERM`, mark report as `blocked_env` (not false business failure).
4. Attach remediation steps + references into the JSON report.
5. Continue API-level audits in parallel so mainline progress does not stall.

## Recommended allow-list targets (Windows)
- `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `%LOCALAPPDATA%\ms-playwright\**`
- `node.exe`

## Exit criteria
- `node scripts/browser-spawn-policy-probe.cjs` returns `passed`
- `node scripts/browser-runtime-probe.cjs` returns `passed`
- `node scripts/production-browser-audit-v1.cjs` no longer reports `PLAYWRIGHT_SPAWN_EPERM`
- Browser audit report status becomes `passed`
