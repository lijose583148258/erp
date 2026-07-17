# CloudNativePG HA Drill Adapter

`cnpg-ha-adapter.cjs` implements the automatic HA adapter protocol for a
CloudNativePG cluster.

It discovers the writer from the cluster's Kubernetes Lease, confirms the
`cnpg.io/instanceRole=primary` label and zone, then injects failure by deleting
the primary Pod with `--wait=false`. It never runs `kubectl cnpg promote`.
CloudNativePG must elect the replacement itself.

## Requirements

- A CloudNativePG cluster with at least three Ready instances.
- Instances placed across at least two
  `topology.kubernetes.io/zone` values.
- The default primary isolation check remains enabled.
- The drill identity may get Pods, Nodes, and Leases and delete Pods only in a
  dedicated staging namespace. Kubernetes RBAC cannot restrict deletes by label;
  use a dedicated namespace and, where available, an admission policy that
  permits deletion only for `cnpg.io/cluster=<configured cluster>`.
- `CNPG_NAMESPACE`, `CNPG_CLUSTER`, and optionally
  `HA_ADAPTER_STATE_DIR` are configured.

Use it as the `--postgres-adapter` argument documented in
`HA_ADAPTER_PROTOCOL.md`. The adapter stores only the synthetic primary Pod
identifier, zone, and injection timestamp; it stores no database credentials.


## Redis Kubernetes adapter

`redis-kubernetes-ha-adapter.cjs` works with an operator or StatefulSet that
dynamically labels the current master and replicas. It deliberately does not
receive a Redis password or invoke `SENTINEL FAILOVER`.

Configure:

- `REDIS_K8S_NAMESPACE`
- `REDIS_DATA_SELECTOR` for every Redis data Pod
- `REDIS_MASTER_SELECTOR` for the operator-maintained current-master label
- `REDIS_REPLICA_SELECTOR` for the operator-maintained replica label
- `REDIS_SENTINEL_SELECTOR` for Sentinel voter Pods

The selectors must reflect runtime roles; static chart labels are not valid
evidence. The adapter requires at least two Ready data Pods across two zones and
three Ready Sentinel voters across three zones. Data Pod identities must be
stable so the deleted former master can be proven Ready with the replica label
after recovery.

Use a dedicated staging namespace and an admission policy to restrict Pod
deletion. The ERP runner independently proves post-failover session creation
and cross-instance readback, so a label change alone cannot pass the drill.


## Distributed MinIO Kubernetes adapter

`minio-kubernetes-object-adapter.cjs` implements the formal object-storage
failover operations for a distributed MinIO StatefulSet or operator deployment.
It discovers Ready data pods and their zones from Kubernetes, requires at least
four Ready pods across two zones, removes one preferred pod without touching its
PVC, waits for the controller to recreate it, and records private per-injection
state.

Configure:

- `MINIO_K8S_NAMESPACE`
- `MINIO_K8S_SELECTOR` for MinIO data pods only
- `MINIO_K8S_ALLOW_POD_DELETE=true` only during the approved pilot drill
- optionally `MINIO_K8S_MIN_READY`, `MINIO_K8S_STATE_DIR`, and
  `MINIO_K8S_TIMEOUT_MS`

The drill identity needs get/list access to Pods and Nodes, delete access only
to MinIO data Pods in a dedicated pilot namespace, and no PVC delete permission.
Kubernetes RBAC cannot constrain Pod deletion by label, so use a dedicated
namespace plus an admission policy for the configured selector. The adapter
does not prove erasure coding by itself: the formal runner's post-isolation ERP
download and SHA-256 comparison remain mandatory data-durability evidence.


## Tempo, Alertmanager, and receipt-store adapter

`tempo-alert-receipt-adapter.cjs` implements the formal observability protocol
without shelling out. It queries Tempo through
`GET /api/traces/<traceID>`, submits and resolves the synthetic alert through
Alertmanager `POST /api/v2/alerts`, and obtains delivery evidence from an
independent receiver audit store.

Configure:

- `OBS_ADAPTER_TEMPO_URL`
- `OBS_ADAPTER_ALERTMANAGER_URL`
- `OBS_ADAPTER_RECEIPT_URL`
- `OBS_ADAPTER_TEMPO_TOKEN_FILE`
- `OBS_ADAPTER_ALERTMANAGER_TOKEN_FILE`
- `OBS_ADAPTER_RECEIPT_TOKEN_FILE`
- optionally `OBS_ADAPTER_SERVICE_NAME`, `OBS_ADAPTER_STATE_DIR`, and
  `OBS_ADAPTER_TIMEOUT_MS`

All URLs must use HTTPS; loopback HTTP is accepted only by the isolated
contract. Token files must be private to the runner identity. The receipt store
must expose `GET /v1/alerts/<drill-id>` and
`GET /v1/alerts/<drill-id>/resolution`, returning only delivery metadata.
Alertmanager acceptance is deliberately not treated as receiver delivery.


## CloudNativePG backup and isolated restore adapter

`cnpg-backup-adapter.cjs` creates an on-demand CloudNativePG `Backup`
resource, waits for CNPG and an independent object-store receipt to agree,
then creates a one-instance recovery cluster in a dedicated namespace. The
restored primary is queried with `psql` for the synthetic customer marker
before cleanup. A CNPG `Completed` phase alone is not accepted as encryption
or checksum evidence.

Configure:

- `CNPG_BACKUP_NAMESPACE`, `CNPG_BACKUP_CLUSTER`, and
  `CNPG_BACKUP_RECOVERY_NAMESPACE`
- `CNPG_BACKUP_RESTORE_TEMPLATE_FILE`, based on
  `cnpg-backup-restore-template.example.json`
- `CNPG_BACKUP_RECEIPT_URL` and private
  `CNPG_BACKUP_RECEIPT_TOKEN_FILE`
- `CNPG_BACKUP_ALLOW_RESOURCE_CREATION=true` only for the approved drill
- optionally `CNPG_BACKUP_METHOD`, `CNPG_BACKUP_PLUGIN_NAME`,
  `CNPG_BACKUP_DATABASE`, and marker table/column settings

The receipt service must expose
`GET /v1/cnpg/backups/<namespace>/<backup-id>` and return the exact backup and
cluster identities, `encrypted: true`, `checksumVerified: true`, a supported
checksum algorithm, completion time, and recovery point. Keep the recovery
object store read-only and pre-provision referenced credentials in the recovery
namespace. The restore template is rejected if it enables a WAL-archiver plugin,
preventing an audit restore from writing into the source archive.

Use CloudNativePG 1.27 or later with the Barman Cloud CNPG-I plugin. The adapter
follows the official [CNPG Backup API](https://cloudnative-pg.io/docs/1.27/cloudnative-pg.v1/)
and [Barman recovery model](https://cloudnative-pg.io/plugin-barman-cloud/docs/0.7.0/concepts/).


## Meilisearch multi-zone and CSI recovery adapter

`meilisearch-kubernetes-search-adapter.cjs` treats Meilisearch as two
independently served indexes, not as a native distributed database. The ERP
indexing path must keep both instances synchronized. During the formal drill the
adapter removes one serving pod, proves the application and surviving provider
still return the same order, waits for controller recovery, creates a Meilisearch
dump, and snapshots the source PVC only after the dump task succeeds.

Configure:

- `MEILI_K8S_NAMESPACE`, `MEILI_K8S_RECOVERY_NAMESPACE`, and
  `MEILI_K8S_SELECTOR`
- `MEILI_K8S_DATA_VOLUME_NAME` and a CSI `MEILI_K8S_SNAPSHOT_CLASS` whose
  deletion policy is `Retain`
- private `MEILI_K8S_ENDPOINT_MAP_FILE` and `MEILI_K8S_TOKEN_FILE`
- `MEILI_K8S_RESTORE_URL_TEMPLATE` containing `{restoreId}`, and optionally
  `MEILI_K8S_DUMP_SUBPATH` when dumps are not under `dumps/`
- digest-pinned `MEILI_K8S_RESTORE_IMAGE` and a pre-provisioned recovery
  secret named by `MEILI_K8S_RESTORE_SECRET`
- `MEILI_K8S_ALLOW_POD_DELETE=true` and
  `MEILI_K8S_ALLOW_RESOURCE_CREATION=true` only during an approved drill

The source snapshot and its `VolumeSnapshotContent` must both be Ready and
Retain-backed. For namespace isolation, the adapter creates a pre-provisioned
`VolumeSnapshotContent` bound to a new `VolumeSnapshot` in the recovery
namespace instead of relying on alpha cross-namespace PVC references. The
snapshot is mounted read-only only to obtain the completed `.dump`; Meilisearch
imports that dump into a separate empty data PVC. The restored deployment
disables service-account token mounting, uses a digest-pinned image, and must
pass health, marker, and exact document-count checks before cleanup. See the official Kubernetes
[VolumeSnapshot model](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)
and Meilisearch [dump task API](https://specs.meilisearch.dev/specifications/text/0105-dumps-api.html/).


## Contract test

`adapter-contract.test.cjs` creates an isolated fake `kubectl` executable and
simulates three zones, primary deletion, automatic role movement, and former
primary rejoin for both adapters. It never connects to a cluster.

```bash
node ops/production/kubernetes/adapters/adapter-contract.test.cjs
```

GitHub Actions runs this contract without installing npm packages or starting
containers. It validates adapter state transitions only; it does not replace
the disruptive real-cluster drill or ERP application write/readback evidence.
