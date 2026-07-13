# ADR 0027: Distributed Auth Session and Realtime Redis Boundary

## Status

Accepted

## Context

Refresh tokens, access-token revocation, login rate limits, and WebSocket clients originally lived in one Node.js process. Restarting that process invalidated refresh sessions, while multiple application instances disagreed about logout, brute-force counters, and notification delivery.

## Decision

- Use `ioredis` as the single Redis client library.
- Store only SHA-256 token hashes in Redis.
- Consume refresh tokens atomically and bind them to a per-user session generation.
- Increment the generation after password changes to revoke every older refresh token without scanning Redis.
- Reject refresh tokens issued before the current user record update time.
- Use `rate-limit-redis` for login and API counters. Login uses a broad per-IP spray guard and a stricter `IP + normalized username hash` guard to avoid cross-account lockout behind shared NAT.
- Use Redis Pub/Sub to fan realtime events to every application instance, with an origin instance ID to avoid duplicate local delivery.
- Require Redis for `saas` deployments; local and private single-node deployments may explicitly use memory drivers.
- Include Redis in readiness and health probes.

## Consequences

Logout, refresh rotation, password-driven revocation, rate limits, and realtime signals now have consistent multi-instance semantics. Redis failure makes authentication or readiness fail closed instead of silently falling back to isolated memory state.

Redis Pub/Sub remains an advisory live channel and does not persist missed events. Durable workflow integration continues to require the webhook outbox and delivery-receipt work described separately.
