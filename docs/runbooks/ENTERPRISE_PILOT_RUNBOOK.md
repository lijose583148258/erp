# Enterprise Pilot Runbook

## Scope

This runbook covers the controlled Windows pilot topology. Use an explicitly
selected ASCII-only runtime root; the source checkout may remain in a Unicode
path. The historical scripts default to `C:\AilaoDaPostgresRehearsal`, so always
pass `-RuntimeRoot` when the approved data location differs. The controlled
pilot was provisioned on the user's Windows host under `D:\AilaoDaPilot` on
2026-10-24. This is an ordinary persistent local directory, not an assistant-owned
server or managed cloud hosting. It needs the host to remain awake and services
to remain running; directory persistence does not prove continuous availability.
Do not reuse old data or secrets.
Confirm actual listener binding and dependency isolation before starting;
accessing a URL through `127.0.0.1` does not prove a loopback-only listener.
Keep binaries separate from persistent data. A reboot, sleep or stopped service
breaks the continuous observation window; retain evidence and restart that
window rather than adding disconnected segments together.

## Topology

The list below describes the full gate target, not a declaration that every
component is installed. The 2026-10-24 provisioning snapshot contains two app
instances, one PostgreSQL writer, Redis primary/replica plus three Sentinels,
two MinIO processes, two Meilisearch processes, and an OTLP Collector. It does
**not** yet establish PostgreSQL standby/promotion, Prometheus/Grafana, isolated
PostgreSQL backup restoration, host-reboot recovery, or the continuous 24-hour
and staged seven-day observation. Revalidate live health before every run.

- Application: ports 5006 and 5008, shared PostgreSQL and Sentinel-discovered Redis.
- Pilot API rate envelope: 10,000 requests per 15-minute shared window so the 2,000-request HA load gate and its preflight traffic do not self-throttle. AI retains its separate per-user limit. Recalculate the production API limit from real tenant and ingress capacity.
- PostgreSQL: primary 55432, streaming hot standby 55433.
- Redis-compatible sandbox: primary 6380, replica 6381, Sentinels 26379-26381 with quorum 2.
- Object storage: MinIO primary 9000 and secondary 9010; application uploads require two successful writes in the pilot.
- Search: Meilisearch primary 7700 and dump-restored recovery node 7710; reads fail over before Prisma fallback.
- Observability: Prometheus 9090, Grafana 3001, OTLP HTTP 4318, Collector metrics 8888.

## Start

For the already provisioned local pilot, retain the immutable release directory
rather than rebuilding it in place. The first pinned release is
`D:\AilaoDaPilot\releases\39f8071c6080`; its identity is recorded in
`D:\AilaoDaPilot\runtime\release.json`. This launcher starts the applications
only; it does not restart dependency services or make the host reboot-safe.

```powershell
$release = Get-Content -LiteralPath D:\AilaoDaPilot\runtime\release.json -Raw | ConvertFrom-Json
& .\scripts\start-enterprise-sandbox-v1.ps1 -RuntimeRoot D:\AilaoDaPilot -ArtifactRoot $release.releaseRoot
```

Public `/health` is intentionally minimal. The launcher uses protected
`/internal/health` and the pilot's local metrics bearer secret for detailed
dependency checks; never print that secret or commit runtime files. Use the
separate artifact `postgres-schema` only to provision an empty database. Once
the versioned migration ledger exists, apply/verify versioned migrations;
do not run `prisma db push` against the active pilot database.

The first clean-database 20-role run found a missing receipt-location fixture.
Its correction passed the procurement/QC chain, but the subsequent full run
still failed one cross-instance role read and two browser sessions. Keep these
failures open; a successful narrow probe does not close intermittent failures.
The 24-hour observation clock must not be declared started from these runs.

Release `b9615274a11b` subsequently completed all 12 steps with 20 authenticated
users and 20 browser sessions on the two local instances. Its report is
`D:\AilaoDaPilot\evidence\b961527-20-staff-audit-v1.json`; protected health checks
passed and both fresh app stderr files had no listener warning. This is one
successful replay, not closure of the earlier unexplained intermittent failure,
the separate 37-check acceptance, or duration/recovery evidence.

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
resource-growth smoke check, not production-duration evidence. Before unattended
production, run the same gate for at least 24 uninterrupted hours
(`HA_SOAK_DURATION_MS=86400000`) after the real initial data import on the approved
persistent target staging or pilot environment. Retain the release-bound report
and complete staged seven-day pilot observation with daily reconciliation and
alert review before expanding to unattended production.

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
to one uninterrupted 24-hour lifetime. The unattended-production gate requires
the continuous target-environment run and staged seven-day observation above,
plus a node-loss and automatic writer-election drill on the real target
topology. A short GitHub segment remains smoke or limited observation evidence,
not formal production admission. No paid model API is required for this
observation.

## Controlled Release Checklist

These are required operations and evidence boundaries, not a claim that they
have already been executed or that the current release is production-ready.
Use the existing release, audit, backup and deployment procedures; this checklist
does not introduce another platform or broaden the feature scope.

### Release freeze and defect decisions

During release closure, accept only fixes needed for the gates below. Defer new
features, broad refactors, dependency/platform additions and cosmetic redesign.
Do not reduce the original 20-position / 12-chain / 37-check acceptance scope.

- Release blockers: incorrect or duplicate financial effects, negative physical
  stock, wrong BOM/batch execution, QC/QA bypass, unauthorized business access,
  loss of committed facts, failure to recover safely, or a core workflow that
  cannot be completed with its intended role. These must be closed with evidence.
- Deferred defects: visual polish and optional usability improvements that do
  not change business facts, permissions or completion of the released flows.
  Record their impact and workaround; a data or permission defect is not cosmetic.
- Repeated intermittent failures stay open until evidence identifies their cause
  or proves a safe isolation. A later green replay alone does not close them.
- For each blocker, retain one owner, reproduction/evidence, affected scope and
  closure criterion in the existing acceptance record. Reuse existing runners;
  every fix replays prior key chains on the final source, not a second test system.

1. Freeze the release commit and immutable artifact. Complete the original
   20-position, 12-chain, 37-check acceptance and replay every previously accepted
   package on that same final source. A successful baseline workflow or partial
   acceptance does not replace the complete business verdict.
2. Before enabling writes, verify migration behavior, schema compatibility and
   backward compatibility with the retained previous application artifact.
   Rehearse the application rollback against the resulting schema; retain
   additive compatible columns rather than dropping data to make rollback work.
3. Restore an approved backup into an isolated target, never over the active
   writer. Reconcile actual business ledgers, including quantities, batches,
   inventory costs, receivables, payables, payment effects and immutable audit
   history; recovery of one synthetic marker is insufficient. Record the actual
   elapsed restore time (RTO) and the actual verified recovery point, and assess
   them against the agreed recovery objectives without extrapolating a universal
   zero-loss claim.
4. Start with one warehouse, one business chain and a small group of real job
   holders, then increase scope in stages only after reconciliation passes.
   During the seven-day observation, compare the ledgers daily, review alerts,
   and confirm no duplicate posting, negative physical stock or bypass of QC
   quarantine and independent QA release. Preserve each day's release identity
   and evidence; do not treat smoke traffic as real business participation.
5. If a stop condition or reconciliation mismatch occurs, stop expanding the
   pilot, pause affected new postings and preserve logs, database facts and
   request identities. After new valid vouchers have been posted, prefer rolling
   back the compatible application while retaining those facts. Never overwrite
   them with an older backup or delete posted history to obtain a clean report.
   If compatibility cannot be proved, keep affected posting paused until the
   recovery path is verified.
6. Expand only after the complete business verdict, isolated recovery,
   uninterrupted 24-hour observation, staged seven-day results and real-target
   failure drills have been reviewed together for the frozen release.

## Incident Boundaries

- Readiness policy: PostgreSQL and Redis are critical because the instance cannot safely authenticate or transact without them. Search, object storage, and telemetry are shared/degradable dependencies; their outage must alert and activate fallback behavior, but must not mark every application pod unready at once.

- PostgreSQL: the full gate expects a hot standby on 55433; it is not provisioned in the current `D:\AilaoDaPilot` snapshot. Historical promotion evidence from another runtime is not evidence for this pilot. Automatic production election is not provided by this local topology. Use Patroni plus HAProxy or managed PostgreSQL before unattended production operation.
- Cross-host application: `ops/production/kubernetes/ailaoda-ha.yaml` provides two replicas, mandatory host anti-affinity, zero-unavailable rolling updates, a disruption budget, health probes, and secret-backed external dependency configuration. Its audit is static; formal production still requires a physical node-loss drill.
- Redis: applications use Sentinel. Quorum/readiness was checked during provisioning; automatic failover and controlled failback still require release-bound evidence on this pilot.
- MinIO: application reads fail over and writes can require two replicas. For production, use distributed MinIO across failure domains or managed S3; two processes on one Windows host do not survive host loss.
- Meilisearch: 7710 is a configured secondary endpoint. Do not call it dump-restored until the dump/restore drill and read-back have been executed on this pilot. A recovery node can lag the primary between dump cycles.
- AI: browser-to-external-model access is disabled. `/api/v1/ai/assist` is the only governed remote-model boundary; it enforces `ai.assistant.use`, a strict DTO, server-owned role/segment and endpoint/model/credentials, host allowlisting, timeout, audit-without-prompt, and local fallback. Legacy client `visibleCounts` hints are accepted only for compatibility and are never forwarded to an external provider. External mode remains disabled until `AI_GATEWAY_EXTERNAL_ENABLED=true`, an allowlisted host, model, and server-side secret are supplied.

## Windows Path Boundary

- Keep the source checkout in `F:\爱牢达` if desired.
- Keep PostgreSQL binaries, `PGDATA`, logs, sockets, backups, and temporary files under the explicit ASCII-only runtime root `D:\AilaoDaPilot\postgres`.
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
