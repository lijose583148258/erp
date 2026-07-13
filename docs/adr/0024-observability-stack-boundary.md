# ADR 0024: Observability Stack Boundary

## Status

Accepted.

## Context

The backend exposes protected Prometheus metrics and browser Web Vitals RUM metrics. That is useful, but production operators also need a repeatable way to scrape, visualize, and alert on those signals.

Mature stacks such as Grafana LGTM separate application instrumentation from observability runtime provisioning. The ERP should keep `/metrics` permission-protected while still making Prometheus/Grafana rehearsal reproducible.

## Decision

Add an optional `observability` Docker Compose profile:

- `prometheus` scrapes `ailao-app:5001/metrics`
- Prometheus uses `AILAODA_METRICS_BEARER_TOKEN` through `--config.expand-env`
- `grafana` provisions the Prometheus datasource and AilaoDa overview dashboard
- `otel-collector` receives OTLP gRPC/HTTP on 4317/4318 for future SDK exporters
- the Express runtime emits W3C `traceparent` and `X-Request-Id` headers and includes trace IDs in request logs
- alert rules cover target health, HTTP 5xx spikes, poor Web Vitals, and search-provider failures

The dashboard and rules live under `ops/`:

- `ops/prometheus/prometheus.yml`
- `ops/prometheus/rules/ailaoda-alerts.yml`
- `ops/grafana/provisioning/`
- `ops/grafana/dashboards/ailaoda-overview.json`
- `ops/otelcol/config.yml`

`npm run audit:observability:stack` verifies the stack files, protected scrape token boundary, dashboard queries, and alert rules.

## Consequences

Operators can rehearse the monitoring stack without making metrics public.

This does not complete production observability. Still required:

- real service-account token issuance and rotation
- alert notification routing
- environment-specific thresholds
- OpenTelemetry SDK spans/exporters in the application
- log aggregation backend
- long-term retention and backup policy for observability data
