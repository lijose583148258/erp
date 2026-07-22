# Order Import Retention Runbook

Run the task from the PostgreSQL server artifact root after schema migration verification.

## Observe first

```bash
ORDER_IMPORT_RETENTION_MODE=report-only \
node backend/dist/maintenance/order-import-retention.js
```

Review candidate counts. `linkedExpired` is intentionally retained and must not be treated as a cleanup failure.

## Enforce in bounded batches

```bash
ORDER_IMPORT_RETENTION_MODE=enforce \
ORDER_IMPORT_REPLAY_DAYS=30 \
ORDER_IMPORT_STALE_PROCESSING_DAYS=7 \
ORDER_IMPORT_PURGE_DAYS=365 \
ORDER_IMPORT_RETENTION_BATCH_SIZE=500 \
node backend/dist/maintenance/order-import-retention.js
```

Schedule one external singleton job, such as a daily Kubernetes CronJob. Do not schedule one timer per application replica. Keep the JSON output with operational evidence and alert on command failure or unexpectedly rising `staleProcessing`/`purgeable` counts.
