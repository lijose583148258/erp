# ADR 0015: Frontend Strict TypeScript Ratchet

## Status

Accepted

## Context

The backend TypeScript config already runs with `strict: true`, but the root frontend `tsconfig.json` remains non-strict. Flipping strict mode for the full frontend in one change would create a large mixed refactor across legacy pages, services, and generated/translated UI code.

The product still needs a hard path toward strict TypeScript because ERP state, money, workflow status, and API DTO drift are costly when type contracts are loose.

## Decision

Add `tsconfig.strict.json` as a ratcheting strict-mode gate.

- Keep the current broad `npm run typecheck` unchanged until the legacy frontend is ready.
- Add `npm run typecheck:strict` for strict checking of selected typed boundaries.
- Grow the strict include set through production-readiness boundaries: server/client state, runtime error boundaries, virtual-row math, realtime notifications, shared API contract, and generated API SDK files.
- Require new production-readiness foundations to join this strict config when practical.
- Add `scripts/frontend-strict-ratchet-audit-v1.cjs` so the ratchet cannot disappear silently.

## Consequences

The frontend now has an enforceable strict-mode foothold without pretending the entire application is strict-safe.

Future work should expand the include list route by route, then eventually move strict flags into the root `tsconfig.json` once the remaining legacy modules have been typed.
