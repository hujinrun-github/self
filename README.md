# Portfolio

React + Go personal portfolio application with PostgreSQL-backed content, admin management, media uploads, SEO metadata injection, sitemap generation, and static asset serving.

## Development

Backend tests use PostgreSQL schemas created under `TEST_DATABASE_URL`:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:<password>@localhost:5432/postgres?sslmode=disable"
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1
```

Frontend tests and build:

```powershell
cd web
npm test -- --run
npm run build
cd ..
```

Focused writing import frontend checks:

```powershell
npm --prefix web test -- src/components/markdown/MarkdownView.test.tsx src/features/admin/WritingImportDialog.test.tsx src/features/admin/AdminUI.test.tsx
cd web
npx tsc -b
cd ..
```

Run the combined server after building `web/dist`:

```powershell
$env:APP_ORIGIN="http://localhost:8080"
$env:APP_ORIGINS="http://127.0.0.1:8080,http://localhost:8080"
$env:PUBLIC_BASE_URL="http://localhost:8080"
$env:SITE_NAME="Portfolio"
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="1234567890abcdef"
$env:SESSION_SECRET="0123456789abcdef0123456789abcdef"
$env:DATABASE_URL="postgres://postgres:<password>@localhost:5432/portfolio?sslmode=disable"
$env:UPLOADS_DIR="data/uploads"
$env:PRIVATE_UPLOADS_DIR="data/private_uploads"
go run ./cmd/server
```

Set `PORT` to override the default `8080`. `APP_ORIGINS` is optional and accepts a comma-separated allowlist for additional admin origins, such as a local preview URL plus a Tailscale Funnel URL.

## Writing Markdown Import

When `MEDIA_BLOB_BACKEND=hybrid`, imported writing media is stored through MinIO while legacy image uploads can continue using the local uploads directory. Set all of the following environment variables before starting the server:

- `MINIO_ENDPOINT`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`
- `MINIO_USE_SSL`

The server now fails fast on startup if hybrid media mode is enabled but any required MinIO setting is missing.

Focused verification commands for the writing import slice:

```powershell
go test ./internal/config ./internal/db ./internal/media ./internal/content -count=1
npm --prefix web test -- src/components/markdown/MarkdownView.test.tsx src/features/admin/WritingImportDialog.test.tsx src/features/admin/AdminUI.test.tsx
cd web
npx tsc -b
cd ..
```

## Backup And Restore

Application backups contain:

- A PostgreSQL custom-format dump at `database.dump`
- The public upload derivatives under `uploads/`

`PRIVATE_UPLOADS_DIR` is not served and is not backed up. If `pg_dump` is not on `PATH`, set `PG_DUMP_PATH` before running backup tooling.

Restore flow:

1. Stop the app or enable maintenance mode.
2. Restore the PostgreSQL database with `pg_restore` using a credential source such as `PGPASSWORD` or a `.pgpass` entry.
3. Restore uploads into a temporary directory.
4. Rename the restored uploads directory into place after verification.
5. Start the app only after both the database and uploads are restored.

## SQLite Import

For one-time cutover from an existing SQLite database:

```powershell
go run ./cmd/migrate-sqlite-to-postgres --sqlite data/portfolio.db --postgres "$env:DATABASE_URL"
```

The target PostgreSQL database must already exist. The import command runs migrations, copies data in foreign-key order, skips active sessions, and resets PostgreSQL identity sequences after import.

## GitHub Auto Deploy

The repository now ships a GitHub Actions workflow at [.github/workflows/deploy.yml](/D:/MyGitProject/self/.github/workflows/deploy.yml) plus the remote orchestration scripts under [scripts/deploy](/D:/MyGitProject/self/scripts/deploy). The workflow runs CI first, then uses SSH to execute [remote-deploy.sh](/D:/MyGitProject/self/scripts/deploy/remote-deploy.sh) against the checked-out production repo at `PORTFOLIO_APP_DIR`.

### First Deploy Prerequisites

1. Check out this repository on the production host at the exact directory that will be stored in `PORTFOLIO_APP_DIR`.
2. Create `runtime/uploads`, `runtime/private_uploads`, and `runtime/backups` under that app directory.
3. Create the dedicated PostgreSQL role and database by adapting [portfolio.sql](/D:/MyGitProject/self/scripts/deploy/bootstrap/portfolio.sql).
4. Create the MinIO bucket `portfolio-media`, then attach a least-privilege policy based on [minio-policy.json.example](/D:/MyGitProject/self/scripts/deploy/bootstrap/minio-policy.json.example).
5. Create a dedicated MinIO access key that can only `ListBucket`, `GetObject`, `PutObject`, and `DeleteObject` within `portfolio-media`.
6. Create the GitHub Environment `portfolio-production` and load the required `PORTFOLIO_*` secrets and variables before enabling `push`-based deploys.

### Required GitHub Environment Configuration

Variables:

- `PORTFOLIO_APP_DIR`
- `PORTFOLIO_APP_ORIGIN`
- `PORTFOLIO_APP_ORIGINS`
- `PORTFOLIO_PUBLIC_BASE_URL`
- `PORTFOLIO_SITE_NAME`
- `PORTFOLIO_ADMIN_EMAIL`
- `PORTFOLIO_MEDIA_BLOB_BACKEND`
- `PORTFOLIO_MINIO_ENDPOINT`
- `PORTFOLIO_MINIO_BUCKET`
- `PORTFOLIO_MINIO_USE_SSL`
- `PORTFOLIO_TRANSLATION_PROVIDER`
- `PORTFOLIO_TRANSLATION_BASE_URL`
- `PORTFOLIO_TRANSLATION_MODEL`
- `PORTFOLIO_TRANSLATION_TIMEOUT_SECONDS`
- `PORTFOLIO_PORT_HOST`

Secrets:

- `PORTFOLIO_SSH_HOST`
- `PORTFOLIO_SSH_PORT`
- `PORTFOLIO_SSH_USER`
- `PORTFOLIO_SSH_PRIVATE_KEY`
- `PORTFOLIO_DATABASE_URL`
- `PORTFOLIO_DB_USER`
- `PORTFOLIO_DB_PASSWORD`
- `PORTFOLIO_ADMIN_PASSWORD`
- `PORTFOLIO_SESSION_SECRET`
- `PORTFOLIO_MINIO_ACCESS_KEY`
- `PORTFOLIO_MINIO_SECRET_KEY`
- `PORTFOLIO_TRANSLATION_API_KEY`

The remote deploy script renders these `PORTFOLIO_*` values into the runtime `.env` file that the container actually reads. That keeps the GitHub Environment names isolated from other projects on the same machine.

### Release Types

- `app-only`: use this when `internal/db/migrations/*.sql` did not change. The deploy script skips the maintenance window and database backup steps.
- `migration`: use this when migration files changed, or when the production host has no recorded deployed SHA yet. The deploy script stops `portfolio-app`, writes schema and full `pg_dump` backups into `runtime/backups`, and then continues the rollout.
- `auto`: the default. The workflow compares the currently recorded deployed SHA to `GITHUB_SHA`; if migration files changed, it upgrades the release to `migration`.

Treat the first production rollout as `migration`, even when using `workflow_dispatch`, so the host captures a known-good backup baseline.

### Maintenance Window And Backup Expectations

- `migration` releases intentionally freeze writes by stopping `portfolio-app` before the backup starts.
- The script expects either `pg_dump` on the remote host or a working Docker fallback so it can emit both schema-only and full PostgreSQL backups.
- `MEDIA_BLOB_BACKEND=hybrid` triggers a MinIO preflight before the new container is started. If the bucket check fails, the deployment stops before the app comes back up.

Build the frontend before deployment so `web/dist` is present in the image build context. Persist PostgreSQL outside the application container, persist `runtime/uploads`, and do not serve or back up `runtime/private_uploads`; it only stores processing scratch files.

Use a strong one-time `ADMIN_PASSWORD` for bootstrap. After the first admin row exists, changing `ADMIN_PASSWORD` does not rotate the password.

### Rollback Paths

1. Rollback path A: use this for `app-only` releases or backward-compatible schema changes. Check out the last known-good commit on the server, rebuild, and rerun the deploy workflow.
2. Rollback path B: use this for incompatible migration failures. Keep the app stopped, prefer a forward fix if possible, and restore from the latest `runtime/backups/*-schema.sql` or `runtime/backups/*-full.dump` only when a database rollback is truly required.
