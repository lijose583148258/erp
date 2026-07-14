# Cross-host production application topology

This manifest deploys only stateless AilaoDa application nodes. PostgreSQL,
Redis Sentinel, S3-compatible object storage, Meilisearch, and OpenTelemetry
must be external HA services reachable from every cluster node.

Before applying it:

1. Replace the image placeholder with an immutable digest built from
   `Dockerfile.postgres`.
2. Create `ailaoda-runtime-secrets` and `ailaoda-metrics-token` through the
   organization secret manager. Do not commit Secret objects or plaintext.
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
`failure-domain-evidence.example.json`. Implement the non-shell provider
adapters defined in `HA_ADAPTER_PROTOCOL.md`, then run the disruptive
application-level drill before the final verifier. The verifier rejects manually
asserted PostgreSQL or Redis failover fields when the latest drill did not pass.

After the drill updates the evidence document, run:

```bash
node ops/production/kubernetes/verify-pilot-observation-evidence.cjs \
  --continuous-report <continuous-report.json> \
  --ledger <pilot-ledger.json> \
  --daily-reports-dir <daily-reports-dir> \
  --evidence <evidence.json> \
  --bind

bash ops/production/kubernetes/verify-enterprise-production-admission.sh \
  <namespace> <evidence.json> <continuous-report.json> \
  <pilot-ledger.json> <daily-reports-dir>
```

The verifier reads Kubernetes state with `kubectl` and validates the evidence
with `jq`. Evidence must come from the provider or operator drill and must not
contain credentials, connection strings, customer records, prompts, or tokens.
A passing local/single-node simulation is intentionally insufficient.


## Production alerting

`observability.yaml` adds a bearer-authenticated ServiceMonitor and alert rules
for replica availability, HTTP errors and latency, browser vitals, telemetry
drops, cache/search degradation, and governed AI fallback conditions. It
requires Prometheus Operator CRDs and kube-state-metrics. Apply it only after
the metrics token Secret exists, then follow `OBSERVABILITY_RUNBOOK.md`.


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


## Continuous observation runner

Run `run-continuous-observation.cjs` from an approved persistent runner that
can reach both staging application instances. GitHub-hosted jobs are not used
for an uninterrupted eight or 24-hour claim.

Required environment:

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
