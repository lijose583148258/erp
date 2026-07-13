# ADR 0018: Frontend Client-State Store

## Status

Accepted

## Context

The app historically exposed most shell-level frontend state through a single React Context value. That kept the page API simple, but it also meant language, theme, currency, session user, notifications, command palette state, and workflow helpers were coupled to one provider value.

Server-state caching now has a separate boundary in `app/serverState.ts`, but client-owned UI/session state still needed a dedicated store so the app can gradually move away from all-tree Context updates.

## Decision

Introduce Zustand as the frontend client-state library and add `app/clientState.ts`.

- Store shell-level client state: bootstrapping flag, login flag, language, theme, currency, notifications, command palette visibility, and current user.
- Keep `AppContext` as a compatibility facade for existing pages while `useAppShell` consumes the Zustand store internally.
- Keep server data fetching in `app/serverState.ts`; the client-state store must not become an API response cache.
- Cover `app/clientState.ts` with `tsconfig.strict.json`.
- Add `scripts/frontend-client-state-audit-v1.cjs` to prevent returning to a Context-only shell state boundary.

## Consequences

The frontend now has a real client-state store boundary and can migrate high-churn consumers from broad Context reads to focused store selectors over time.

This is not a full state-management rewrite. Existing modules still use `useAppContext`, and future work should move performance-sensitive consumers to direct selectors route by route.
