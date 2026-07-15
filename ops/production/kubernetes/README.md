# Cross-host production application topology

This manifest deploys only stateless AilaoDa application nodes. PostgreSQL,
Redis Sentinel, S3-compatible object storage, Meilisearch, and OpenTelemetry
must be external HA services reachable from every cluster node.

Before applying it:

1. Replace the image placeholder with an immutable digest built from
   `Dockerfile.postgres`.
2. Create `ailaoda-runtime-secrets` and `ailaoda-metrics-token` through the
   organization secret manager. When governed external AI is approved, also
   create optional `ailaoda-ai-gateway` with the `api-key` key and populate
   the endpoint, allowed-host, and model keys in `ailaoda-runtime-secrets`.
   Do not commit Secret objects or plaintext.
3. Point `DATABASE_URL` at a managed PostgreSQL writer endpoint or a
   Patroni/HAProxy writer VIP. Never list a fixed replica as the writer.
4. Provide at least three Redis Sentinel addresses in different failure
   domains, an S3 service with cross-node durability, and primary/fallback
   Meilisearch endpoints with tested dump restore.
5. Put an ingress/load balancer in front of `ailaoda-app`, terminate TLS there,
   and set the exact HTTPS origin in `cors-origin`.

The anti-affinity and topology-spread rules deliberately refuse to place both
application replicas on one host. This template does not create PostgreSQL,
Redis, MinIO, or Meilisearch clusters; their operator or managed-service
runbooks remain independently owned and tested.


## Formal failure-domain admission

The manifest requires two distinct node hostnames and two distinct
`topology.kubernetes.io/zone` values. Pods remain Pending instead of silently
collapsing both replicas into one failure domain.

After deploying to the real staging topology, create an evidence document from
`failure-domain-evidence.example.json`. Use the shipped CloudNativePG and
Redis Kubernetes adapters under `adapters/`, bind their exact SHA-256 values
into the provider profile, then run the disruptive application-level drill
before the final verifier. The verifier rejects manually
asserted PostgreSQL or Redis failover fields when the latest drill did not pass.

After the drill updates the evidence document, run:

```bash
node ops/production/kubernetes/verify-pilot-observation-evidence.cjs \
  --continuous-report <continuous-report.json> \
  --ledger <pilot-ledger.json> \
  --daily-reports-dir <daily-reports-dir> \
  --evidence <evidence.json> \
  --bind

node ops/production/kubernetes/run-enterprise-production-admission.cjs \
  --bundle <admission-bundle.json> \
  --check-only

node ops/production/kubernetes/run-enterprise-production-admission.cjs \
  --bundle <admission-bundle.json>
```

Create the bundle from `admission-bundle.example.json`. Every artifact path
must be relative, remain inside one evidence directory after symlink resolution,
and match the release identity in the main evidence file. The bundle must include
the exact formal preflight report produced against the bound provider profile.
Admission rejects reports older than 24 hours, incomplete check sets, insufficient
topology, or any adapter hash drift. `--check-only` validates this structure
without contacting Kubernetes.

The runner then calls the low-level verifier, which reads Kubernetes state with
`kubectl` and validates the evidence with `jq`. Evidence must come from the
provider or operator drill and must not contain credentials, connection strings,
customer records, prompts, or tokens. A passing local/single-node simulation is
intentionally insufficient.


## Isolated PostgreSQL backup recovery drill

Use `adapters/cnpg-backup-adapter.cjs` with the signed receipt verifier under
`receipt/`. The provider control plane must generate the signed Barman and
object-storage evidence; the ERP namespace never receives the Ed25519 signing
private key. Run the drill only against approved non-production staging or
pilot infrastructure:

```bash
BACKUP_DRILL_ENVIRONMENT=<formal-pilot> \
BACKUP_DRILL_CHANGE_TICKET=<same-as-evidence-id> \
BACKUP_DRILL_APP_URL=<https-instance-url> \
BACKUP_DRILL_USERNAME=<least-privilege-audit-user> \
BACKUP_DRILL_PASSWORD_FILE=<secret-file> \
BACKUP_DRILL_COMMIT_SHA=<40-character-git-sha> \
BACKUP_DRILL_IMAGE_DIGEST=<sha256:digest> \
node ops/production/kubernetes/run-backup-restore-drill.cjs \
  --adapter <provider-adapter> \
  --evidence <evidence.json> \
  --provider-profile <hash-bound-provider-profile.json> \
  --report <backup-report.json> \
  --confirm-resource-creation
```

Before any provider resource is created, the runner verifies the full release
identity and rechecks the bound provider profile plus backup adapter SHA-256.

The adapter must create a new isolated recovery target and remove it after
verification. The runner creates a synthetic ERP marker, verifies encrypted
backup integrity, proves that the provider recovery point covers that commit,
reads the marker from the isolated restore, checks schema compatibility, records
backup completion and restore RTO separately, and binds the report SHA-256 into
enterprise evidence. It never restores over the active writer and does not
claim a production-wide PITR objective from a single drill.

## Signed PostgreSQL backup receipts

The CNPG backup adapter accepts encryption and checksum claims only from the
read-only verifier documented in `receipt/README.md`. Deploy
`receipt/cnpg-backup-receipt-deployment.example.yaml` behind TLS or mTLS,
with two replicas, a read-only provider-populated receipt volume, a public
Ed25519 verification key, and a private bearer token. The provider signing key
must remain outside the application, admission runner, GitHub, and verifier.

For non-root Kubernetes workloads, project credential files with `0440`, set
`runAsUser`, `runAsGroup`, and `fsGroup` consistently, and keep all
other-user bits clear. A signed receipt is still not restore evidence: the
backup drill must create an isolated CNPG cluster and read the synthetic ERP
marker before admission.

## Storage and search resilience evidence

The process-stop MinIO and Meilisearch scripts are controlled single-host
sandbox evidence only and cannot pass formal admission. Use
`adapters/minio-kubernetes-object-adapter.cjs` and
`adapters/meilisearch-kubernetes-search-adapter.cjs`. The latter performs a
completed Meilisearch dump, Retain-backed CSI snapshot transport, and isolated
dump import into a new data PVC. Failure domains must be observed from the
Kubernetes control plane; environment labels alone are rejected.

Formal reports carry the same release identity, a provider topology timestamp,
failure injection identity, and `providerAdapterVerified:true`. Search recovery
must create and remove an isolated provider restore target. After the object
failover, search failover, and isolated search restore reports are created in
one directory, bind them to enterprise evidence:

```bash
node ops/production/kubernetes/verify-storage-search-evidence.cjs \
  --reports-dir <resilience-reports-dir> \
  --evidence <evidence.json> \
  --bind
```

The formal admission command reruns the verifier without `--bind`, recomputes
all three report hashes, and rejects stale reports, failed or missing checks,
release-identity drift, insufficient failure domains, missing provider adapter
proof, a non-isolated restore, cleanup failure, or any post-drill report
modification. A two-container or same-host process-stop sandbox is intentionally
insufficient.

## Production alerting

`observability.yaml` adds a bearer-authenticated ServiceMonitor and alert rules
for replica availability, HTTP errors and latency, browser vitals, telemetry
drops, cache/search degradation, and governed AI fallback conditions. It
requires Prometheus Operator CRDs and kube-state-metrics. Apply it only after
the metrics token Secret exists, then follow `OBSERVABILITY_RUNBOOK.md`.


## Trace and alert delivery admission

Use `adapters/tempo-alert-receipt-adapter.cjs` with Tempo, Alertmanager, and
an independent receiver receipt store. After the automatic HA drill has
recorded PostgreSQL and Redis failover trace IDs, run:

```bash
OBSERVABILITY_DRILL_ENVIRONMENT=<formal-pilot> \
OBSERVABILITY_DRILL_CHANGE_TICKET=<same-as-evidence-id> \
OBSERVABILITY_DRILL_COMMIT_SHA=<40-character-git-sha> \
OBSERVABILITY_DRILL_IMAGE_DIGEST=<sha256:digest> \
OBSERVABILITY_DRILL_APP_URLS=<https-app-a>,<https-app-b> \
OBSERVABILITY_PROMETHEUS_URL=<prometheus-api> \
OBSERVABILITY_COLLECTOR_METRICS_URL=<collector-metrics> \
OBSERVABILITY_METRICS_TOKEN_FILE=<secret-file> \
node ops/production/kubernetes/run-observability-admission-drill.cjs \
  --adapter <trace-alert-adapter> \
  --evidence <evidence.json> \
  --provider-profile <hash-bound-provider-profile.json> \
  --report <observability-report.json> \
  --confirm-alert-delivery
```

Before trace lookup or alert submission, the runner rechecks the release,
Provider Profile, HA trace Profile identity, and observability adapter SHA-256.

The drill requires two healthy Prometheus targets, the reviewed alert families,
no new dropped spans, a bounded exporter queue, collector acceptance, trace
backend readback for every HA request, and delivered plus resolved receipts from
the real pilot alert route. An HTTP trace header or Alertmanager acceptance
response alone cannot pass. The report hash and release identity are rebound and
rechecked by formal admission.

## Machine-bound observation

The production gate does not trust manually entered soak hours or pilot days.
`verify-pilot-observation-evidence.cjs` verifies one uninterrupted report with
at least eight hours of real elapsed time, zero network/5xx failures, p95 below
two seconds, two serving application instances, and no failed checks.

The pilot ledger must contain at least seven distinct UTC dates spanning six
full days. Every entry is bound to a daily source report by SHA-256 and requires
completed alert review, zero unreconciled business writes, resolved incidents,
and an immutable release identity. The continuous report and complete ledger
hashes are written into enterprise evidence by `--bind` and rechecked during
formal admission.


## Load and concurrency reconciliation

Use pre-created least-privilege role accounts. Supply load and role passwords
through the dedicated `*_PASSWORD_FILE` variables whenever the runner supports
mounted secrets; no concurrency account is generated by the audit.

For formal evidence, configure both scripts with the same
`ENTERPRISE_EVIDENCE_*` release identity and place their reports in one
directory using the configurable report paths. Then bind them:

```bash
node ops/production/kubernetes/verify-load-reconciliation-evidence.cjs \
  --reports-dir <load-reconciliation-reports-dir> \
  --evidence <evidence.json> \
  --bind
```

The gate requires at least 1,000 requests at concurrency 20, two application
instances, all five database/cache/search routes, zero failed requests, p95 at
or below one second, and p99 at or below two seconds. It separately requires
concurrent payment submission and verification, a reconciled paid amount, valid
payment status, and a repeated no-drift read loop. Report hashes and release
identity are rechecked during formal admission.

This is the minimum pilot envelope, not a capacity claim. Before increasing
pilot traffic, rerun with the expected peak concurrency and data volume and use
the measured saturation point for capacity planning.

## Continuous observation runner

Run `run-continuous-observation.cjs` from approved persistent cloud
infrastructure that can reach both staging application instances.
GitHub-hosted jobs are not used for an uninterrupted eight or 24-hour claim.

Build `Dockerfile.pilot-observer`, publish it under an immutable digest, replace
the observer image placeholder, and create the ConfigMap/PVC from
`formal-pilot-observation-resources.example.yaml`. Create
`ailaoda-pilot-observer` through the secret manager with `username` and
`password` keys; reuse the existing `ailaoda-metrics-token` Secret. Then
apply `formal-pilot-observation-job.yaml`. The Job has no service-account
token, runs as non-root with a read-only root filesystem, and writes only the
JSON report to `ailaoda-pilot-evidence`.

Required environment:

- `OBSERVATION_ENVIRONMENT` and `OBSERVATION_EVIDENCE_ID`
- `OBSERVATION_APP_URLS`: at least two comma-separated HTTPS instance URLs
- `OBSERVATION_USERNAME` and `OBSERVATION_PASSWORD_FILE`
- `OBSERVATION_METRICS_TOKEN_FILE`
- `OBSERVATION_COMMIT_SHA` and immutable `OBSERVATION_IMAGE_DIGEST`
- `OBSERVATION_DURATION_MS`: 28,800,000 through 86,400,000

The account needs only login and read access to dashboard, customers, and
orders. Secrets are read from files and are never written to the report. The
runner refreshes an expired JWT, samples process memory and telemetry every
minute, treats every final HTTP 4xx/5xx/429 or network failure as a failure, and
writes the continuous report consumed by the observation evidence verifier.
The report is bound to the pilot environment, evidence ID, Git commit, and
application image digest. Copy it from the evidence PVC only after the Job has
completed successfully; a partial file from a running or terminated Job cannot
pass the verifier.


## Governed external AI deployment

External AI remains disabled in the committed ConfigMap. The optional
`ailaoda-ai-gateway` Secret is mounted read-only and the backend receives only
its file path. If the Secret, endpoint, allowlist, or model is absent, the
service remains local-only.

Enabling external mode requires a reviewed ConfigMap change plus current
role-isolation, aggregate-context, output-safety, response-limit, budget,
circuit-breaker, red-team, secret-manager, and local-fallback evidence. Never
place a model credential in frontend variables, browser storage, a ConfigMap,
or a command argument.


## Security release evidence

Run the production security readiness audit with the same
`ENTERPRISE_EVIDENCE_*` identity as the release. It executes CSP, CSRF
boundary, MFA, secret handling, distributed authentication, and dependency
checks. The report retains only child-output hashes and byte counts, not raw
stdout or stderr.

Run the default-credential gate with
`AILAODA_REQUIRE_NO_DEMO_CREDENTIALS=1` against the formal pilot deployment.
Every known demonstration credential must be rejected before a token is issued.
Place both JSON reports in one directory and bind them:

```bash
node ops/production/kubernetes/verify-security-evidence.cjs \
  --reports-dir <security-reports-dir> \
  --evidence <evidence.json> \
  --bind
```

Formal admission recomputes both hashes and rejects missing controls, raw command
output in evidence, a non-strict credential run, any accepted default account,
stale evidence, or release-identity drift.

## Zero-cost governed AI pilot gate

The formal pilot keeps `AI_GATEWAY_EXTERNAL_ENABLED=false`. The internal
assistant remains usable through deterministic local guidance, while browser
credentials, provider keys, and paid model calls remain absent.

Use pre-created admin and sales audit accounts and password files. Run the
two-instance AI runtime audit plus admin, sales, and governed browser audits with
the same `ENTERPRISE_EVIDENCE_*` identity. Manually dispatch the
`AI Governance Contract` workflow against the exact release commit, download
its `ai-governance-contract-attestation` artifact, and place all five reports
in one directory:

```bash
node ops/production/kubernetes/verify-ai-evidence.cjs \
  --reports-dir <ai-reports-dir> \
  --evidence <evidence.json> \
  --bind
```

The verifier requires local-only runtime mode, two-instance shared limiting,
admin/sales browser isolation, hidden-data refusal, local fallback, prompt-free
metrics, input and output safety, response limits, redirect denial, daily
budget, shared circuit behavior, mocked provider mode, and exactly zero paid
model calls. All reports are bound to the release by SHA-256.

Enabling an external provider is a separate production change. It remains
blocked until the allowlisted gateway, secret manager, real provider red-team,
budget, circuit, privacy, output, and rollback evidence are completed; the
local-only pilot evidence cannot be reused to approve external mode.

## Daily pilot recorder

Use `record-pilot-daily-review.cjs` once per UTC day. It accepts three
metadata-only source reports: alert delivery/review, business-write
reconciliation, and incident resolution. Unsupported fields are rejected so
customer records, prompts, credentials, and incident payloads cannot be copied
into the pilot evidence bundle.

```bash
node ops/production/kubernetes/record-pilot-daily-review.cjs \
  --environment <formal-pilot> \
  --commit-sha <git-sha> \
  --image-digest <sha256:digest> \
  --date <YYYY-MM-DD> \
  --checked-at <UTC-ISO-time> \
  --continuous-report <continuous-report.json> \
  --alert-review <alert-review.json> \
  --reconciliation <reconciliation.json> \
  --incident-review <incident-review.json> \
  --daily-output <daily-reports-dir/YYYY-MM-DD.json> \
  --ledger <pilot-ledger.json>
```

The recorder canonicalizes and hashes the support reports, writes the daily
report atomically, and appends one immutable ledger entry. Replacing an existing
date requires explicit `--replace-date`; the final verifier still recomputes
every hash and rejects stale, missing, duplicate, or nonconsecutive days.

## Read-only formal pilot preflight

Before any disruptive provider drill, run the read-only preflight with the same
release identity and two distinct HTTPS application targets. It checks
provider-observed PostgreSQL, Redis Sentinel, object-storage, and search failure
domains; both application instances; cross-instance session readback; direct
provider search readback; executable backup and observability adapters; and
owner-only or current-process-group read-only password-file permissions. It
accepts Kubernetes projected Secrets with mode `0440` only when the file group
matches the runner's effective group, and still rejects group-write or any
other-user access. It does not inject failure, create a backup,
send an alert, or call an external AI provider.

```bash
FORMAL_PILOT_PREFLIGHT_ENVIRONMENT=<formal-pilot> \
FORMAL_PILOT_PREFLIGHT_EVIDENCE_ID=<same-as-evidence-id> \
FORMAL_PILOT_PREFLIGHT_COMMIT_SHA=<40-character-git-sha> \
FORMAL_PILOT_PREFLIGHT_IMAGE_DIGEST=<sha256:digest> \
FORMAL_PILOT_PREFLIGHT_APP_URLS=<https-app-a>,<https-app-b> \
FORMAL_PILOT_PREFLIGHT_USERNAME=<least-privilege-audit-user> \
FORMAL_PILOT_PREFLIGHT_PASSWORD_FILE=<private-secret-file> \
node ops/production/kubernetes/run-formal-pilot-preflight.cjs \
  --evidence <evidence.json> \
  --provider-profile <hash-bound-provider-profile.json> \
  --report <preflight-report.json> \
  --postgres-adapter <postgres-adapter> \
  --redis-adapter <redis-adapter> \
  --object-adapter <object-adapter> \
  --search-adapter <search-adapter> \
  --backup-adapter <backup-adapter> \
  --observability-adapter <observability-adapter>
```

The preflight recomputes the provider profile SHA-256 and rejects an unbound or
modified profile before contacting any disruptive adapter.

A passing preflight is only permission and topology readiness. It is not
failover, restore, alert-delivery, load, observation, or production-admission
evidence.

## Formal provider profile gate

Before creating provider-specific adapters or authorizing a disruptive drill, copy
`formal-pilot-provider-profile.example.json` into the private evidence workspace,
replace every placeholder with control-plane-observed metadata, and run:

```bash
node ops/production/kubernetes/verify-formal-pilot-provider-profile.cjs \
  <formal-pilot-provider-profile.json> \
  --evidence <enterprise-evidence.json> \
  --bind
```

The profile is metadata only. The verifier rejects secret-like fields,
production environments, fewer than three failure domains, shared application
and recovery namespaces, unencrypted or manually asserted PostgreSQL backup
integrity, insufficient Redis/MinIO topology, non-isolated search recovery,
Alertmanager acceptance without a receiver-side delivery store, paid/external
AI mode, and observations shorter than eight hours or seven pilot days. It also
binds the plain file name and lowercase SHA-256 of all six provider adapters.
The formal preflight rejects a renamed or byte-modified adapter before execution.

Use `--bind` only for the reviewed profile before drills begin. Subsequent
checks omit `--bind`; they recompute the raw profile SHA-256 and reject any
change, even when the replacement profile is otherwise valid.

A passing profile does not prove runtime readiness. It freezes the provider
contract that the read-only preflight, disruptive adapters, recovery drills, and
final evidence bundle must subsequently prove against the real control plane.

