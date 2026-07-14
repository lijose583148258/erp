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
