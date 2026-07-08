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

The repository now ships a GitHub Actions workflow at [.github/workflows/deploy.yml](/D:/MyGitProject/self/.github/workflows/deploy.yml) plus the remote orchestration scripts under [scripts/deploy](/D:/MyGitProject/self/scripts/deploy). The workflow runs CI first, uploads the current application source to `PORTFOLIO_APP_DIR`, then uses SSH to execute [remote-deploy.sh](/D:/MyGitProject/self/scripts/deploy/remote-deploy.sh) from that directory.

### First Deploy Prerequisites

1. Create the production app directory that will be stored in `PORTFOLIO_APP_DIR`. It may be empty; the deploy workflow uploads the application source on each run.
2. Create `runtime/uploads`, `runtime/private_uploads`, and `runtime/backups` under that app directory.
3. Create the dedicated PostgreSQL role and database by adapting [portfolio.sql](/D:/MyGitProject/self/scripts/deploy/bootstrap/portfolio.sql).
4. Create the MinIO bucket `portfolio-media`, then attach a least-privilege policy based on [minio-policy.json.example](/D:/MyGitProject/self/scripts/deploy/bootstrap/minio-policy.json.example).
5. Create a dedicated MinIO access key that can only `ListBucket`, `GetObject`, `PutObject`, and `DeleteObject` within `portfolio-media`.
6. Create the GitHub Environment `portfolio-production` and load the required `PORTFOLIO_*` secrets and variables before enabling `push`-based deploys.

### Required GitHub Environment Configuration

Variables:

| Name | Required | Meaning |
| --- | --- | --- |
| `PORTFOLIO_APP_DIR` | Yes | Absolute path of the application directory on the production host. The workflow uploads source files there, then executes the remote deploy script from that directory. |
| `PORTFOLIO_APP_ORIGIN` | Yes | Primary public origin for the app, for example `https://portfolio.example.com`. The server uses it for origin checks and runtime config. |
| `PORTFOLIO_APP_ORIGINS` | No | Extra allowed origins for admin/API requests, separated by commas or spaces. If omitted, the deploy script writes `APP_ORIGINS` from `PORTFOLIO_APP_ORIGIN`. |
| `PORTFOLIO_PUBLIC_BASE_URL` | Yes | Canonical public base URL used for public links, SEO metadata, sitemap URLs, and absolute URL generation. Usually the same as `PORTFOLIO_APP_ORIGIN`. |
| `PORTFOLIO_SITE_NAME` | Yes | Display name for the site, used by runtime config and metadata. Example: `Portfolio`. |
| `PORTFOLIO_ADMIN_EMAIL` | Yes | Bootstrap admin email. It is only used to create the first admin when the admin table is empty. |
| `PORTFOLIO_MEDIA_BLOB_BACKEND` | No | Media storage mode. Defaults to `local` when omitted. Set to `hybrid` when Markdown-imported media should use MinIO. |
| `PORTFOLIO_MINIO_ENDPOINT` | Required when `PORTFOLIO_MEDIA_BLOB_BACKEND=hybrid` | MinIO endpoint reachable from the app container. When MinIO is exposed on the same production host through `frps`, use `http://host.docker.internal:19000`; Compose maps that name to the host gateway. |
| `PORTFOLIO_MINIO_BUCKET` | Required when `PORTFOLIO_MEDIA_BLOB_BACKEND=hybrid` | Dedicated MinIO bucket for this project. Recommended value: `portfolio-media`. |
| `PORTFOLIO_MINIO_USE_SSL` | No | Whether the MinIO client should force TLS when the endpoint has no URL scheme. Defaults to `false`. Use `true` for HTTPS-only MinIO endpoints without an `https://` prefix. |
| `PORTFOLIO_MINIO_PREFLIGHT_NETWORK` | No | Docker network used by the temporary `minio/mc` deploy preflight container. Defaults to Docker's bridge network with `host.docker.internal:host-gateway` injected, matching the app container path. Set only for unusual network topologies. |
| `PORTFOLIO_TRANSLATION_PROVIDER` | Required only for AI translation generation | Translation provider name. Use `deepseek` when enabling automatic translation generation. Leave empty if AI translation generation is not used. |
| `PORTFOLIO_TRANSLATION_BASE_URL` | Required only for AI translation generation | Translation API base URL. For DeepSeek this is typically `https://api.deepseek.com`. |
| `PORTFOLIO_TRANSLATION_MODEL` | Required only for AI translation generation | Model name passed to the translation provider. Example: `deepseek-v4-flash`. |
| `PORTFOLIO_TRANSLATION_TIMEOUT_SECONDS` | No | Timeout for translation API calls in seconds. Defaults to `30`. |
| `PORTFOLIO_PORT_HOST` | No | Host port published by Docker Compose. Defaults to `4300`; set explicitly to avoid conflicts with other apps on the same machine. |

Secrets:

| Name | Required | Meaning |
| --- | --- | --- |
| `PORTFOLIO_SSH_HOST` | Yes | Production host used by the GitHub Actions SSH deploy step. |
| `PORTFOLIO_SSH_PORT` | No | SSH port. Use this when the server does not use the default `22`; keeping it configured explicitly is recommended. |
| `PORTFOLIO_SSH_USER` | Yes | SSH username on the production host. This user must be able to access `PORTFOLIO_APP_DIR`, run `docker compose`, and write the `runtime` directories. |
| `PORTFOLIO_SSH_PRIVATE_KEY` | Yes | Private key used by GitHub Actions to SSH into the production host. Store the private key body as the secret value. |
| `PORTFOLIO_DATABASE_URL` | Yes | PostgreSQL connection string for the `portfolio` database. When PostgreSQL is exposed on the same production host through `frps`, use `host.docker.internal`, for example `postgres://portfolio_app:<password>@host.docker.internal:19588/portfolio?sslmode=disable`. |
| `PORTFOLIO_DB_USER` | No, but recommended | Database username used by the backup commands. If omitted, the deploy script tries to parse the username from `PORTFOLIO_DATABASE_URL`. |
| `PORTFOLIO_DB_PASSWORD` | No, but recommended | Database password used by the backup commands through `PGPASSWORD`. If omitted, the deploy script tries to parse the password from `PORTFOLIO_DATABASE_URL`. |
| `PORTFOLIO_ADMIN_PASSWORD` | Yes | Bootstrap admin password. Must be at least 16 characters. After the first admin exists, changing this secret does not rotate the admin password. |
| `PORTFOLIO_SESSION_SECRET` | Yes | Secret used to sign sessions. Must be at least 32 characters and should be randomly generated. |
| `PORTFOLIO_MINIO_ACCESS_KEY` | Required when `PORTFOLIO_MEDIA_BLOB_BACKEND=hybrid` | Dedicated MinIO access key for `portfolio-media`. It should not be a high-privilege account that can access other project buckets. |
| `PORTFOLIO_MINIO_SECRET_KEY` | Required when `PORTFOLIO_MEDIA_BLOB_BACKEND=hybrid` | Secret key paired with `PORTFOLIO_MINIO_ACCESS_KEY`. |
| `PORTFOLIO_TRANSLATION_API_KEY` | Required only for AI translation generation | API key for the translation provider, such as DeepSeek. Leave unset if translation generation is disabled. |

The remote deploy script renders these `PORTFOLIO_*` values into the runtime `.env` file that the container actually reads. That keeps the GitHub Environment names isolated from other projects on the same machine.

### Release Types

- `app-only`: use this when `internal/db/migrations/*.sql` did not change. The deploy script skips the maintenance window and database backup steps.
- `migration`: use this when migration files changed, or when the production host has no recorded migration fingerprint yet. The deploy script stops `portfolio-app`, writes schema and full `pg_dump` backups into `runtime/backups`, and then continues the rollout.
- `auto`: the default. The remote deploy script compares the last recorded migration fingerprint with the uploaded source bundle; if migration files changed, it upgrades the release to `migration`.

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
