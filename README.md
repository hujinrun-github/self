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

Run the combined server after building `web/dist`:

```powershell
$env:APP_ORIGIN="http://localhost:8080"
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

Set `PORT` to override the default `8080`.

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

## Deployment Notes

Build the frontend first, then deploy the Go service with `web/dist` present beside the binary. Persist PostgreSQL separately from the app process, and persist `data/uploads/` on shared storage. Do not serve or back up `data/private_uploads/`; it only stores raw upload temp files during processing.

Use a strong one-time `ADMIN_PASSWORD` for bootstrap. After the first admin row exists, changing `ADMIN_PASSWORD` does not rotate the password.
