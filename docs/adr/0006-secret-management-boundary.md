# ADR 0006: Secret Management Boundary

## Status

Accepted

## Context

The runtime currently reads secrets from environment variables. That is acceptable for local and private deployments, but production readiness needs one auditable boundary for secret quality, placeholder rejection, and future external secret-manager integration.

JWT signing was the highest-risk immediate secret because a weak or placeholder `JWT_SECRET` can mint valid business tokens.

## Decision

Introduce `backend/src/security/secretManagement.ts` as the backend secret boundary.

- JWT signing secrets are resolved through `getJwtSecret`.
- Production requires a configured non-placeholder `JWT_SECRET` of at least 32 characters.
- Non-production runtimes may use a process-local ephemeral JWT secret when no secret is configured.
- Health details expose only secret metadata such as source, configured state, length, and quality issues; the secret value is never returned.
- Future Vault, cloud Secret Manager, or SOPS integration must plug into this boundary instead of being read directly by business modules.

## Consequences

Production weak-secret failure is centralized and testable. Local development remains easy, but restart-invalidated ephemeral tokens are explicit and observable.

This does not replace a real external secret manager. It creates the seam required to adopt one without scattering provider-specific code across auth, AI, email, storage, and integrations.
