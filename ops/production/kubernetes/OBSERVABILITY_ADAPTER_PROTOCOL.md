# Observability Admission Adapter Protocol

The ERP runner owns release identity, Prometheus and application probes, and
enterprise evidence. The adapter owns trace-backend lookup and one real
Alertmanager delivery route. The runner invokes the adapter directly without a
shell.

## Safety boundary

- Run only in approved non-production staging or formal pilot.
- The runner requires `--confirm-alert-delivery`.
- The alert must be synthetic, carry only the drill ID, and use the reviewed
  pilot notification route. It must not contain customer data, prompts,
  credentials, payloads, or incident details.
- Trace lookup accepts only 32-character hexadecimal trace IDs already produced
  by the HA drill.
- stdout contains only the specified JSON. Credentials and receiver URLs remain
  in the adapter's secret-backed configuration.
- Resolution must remove only the synthetic alert created by this drill.

## Operations

| Operation | stdout | Required behavior |
| --- | --- | --- |
| `trace <trace-id>` | `{"found":true,"service":"ailaoda-erp-crm","spanCount":2,"observedAt":"..."}` | Query the production-like trace backend, not application logs. |
| `send-alert <drill-id>` | `{"sentAt":"..."}` | Submit a synthetic alert through the real Alertmanager route. |
| `alert-receipt <drill-id>` | receipt JSON | Return `pending` or `delivered`; delivered output includes `receiptId`, `receiver`, and `deliveredAt`. |
| `resolve-alert <drill-id>` | none | Resolve the synthetic alert. |
| `resolution-receipt <drill-id>` | receipt JSON | Return `pending` or `delivered`; delivered output includes `resolvedAt`. |

A trace ID in an HTTP response is not sufficient evidence by itself. Every
PostgreSQL and Redis failover trace ID must be found in the configured tracing
backend. Likewise, an Alertmanager API acceptance response is not a delivery
receipt; the adapter must query the actual pilot receiver or audited delivery
store.
