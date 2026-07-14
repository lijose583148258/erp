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
bash ops/production/kubernetes/verify-enterprise-production-admission.sh \
  <namespace> <evidence.json>
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
