# Signed CloudNativePG Backup Receipts

The formal backup drill does not trust a CloudNativePG `Backup` phase or an
application-written Boolean as proof of encryption and integrity. A provider
control-plane collector must inspect the Barman catalog and object-store
metadata, hash the backup manifest, and sign the resulting claims with an
Ed25519 private key held outside the ERP application namespaces.

`cnpg-backup-receipt-service.cjs` has only the public verification key. It
serves a receipt only when all of the following are true:

- the envelope signature verifies over the exact payload bytes;
- namespace, backup ID, cluster, object-store backup ID, and issuer are present;
- encryption and checksum claims are both true;
- the manifest SHA-256 is valid;
- completion, recovery-point, and issuance times are ordered and fresh;
- the receipt file is not writable by group or other users.

The service never accepts writes or signing requests. The receipt directory is
mounted read-only, and the signing private key must never be stored in the
verifier Deployment, ERP application, admission runner, GitHub secret, or
repository.

## Envelope format

The provider pipeline writes
`<namespace>--<backup-id>.json`:

```json
{
  "schemaVersion": 1,
  "payload": "<base64url of exact UTF-8 JSON claims>",
  "signature": "<base64url Ed25519 signature over decoded payload bytes>"
}
```

The decoded payload contains exactly:

```json
{
  "namespace": "ailaoda-pilot",
  "backupId": "ailaoda-backup-id",
  "cluster": "ailaoda-db",
  "objectStoreBackupId": "barman-backup-id",
  "encrypted": true,
  "checksumVerified": true,
  "checksumAlgorithm": "barman-manifest",
  "manifestSha256": "<64 lowercase hex characters>",
  "completedAt": "2026-07-15T02:01:00.000Z",
  "recoveryPointAt": "2026-07-15T02:01:05.000Z",
  "issuedAt": "2026-07-15T02:01:10.000Z",
  "issuer": "provider-backup-control-plane"
}
```

The provider collector owns how these claims are established. For the Barman
Cloud CNPG-I plugin, use the completed CNPG Backup identity, Barman catalog
identity, object-provider encryption metadata, and the SHA-256 of the retrieved
backup manifest. Do not generate a receipt from the example JSON or from
operator-entered values.

## Deployment

Start from `cnpg-backup-receipt-deployment.example.yaml` and replace every
placeholder. Requirements:

- two verifier replicas across failure domains;
- a digest-pinned image containing this script;
- a private bearer token and Ed25519 public key in
  `ailaoda-cnpg-receipt-verifier`;
- an RWX or ROX volume populated atomically by the provider collector and
  mounted read-only by the verifier;
- TLS or mTLS at the service mesh/ingress boundary;
- a NetworkPolicy that admits only the formal admission runner.

The adapter uses:

```text
GET /v1/cnpg/backups/<namespace>/<backup-id>
Authorization: Bearer <private verifier token>
```

The health endpoint carries no backup data and does not require authentication.
The receipt endpoint returns `401` for authentication failure and `422` for
invalid, stale, writable, or unverifiable evidence.

The model follows CloudNativePG's
[Barman Cloud plugin](https://cloudnative-pg.io/plugin-barman-cloud/docs/0.7.0/concepts/)
and Barman's
[backup manifest](https://docs.pgbarman.org/release/3.16.0/user_guide/configuration.html)
semantics. A passing isolated contract proves verification behavior only; the
formal pilot still requires a provider-generated signed receipt and successful
isolated marker restore.
