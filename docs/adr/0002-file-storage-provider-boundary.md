# ADR 0002: File Storage Provider Boundary

Date: 2026-07-08

## Status

Accepted

## Context

Contract attachments and shipping POD files were written directly to the local upload directory from business controllers/services. That kept the current desktop/local runtime simple, but it made container restarts, object storage migration, and access-policy review harder because file paths were embedded in workflow code.

## Decision

Introduce a `FileStorageProvider` boundary in the backend and route contract/POD writes and protected downloads through it.

The first provider is `LocalFileStorageProvider`, selected by `FILE_STORAGE_DRIVER=local` or the default unset value. `S3FileStorageProvider` is available for S3-compatible storage such as MinIO through `FILE_STORAGE_DRIVER=s3` or `FILE_STORAGE_DRIVER=minio`.

The S3/MinIO provider uses AWS Signature V4, keeps the stable protected `/uploads/...` URL contract, and downloads objects into a namespace-scoped `.s3-cache` under the configured upload directory before `sendFile`. Unsupported drivers fail fast at startup instead of silently falling back to local disk.

The stable compatibility URL contract remains:

- `/uploads/contracts/:filename`
- `/uploads/pod/:filename`

Those routes stay authenticated and permission-gated. They resolve files through the storage provider rather than public static serving.

## Consequences

The current package remains compatible with local and desktop deployments.

S3 or MinIO can be enabled without rewriting contract or shipping workflow code.

The database still stores URL-style references for compatibility. A future migration can add provider/key metadata columns if object storage needs signed URLs, bucket routing, retention policies, or cross-region replication.

## Verification

- `npm run audit:storage:abstraction`
- `npm --prefix backend test -- --runTestsByPath src/services/file-storage.service.test.ts`
