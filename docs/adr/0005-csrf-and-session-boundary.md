# ADR 0005: CSRF And Session Boundary

## Status

Accepted

## Context

The current web client stores access and refresh tokens in browser storage and sends API credentials with `Authorization: Bearer`. The backend does not issue authenticated cookies and does not read cookies for API authentication.

Traditional synchronizer-token CSRF protection is required when browser cookies automatically authenticate state-changing requests. Adding a fake CSRF token while the application remains Bearer-token-only would create false confidence and obscure the actual boundary.

## Decision

Keep the API authentication boundary Bearer-token-only for now.

- API authentication continues to require `Authorization: Bearer`.
- State-changing `/api` requests with an `Origin` header are accepted only from configured allowed origins.
- Token-like cookie authentication without Bearer auth is rejected.
- Responses include `X-CSRF-Protection-Mode: bearer-token-origin-boundary` so the active mode is observable.
- If the product later moves to HttpOnly cookie sessions, this ADR must be superseded by a synchronizer or double-submit CSRF token design.

## Consequences

The current release cannot accidentally become cookie-authenticated without tripping tests and audits. Browser-origin write requests are explicitly origin-bound, while non-browser API clients can continue using Bearer tokens.

This does not solve token theft from XSS. CSP hardening, avoiding inline scripts, and eventual HttpOnly session redesign remain separate security work.
