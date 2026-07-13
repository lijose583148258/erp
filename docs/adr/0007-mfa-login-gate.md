# ADR 0007: MFA Login Gate

## Status

Accepted

## Context

Login previously depended only on username and password. For production readiness, privileged accounts need a second factor before the server issues access and refresh tokens.

The current user schema does not yet contain per-user MFA enrollment fields. A full self-service MFA rollout requires schema migration, recovery-code policy, admin reset flows, and UI settings.

## Decision

Add a backend MFA login gate as the first production-ready boundary.

- `backend/src/security/mfa.service.ts` implements TOTP verification without adding a new dependency.
- `AILAODA_MFA_REQUIRED_ROLES` configures roles that must pass MFA, such as `admin,manager`.
- `AILAODA_MFA_TOTP_SECRET` provides the shared deployment TOTP secret for the current gate.
- Password verification still happens first, but no access or refresh token is minted until MFA succeeds.
- Missing MFA code returns `MFA_REQUIRED`; invalid code returns `MFA_INVALID`.
- The login UI accepts an optional 6-digit MFA code.

## Consequences

High-privilege deployments can require a second factor immediately without waiting for a full per-user enrollment system.

This is not the final MFA model. The next version should add per-user secrets, enrollment confirmation, backup codes, admin reset, and recovery audit events.
