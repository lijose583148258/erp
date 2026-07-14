# Backup Restore Drill Adapter Protocol

The ERP backup drill owns the synthetic application marker and evidence. The
database provider adapter owns backup and isolated recovery operations. The
runner invokes the adapter directly without a shell.

## Safety boundary

- Run only in an approved non-production staging or formal-pilot environment.
- The runner requires `--confirm-resource-creation` and rejects environment
  names containing `prod`.
- Recovery must create an isolated database or cluster. Never restore over the
  active writer.
- Adapter stdout contains only the specified JSON. Never print credentials,
  connection strings, object-store URLs, customer data, or restored rows.
- The marker ID is synthetic and may be passed as an adapter argument.
- `cleanup` must remove only the restore resource created by this drill.

## Operations

| Operation | stdout | Required behavior |
| --- | --- | --- |
| `start-backup <marker-id>` | `{"backupId":"...","startedAt":"..."}` | Start a backup after the ERP marker commit. |
| `backup-status <backup-id>` | status JSON | Return `pending`, `completed`, or `failed`; completed output includes `completedAt`, `recoveryPointAt`, `checksumVerified:true`, and `encrypted:true`. |
| `restore-isolated <backup-id> <restore-id>` | `{"restoreId":"...","startedAt":"..."}` | Create an isolated restore target. |
| `restore-status <restore-id>` | status JSON | Return `pending`, `completed`, or `failed`; completed output includes `completedAt` and `recoveredThroughAt`. |
| `verify-marker <restore-id> <marker-id>` | verification JSON | Return `found:true` and `schemaCompatible:true` without returning row data. |
| `cleanup <restore-id>` | none | Remove the isolated restore target. |
| `cleanup-status <restore-id>` | `{"removed":true}` | Prove cleanup completed. |

All timestamps are UTC ISO-8601 instants. `recoveryPointAt` is the provider's
durable recovery point covered by the completed backup. `recoveredThroughAt`
is the recovery point actually materialized in the isolated target. Both must
be at or after the application marker commit.

The report keeps three concepts separate:

- `backupCompletionSeconds`: local elapsed time from requesting the backup
  until the provider reports completion.
- `verifiedMarkerRpoSeconds`: zero only after both provider recovery-point
  timestamps cover the committed marker and the marker is read back.
- `restoreRtoSeconds`: local elapsed time from requesting isolated recovery
  until the restored target is ready.

These fields prove recovery of the marker selected for this drill. They do not
claim a universal production RPO, PITR window, or restore throughput beyond the
tested provider backup and recovery path.

CloudNativePG recovery must bootstrap a new cluster from the selected Backup or
object-store archive. It must not use in-place recovery.
