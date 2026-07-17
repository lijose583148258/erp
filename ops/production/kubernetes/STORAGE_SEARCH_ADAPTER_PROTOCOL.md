# Storage and Search Provider Adapter Protocol

Single-host MinIO and Meilisearch process-stop scripts are development evidence
only. Formal admission accepts reports produced through provider/operator
adapters against independent failure domains.

The ERP audit runner invokes adapters directly without a shell. Adapters keep
provider credentials in mounted secret files and print only the specified JSON.

## Shared safety boundary

- Run only in approved non-production staging or formal pilot.
- Failure injection must target the currently discovered primary endpoint and
  must not delete durable data.
- Recovery must not force failback.
- Isolated search restore must never overwrite the active index.
- stdout must not contain credentials, endpoint secrets, object keys, customer
  data, search documents, prompts, or restored rows.
- Provider topology must be read from the operator or managed-service control
  plane. Environment labels alone are not topology evidence.
- Endpoint IDs and failure domains must come from the provider control plane;
  adapters must not synthesize them from environment variables.

## Object storage adapter

| Operation | stdout | Required behavior |
| --- | --- | --- |
| `topology` | `{"failureDomains":["zone-a","zone-b"],"observedAt":"..."}` | Return provider-observed durable domains. |
| `discover` | `{"id":"endpoint-a","failureDomain":"zone-a"}` | Return the currently preferred endpoint. |
| `fail-primary <injection-id>` | none | Isolate the preferred endpoint without deleting objects. |
| `recover <injection-id>` | none | Reintroduce the isolated endpoint without forcing failback. |
| `recovery-status <injection-id>` | `{"recovered":true}` | Prove recovery completed. |

The application audit must upload a synthetic object through the ERP API before
injection, download it from the preferred endpoint, inject failure, download it
again through the second ERP application target, compare SHA-256 byte integrity,
and prove endpoint recovery. Its formal report uses
`scope:"formal-cross-domain"`, `providerAdapterVerified:true`, the provider
failure domains, topology timestamp, and failure injection ID.

## Search adapter

| Operation | stdout | Required behavior |
| --- | --- | --- |
| `topology` | `{"failureDomains":["zone-a","zone-b"],"observedAt":"..."}` | Return provider-observed search domains. |
| `discover` | `{"id":"search-a","failureDomain":"zone-a"}` | Return the preferred query endpoint. |
| `verify-live-query <marker-id>` | `{"found":true,"endpointId":"search-a","failureDomain":"zone-a"}` | Query the currently preferred provider endpoint directly, returning no document data. |
| `fail-primary <injection-id>` | none | Isolate the preferred query endpoint. |
| `recover <injection-id>` | none | Reintroduce the endpoint. |
| `recovery-status <injection-id>` | `{"recovered":true}` | Prove recovery completed. |
| `start-backup <marker-id>` | `{"backupId":"...","startedAt":"..."}` | Start a provider backup after verifying the marker is indexed. |
| `backup-status <backup-id>` | status JSON | Return pending/completed/failed and completed backup identity. |
| `restore-isolated <backup-id> <restore-id>` | `{"restoreId":"...","startedAt":"..."}` | Create a non-serving isolated restore target. |
| `restore-status <restore-id>` | status JSON | Return pending/completed/failed. |
| `verify-restored-query <restore-id> <marker-id>` | `{"found":true,"documentCountMatched":true}` | Verify the marker and counts without returning documents. |
| `cleanup <restore-id>` | none | Remove only the isolated restore target. |
| `cleanup-status <restore-id>` | `{"removed":true}` | Prove cleanup completed. |

The formal failover report uses `scope:"formal-cross-domain"` and must contain
both an ERP API readback and `surviving-provider-query`. The restore report uses
`scope:"formal-isolated-provider-restore"` and records
`restoreResourceId` plus `cleanupVerified:true`. Local dump copies, manually
declared zones, and database fallback alone cannot satisfy the provider-backed
failover or restore gates.

## Formal runner

Use `run-storage-search-admission-drill.cjs` with both provider adapters, the
enterprise evidence file, the hash-bound profile through
`--provider-profile <profile.json>`, a private reports directory, and
`--confirm-disruptive`. Before login or provider mutation, the runner
recomputes both adapter hashes and compares them with the approved profile.
Supply release identity, two distinct HTTPS ERP application URLs, an audit
username, and a mounted password file through the `STORAGE_SEARCH_DRILL_*`
environment variables. The runner rejects production-named environments,
writes all three reports atomically with the Profile and adapter identities,
attempts recovery and isolated-resource cleanup after failures, and binds
successful reports to enterprise evidence through the formal verifier. Final
admission compares those identities with the read-only preflight and approved
profile.
