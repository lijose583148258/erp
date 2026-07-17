# AilaoDa ERP+CRM

AilaoDa ERP+CRM is an ERP and CRM system covering sales, customers, warehouse, procurement, production, finance, permissions, audit, backup, search, observability, and governed AI assistance.

> **Release status:** the repository is preparing for formal enterprise pilot use. The current GitHub Release is a **Windows local pilot package**, not a production or SaaS release. Enterprise deployment must pass the PostgreSQL, HA, backup, observability, load, security, and pilot-admission gates documented in this repository.

## Download

| Need | Entry |
| --- | --- |
| Clone the source repository | `git clone https://github.com/lijose583148258/erp.git` |
| Download the `main` source ZIP | [Download source ZIP](https://github.com/lijose583148258/erp/archive/refs/heads/main.zip) |
| Download a Windows local pilot package | [GitHub Releases](https://github.com/lijose583148258/erp/releases) |
| View the latest published release | [Latest release](https://github.com/lijose583148258/erp/releases/latest) |
| Enterprise deployment documentation | [Deployment guide](docs/DEPLOYMENT.md) |
| Formal pilot runbook | [Enterprise pilot runbook](docs/runbooks/ENTERPRISE_PILOT_RUNBOOK.md) |

The Releases page currently contains packages published on 2026-06-20. Check the release date, source commit, SHA-256, and `SOURCE_MANIFEST.json` before running one. A Release package may be older than the current repository source.

## Choose A Path

| Path | Intended audience | Database | Entry URL |
| --- | --- | --- | --- |
| Development | Contributors and source review | SQLite by default | <http://127.0.0.1:3000/> |
| Windows local pilot | Controlled single-machine evaluation | SQLite | <http://127.0.0.1:5001/> |
| Enterprise deployment | Authorized server or Kubernetes pilot | PostgreSQL + Redis | Deployment-specific HTTPS URL; local compose uses <http://127.0.0.1:5001/> |

Do not use the Windows package as a Linux, Docker, or production server artifact.

## Requirements

| Component | Version or requirement |
| --- | --- |
| Windows | Windows 10/11 x64 for the local launcher and packaging scripts |
| Git | A current Git version with HTTPS access to GitHub |
| Node.js | **22.x recommended**; the legacy SQLite container baseline also supports Node 20 |
| npm | The npm version bundled with the selected Node.js release; use `npm ci` |
| PowerShell | Windows PowerShell 5.1 or PowerShell 7+ |
| Docker | Docker Engine 24+ or current Docker Desktop with **Docker Compose v2** |
| PostgreSQL | **16** for the committed production compose profile; PostgreSQL 17 is supported only by the separate Windows rehearsal procedure |
| Redis | 7.4 for the committed PostgreSQL compose profile |
| Browser | Current Chrome, Edge, or another modern Chromium browser |

The PostgreSQL application image uses Node 22. The root SQLite Dockerfile remains on Node 20, so do not infer a production database profile from that legacy image.

## Development

### 1. Get the source

```powershell
git clone https://github.com/lijose583148258/erp.git
Set-Location erp
```

Without Git:

1. Open [the source ZIP](https://github.com/lijose583148258/erp/archive/refs/heads/main.zip).
2. Extract it to a writable directory.
3. Open PowerShell in the extracted directory.

### 2. Install dependencies

```powershell
npm ci
npm --prefix backend ci
```

Do not replace `npm ci` with an unreviewed dependency upgrade.

### 3. Create the development environment file

```powershell
Copy-Item .env.production.example .env
```

Edit the root `.env` and set at least:

```dotenv
NODE_ENV=development
AILAODA_DEPLOYMENT_MODE=local
PORT=5001
DATABASE_URL=file:./runtime-data/stable.db
JWT_SECRET=replace-with-a-random-secret-of-at-least-32-characters
CORS_ORIGIN=http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5001,http://localhost:5001
AILAODA_BLOCK_DEMO_CREDENTIALS=1
VITE_API_BASE_URL=/api
VITE_API_ABSOLUTE_URL=/api
VITE_USE_MOCK=false
AI_GATEWAY_EXTERNAL_ENABLED=false
```

Never commit `.env`, passwords, API keys, database dumps, or runtime data. Keep external AI disabled unless a separately approved provider configuration exists.

### 4. Prepare the database and first administrator

```powershell
npm --prefix backend run db:manage -- prepare

$env:AILAODA_ADMIN_USERNAME = "your-admin-name"
$env:AILAODA_ADMIN_PASSWORD = "replace-with-a-unique-password-of-at-least-12-characters"
$env:AILAODA_ADMIN_EMAIL = "admin@example.com"
npm --prefix backend run db:manage -- bootstrap-admin
```

There is no supported default production login. Published demo passwords are blocked before a production token is issued. Store the administrator password in an approved password manager and clear temporary shell variables when finished:

```powershell
Remove-Item Env:AILAODA_ADMIN_PASSWORD -ErrorAction SilentlyContinue
```

### 5. Start development

One Windows command:

```powershell
npm run dev:all
```

Or use two terminals:

```powershell
npm run dev:backend
```

```powershell
npm run dev
```

Open:

- Frontend: <http://127.0.0.1:3000/>
- Backend health: <http://127.0.0.1:5001/health>
- Backend readiness: <http://127.0.0.1:5001/ready>
- OpenAPI documentation: <http://127.0.0.1:5001/api/v1/docs>

## Windows Local Pilot

1. Open [GitHub Releases](https://github.com/lijose583148258/erp/releases).
2. Select the required Windows local pilot release.
3. Verify its published SHA-256 and `SOURCE_MANIFEST.json`.
4. Extract the package to a writable directory.
5. Create `.env.production` from `.env.production.example`.
6. Create the first administrator with the `bootstrap-admin` command shown above.
7. Run `稳定启动.bat`.
8. Open <http://127.0.0.1:5001/>.

The launcher requires Node.js and npm to be available on `PATH`. Runtime data should live outside the extracted package, normally under `D:\AilaoDaRuntime` or an explicitly configured writable location. Do not run directories marked `DO_NOT_RUN.txt` or archived `*_previous_*` packages.

Stop the local runtime with:

```powershell
npm stop
```

## Enterprise Deployment

The shortest committed PostgreSQL + Redis rehearsal path is:

```powershell
Copy-Item .env.production.example .env
```

Set strong, unique values in `.env`:

```dotenv
POSTGRES_DB=ailaoda
POSTGRES_USER=ailaoda
POSTGRES_PASSWORD=replace-with-a-strong-database-password
REDIS_PASSWORD=replace-with-a-different-strong-redis-password
JWT_SECRET=replace-with-a-random-secret-of-at-least-32-characters
CORS_ORIGIN=https://your-approved-domain.example
AILAODA_HTTP_PORT=5001
```

Build and start:

```powershell
docker compose -f docker-compose.production-postgres.yml up -d --build
docker compose -f docker-compose.production-postgres.yml ps
```

Create the first administrator inside the application container:

```powershell
docker compose -f docker-compose.production-postgres.yml exec -e AILAODA_ADMIN_USERNAME=your-admin-name -e AILAODA_ADMIN_PASSWORD=replace-with-a-unique-password-of-at-least-12-characters -e AILAODA_ADMIN_EMAIL=admin@example.com ailao-app node backend/dist/database/manage-db.cli.js bootstrap-admin
```

Then check:

- Application: <http://127.0.0.1:5001/>
- Liveness: <http://127.0.0.1:5001/livez>
- Readiness: <http://127.0.0.1:5001/ready>
- Health: <http://127.0.0.1:5001/health>

This compose profile is a deployment rehearsal, not proof of enterprise production readiness. Before formal use, complete [the deployment guide](docs/DEPLOYMENT.md), [the formal pilot runbook](docs/runbooks/ENTERPRISE_PILOT_RUNBOOK.md), backup/restore validation, HA drills, load reconciliation, 8-24 hours of continuous observation, and seven consecutive pilot-day reviews.

## Verification

Before submitting source changes:

```powershell
npm run prisma:validate
npm run typecheck
npm run typecheck:strict
npm run build:backend
npm run build
npm run test:unit:frontend
npm --prefix backend test
```

The broader pilot and browser audit suites are intentionally separate because they require more time and runtime dependencies.

## Common Problems

### `npm ci` fails

- Confirm `node --version` is Node 22.x, or Node 20.x for the legacy SQLite path.
- Confirm `npm --version` works in the same terminal.
- Run `npm cache verify`.
- Keep both lockfiles: `package-lock.json` and `backend/package-lock.json`.
- Do not delete lockfiles or switch package managers to hide dependency errors.

### Port 3000 or 5001 is already in use

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,5001
npm stop
```

The launcher refuses to terminate unrelated processes. Stop the owning application manually or change the configured port.

### Environment variables are not loaded

- Put `.env` or `.env.production` in the repository root.
- Check that the file is not named `.env.txt`.
- Restart the backend after editing it.
- For Docker Compose, confirm required variables are present with `docker compose ... config`; do not publish that output because it may contain secrets.

### Login fails on the first run

Do not try `admin/admin123` or other demo passwords. Run:

```powershell
$env:AILAODA_ADMIN_USERNAME = "your-admin-name"
$env:AILAODA_ADMIN_PASSWORD = "a-unique-password-of-at-least-12-characters"
npm --prefix backend run db:manage -- bootstrap-admin
```

Then restart the application and sign in with the new administrator.

### Prisma or database preparation fails

```powershell
npm run prisma:validate
npm --prefix backend run prisma:generate
npm --prefix backend run db:manage -- prepare
```

Confirm the SQLite runtime directory is writable and outside `backend/prisma`. For native PostgreSQL rehearsal on Windows, keep PostgreSQL binaries and data under an ASCII-only path such as `C:\AilaoDaPostgresRehearsal`; adding a language pack does not fix `initdb` path handling.

### Docker Compose refuses to start

The compose files intentionally reject missing passwords and secrets. Set the required values in the root `.env`, confirm Docker Compose v2 is available, and run:

```powershell
docker compose version
docker compose -f docker-compose.production-postgres.yml config --services
```

### The page is blank or appears outdated

- Confirm the health endpoint returns HTTP 200.
- For the stable source path, rebuild with `npm run build` and `npm run build:backend`.
- Hard-refresh the browser.
- Confirm that an archived package or another process is not serving port 5001.

### A downloaded package does not match the repository

Compare the release SHA-256, packaged source commit, GitHub tag, and `SOURCE_MANIFEST.json`. Do not overwrite repository source with a ZIP artifact and do not treat a Windows pilot package as a server release.

## Runtime Data

Business databases, uploads, backups, logs, secrets, and generated evidence must remain outside immutable source and application images. Upgrades and rollbacks must not overwrite runtime data.

## Security

- Never publish `.env`, tokens, passwords, API keys, or customer data.
- Do not enable demo credentials in production.
- Keep external AI disabled by default.
- Use a secret manager for server deployments.
- Report security issues privately to the repository owner instead of opening an issue containing exploit details or secrets.

## License

The backend package declares the MIT license. Add a repository-level `LICENSE` file before presenting the entire repository as MIT-licensed.
