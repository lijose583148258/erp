# Signed Production Approval Protocol

Production approval is four independent Ed25519 signatures, not free-form text.
The required roles are `platformOwner`, `databaseOwner`, `securityOwner`, and
`businessPilotOwner`. Each role uses a distinct public key whose filename and
SHA-256 are fixed in the hash-bound formal provider profile. Private keys remain
in the organization's approval or signing system and never enter the evidence
bundle, application namespace, CI variables, or repository.

Each receipt is named `<role>.json` and has this shape:

```json
{
  "payload": {
    "schemaVersion": 1,
    "role": "platformOwner",
    "issuer": "platform-approval-service",
    "approver": "employee-or-workforce-identity",
    "approvedAt": "2026-01-08T12:00:00Z",
    "environment": "formal-pilot",
    "evidenceId": "CHG-12345",
    "commitSha": "40-lowercase-hex-characters",
    "imageDigest": "sha256:64-lowercase-hex-characters",
    "evidenceCoreSha256": "64-lowercase-hex-characters",
    "decision": "approved"
  },
  "signature": "base64-ed25519-signature"
}
```

The signature input is UTF-8 JSON of the payload with every object key sorted
recursively. `evidenceCoreSha256` is SHA-256 of recursively key-sorted enterprise
evidence after deleting the top-level `approvals` field. Generate and sign the
payload only after every machine evidence binder has finished. Any later change
to the evidence invalidates all four receipts.

Place public keys in the bundle's `approvalTrustDir` and receipts in
`approvalReceiptsDir`, then bind them:

```bash
node ops/production/kubernetes/verify-production-approvals.cjs \
  --provider-profile <formal-pilot-provider-profile.json> \
  --trust-dir <approval-public-keys> \
  --receipts-dir <signed-approval-receipts> \
  --evidence <enterprise-evidence.json> \
  --bind
```

Final admission reruns signature, trust-hash, freshness, distinct-approver,
release-identity, and evidence-snapshot checks without `--bind`.
