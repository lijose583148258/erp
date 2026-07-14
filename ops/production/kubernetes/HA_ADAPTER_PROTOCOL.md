# Automatic HA Drill Adapter Protocol

This protocol lets the provider or database operator own disruption commands
while the ERP audit owns application-level verification. The runner invokes an
adapter as an executable file with one operation argument. It does not use a
shell.

## Safety boundary

- Run only in an approved staging or formal-pilot environment.
- The runner rejects environment names containing `prod` and requires
  `--confirm-disruptive`.
- `fail-primary` must only isolate or stop the current primary. It must not
  issue a manual promote, Sentinel FAILOVER, or provider force-failover command.
  Promotion must be performed by the configured automatic HA controller.
- `recover` must restore the isolated member without forcing the writer back.
- Never print credentials, connection strings, tokens, customer data, or
  prompts. Adapter stdout is persisted as evidence.
- Keep stderr for operator diagnostics. stdout must contain only the specified
  JSON for JSON operations.

## Operations

Each PostgreSQL and Redis adapter implements:

| Operation | stdout | Required behavior |
| --- | --- | --- |
| `topology` | `{"failureDomains":["zone-a","zone-b"]}` | Report independent domains. Redis must report at least three. |
| `discover` | `{"id":"writer-a","failureDomain":"zone-a"}` | Return the currently observed writer/master. |
| `fail-primary` | none | Isolate the discovered primary and return after injection is accepted. |
| `recover` | none | Reintroduce the isolated member without forcing failback. |
| `old-primary-status` | `{"rejoinedAsReplica":true}` | Prove the old primary is healthy as a replica. |

The Redis adapter may add `sentinelCount` to the `topology` response.

## Runner

Pre-create a dedicated audit account with only login, customer-create, and
customer-read permissions. Supply credentials through the process environment,
not command arguments:

```bash
HA_DRILL_ENVIRONMENT=formal-pilot \
HA_DRILL_CHANGE_TICKET=CHG-12345 \
HA_DRILL_APP_URLS=https://erp-a.example.com,https://erp-b.example.com \
HA_DRILL_USERNAME=ha_audit \
HA_DRILL_PASSWORD_FILE=/run/secrets/ha-audit-password \
node ops/production/kubernetes/run-automatic-ha-drill.cjs \
  --confirm-disruptive \
  --evidence evidence.json \
  --postgres-adapter /opt/ha-adapters/postgres \
  --redis-adapter /opt/ha-adapters/redis
```

The runner updates only PostgreSQL and Redis sections of the evidence document.
Backup restore, object storage, search, observability, long observation, AI, and
human approvals remain separate gates.
