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
