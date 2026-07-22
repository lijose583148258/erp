# Enterprise Pilot Runbook

## Scope

This runbook covers the controlled Windows pilot topology. Runtime data stays under the ASCII-only root `C:\AilaoDaPostgresRehearsal`; the source checkout may remain in a Unicode path.

## Topology

- Application: ports 5006 and 5008, shared PostgreSQL and Sentinel-discovered Redis.
- Pilot API rate envelope: 10,000 requests per 15-minute shared window so the 2,000-request HA load gate and its preflight traffic do not self-throttle. AI retains its separate per-user limit. Recalculate the production API limit from real tenant and ingress capacity.
- PostgreSQL: primary 55432, streaming hot standby 55433.
- Redis-compatible sandbox: primary 6380, replica 6381, Sentinels 26379-26381 with quorum 2.
- Object storage: MinIO primary 9000 and secondary 9010; application uploads require two successful writes in the pilot.
- Search: Meilisearch primary 7700 and dump-restored recovery node 7710; reads fail over before Prisma fallback.
- Observability: Prometheus 9090, Grafana 3001, OTLP HTTP 4318, Collector metrics 8888.

## Start

```powershell
npm run build:backend:postgres-server-artifact
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-enterprise-sandbox-v1.ps1
```

Each launched app instance writes matching PID and owner records under the isolated runtime `run/` directory. A later start only terminates a listener when its PID, owner record, artifact root, Node executable, and server entrypoint all match; an occupied port without that evidence aborts the launch instead of stopping an unrelated process.

Do not rebuild `output/postgres-server-artifact` while an application process is running from that directory. Windows locks the Prisma query-engine DLL.

## Gates

```powershell
npm run audit:ha:postgres-replication
npm run audit:ha:postgres-promotion
npm run audit:ha:redis-replication
npm run audit:ha:cross-host-manifest
npm run audit:modules:data-linkage
npm run audit:ai:governed-runtime
npm run audit:load:ha
npm run audit:soak:ha
npm run audit:runtime:dependency-policy
npm run audit:observability:runtime
npm run audit:pilot:enterprise
```

Evidence freshness is enforced by `audit:pilot:enterprise`: runtime/load/soak
evidence expires after 24 hours, browser evidence after 72 hours, and disruptive
failover plus static production evidence after seven days. Missing, future, or
expired timestamps fail the gate even when an old report says `passed`.

Use `npm run refresh:pilot:daily` to refresh non-destructive daily evidence in
the required order. `npm run audit:pilot:refresh:check` validates prerequisites
and prints the planned sequence without executing tests. The weekly profile
adds PostgreSQL promotion, Redis Sentinel automatic failover and controlled
failback, protected MinIO application failover, Meilisearch dump/restore, and
Meilisearch application failover. Every destructive harness restores and
rechecks the original topology before writing a passed report.

The controlled pilot uses `HA_SOAK_DURATION_MS=120000` for a fast two-minute
resource-growth check. Before unattended production, run the same gate for at
least eight hours (`HA_SOAK_DURATION_MS=28800000`) and retain the report. A
24-hour run is preferred after the first real data import.

### Low-cost cloud observation

`.github/workflows/enterprise-pilot-observation.yml` runs a one-minute smoke
segment only when observation infrastructure changes in a pull request. That
smoke proves workflow startup, generated-secret wiring, dual-instance readiness,
and evidence upload; it is not duration evidence. For pilot observation, launch
the workflow manually, select a 30-300 minute segment, and assign a stable label.
Each run uploads the soak report, service state, logs, commit, and run ID for 30
days. Start with 30 minutes; spend longer runner time only after the short segment
is green. Database, Redis, JWT, metrics, and audit-account credentials are
generated per run and masked rather than derived from the public run identifier.

GitHub-hosted segments reset the runner and service processes between runs.
Their accumulated duration is useful pilot evidence, but it is not equivalent
to one uninterrupted eight-hour or 24-hour lifetime. The unattended-production
gate still requires a continuous run on an approved persistent runner or the
real multi-node staging environment, followed by a node-loss and automatic
writer-election drill. No paid model API is required for this observation.

## Incident Boundaries

- Readiness policy: PostgreSQL and Redis are critical because the instance cannot safely authenticate or transact without them. Search, object storage, and telemetry are shared/degradable dependencies; their outage must alert and activate fallback behavior, but must not mark every application pod unready at once.

- PostgreSQL: 55433 is a live hot standby. Promotion is proven, but automatic production election is not provided by this local topology. Use Patroni plus HAProxy or managed PostgreSQL before unattended production operation.
- Cross-host application: `ops/production/kubernetes/ailaoda-ha.yaml` provides two replicas, mandatory host anti-affinity, zero-unavailable rolling updates, a disruption budget, health probes, and secret-backed external dependency configuration. Its audit is static; formal production still requires a physical node-loss drill.
- Redis: applications use Sentinel and were verified through automatic failover and controlled failback.
- MinIO: application reads fail over and writes can require two replicas. For production, use distributed MinIO across failure domains or managed S3; two processes on one Windows host do not survive host loss.
- Meilisearch: 7710 is restored from an official dump. It protects recovery and read availability but can lag the primary between dump cycles.
- AI: browser-to-external-model access is disabled. `/api/v1/ai/assist` is the only governed remote-model boundary; it enforces `ai.assistant.use`, a strict DTO, server-owned role/segment and endpoint/model/credentials, host allowlisting, timeout, audit-without-prompt, and local fallback. Legacy client `visibleCounts` hints are accepted only for compatibility and are never forwarded to an external provider. External mode remains disabled until `AI_GATEWAY_EXTERNAL_ENABLED=true`, an allowlisted host, model, and server-side secret are supplied.

## Windows Path Boundary

- Keep the source checkout in `F:\爱牢达` if desired.
- Keep PostgreSQL binaries, `PGDATA`, logs, sockets, backups, and temporary files under an ASCII-only runtime root such as `C:\AilaoDaPostgresRehearsal`.
- Both PostgreSQL rehearsal and enterprise sandbox launchers fail before process startup when an explicitly configured runtime/data path contains non-ASCII characters.
- Application language packs and database UTF-8 encoding are independent of this native Windows process-path restriction.

## Trial Stop Conditions

Stop the trial and preserve logs when any of these conditions occur:

- PostgreSQL replay stops or the standby leaves recovery unexpectedly.
- Sentinel quorum drops below two or application health reports Redis unavailable.
- Object dual-write falls below the configured minimum replica count.
- Search falls back to Prisma continuously instead of briefly during failover.
- OTLP dropped spans increase, either Prometheus application target is down, or the default credential gate accepts a release demo account.
- AI output exposes customer, contact, order, payment, supplier, formula, cost, or finance details outside the current role boundary.
