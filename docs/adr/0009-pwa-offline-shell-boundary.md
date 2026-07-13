# ADR 0009: PWA Offline Shell Boundary

## Status

Accepted

## Context

The desktop/web client has a manifest but no active service worker. The backend previously returned `404` for `/sw.js`, which made offline support impossible even for read-only shell recovery.

ERP data is sensitive and transactional. A broad offline cache can leak API responses, serve stale approvals or receivables, and make failed writes look successful.

## Decision

Add a conservative PWA shell boundary.

- Register `/sw.js` from `public/app-pwa.js` only when service workers are available.
- Publish `public/sw.js` as a same-origin static asset.
- Cache only the app shell, generated static assets, and the offline page.
- Never cache `/api`, `/uploads`, `/metrics`, `/health`, or `/ready`.
- Do not intercept non-GET requests.
- Use network-first navigation and fall back to `public/offline.html`.
- Serve `/sw.js` with `Cache-Control: no-cache` from the backend dist server.

## Consequences

Users get a resilient installed shell and a clear offline fallback instead of a blank failure page. Business data, uploads, metrics, and health endpoints remain network-only.

Future work should define per-module offline read/write rules, stale-data labeling, conflict handling, and encrypted local persistence before any ERP record data is cached offline.
