# Production Observability Runbook

## Preconditions

- Prometheus Operator CRDs and kube-state-metrics are installed.
- `ailaoda-metrics-token` contains the same bearer token mounted by the app.
- Prometheus selects the `ailaoda-app` ServiceMonitor and PrometheusRule.
- Alertmanager routes critical alerts to the staffed pilot channel.
- Metrics labels must never contain customer data, credentials, prompts, order
  numbers, contact details, or arbitrary exception text.

Apply after the application manifest:

```bash
kubectl apply -n <namespace> -f ops/production/kubernetes/observability.yaml
kubectl get servicemonitor,prometheusrule -n <namespace>
```

## First Response

| Alert family | First check | Trial action |
| --- | --- | --- |
| Target or replica unavailable | Deployment, Pods, nodes, zones, recent rollout | Stop changes; preserve events and logs; restore two Ready zones |
| HTTP 5xx or latency | Route metrics, PostgreSQL, Redis, saturation | Stop trial writes when reconciliation or critical dependency health is uncertain |
| Telemetry disabled, dropped, or queued | Collector target, exporter logs, network policy | Preserve application operation; restore export before claiming observability evidence |
| Cache or search degradation | Redis quorum, Meilisearch endpoints, fallback rate | Keep fallback bounded; stop trial if database load or stale search exceeds the approved envelope |
| Object storage quorum or read failure | Endpoint health, write quorum, fallback reads | Stop document uploads on write-quorum failure; preserve metadata and reconcile every accepted upload |
| AI gateway, circuit, budget, or rate limit | Governed AI metrics and audit events | Keep local fallback active; never bypass role, budget, or sensitive-data controls |
| Poor Web Vitals | Browser route and release comparison | Roll back the responsible UI release when the regression is sustained |

## Evidence

For every critical alert, retain the firing and resolved timestamps, affected
instances, trace IDs, deployment digest, operator action, reconciliation result,
and alert delivery receipt. Do not paste business payloads into the incident
record.

During staging, prove one alert-delivery path without disabling health checks or
weakening thresholds. The seven-day pilot must review alerts daily and record
false positives, missed incidents, and threshold changes.

The initial 2 percent server-error, 750 ms average-latency, and search-fallback
thresholds are admission defaults, not permanent SLOs. Recalculate them from
real pilot traffic and capacity before unattended production.
