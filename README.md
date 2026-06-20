# AilaoDa ERP+CRM

AilaoDa ERP+CRM is an enterprise management system for sales orders, CRM, warehouse, procurement, production, finance, team accounts, permissions, audit logs, backup, and local stable packaging.

## Repository Status

This repository is the source repository. Release zip files are only artifacts and must not replace source review.

The local Windows package is intended for pilot testing on Windows. Linux, Docker, and cloud deployment require a separate deployment profile and must pass the deployment gates in `docs/DEPLOYMENT.md`.

## Main Commands

```powershell
npm ci
npm --prefix backend ci
npm run prisma:validate
npm run typecheck
npm run build:backend
npm run build
npm run test
```

## Release Rule

Stable package creation is blocked unless the Git working tree is clean. A valid release must have:

- clean Git status
- frontend build passed
- backend build passed
- Prisma schema validation passed
- default credential release gate passed
- generated SHA256
- `SOURCE_MANIFEST.json` with `sourceDirtyCount = 0`

## Runtime Data

Do not store business runtime data inside the program package. Runtime database, uploads, backups, and logs must live outside the package so upgrades and rollbacks do not overwrite business data.
