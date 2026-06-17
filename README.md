# Portfolio

React + Go personal portfolio application with SQLite-backed content, admin management, media uploads, SEO metadata injection, sitemap, robots, and static asset serving.

## Development

Backend tests:

```powershell
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup
```

Frontend tests and build:

```powershell
cd web
npm test -- --run
npm run build
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
$env:DATABASE_PATH="data/portfolio.db"
$env:UPLOADS_DIR="data/uploads"
$env:PRIVATE_UPLOADS_DIR="data/private_uploads"
go run ./cmd/server
```

Set `PORT` to override the default `8080`. `APP_ORIGINS` is optional and accepts a comma-separated allowlist for additional admin origins, such as a local preview URL plus a Tailscale Funnel URL.

## Deployment Notes

Build the frontend first, then deploy the Go service with `web/dist` present beside the binary. Persist `data/portfolio.db` and `data/uploads/`. Do not serve or back up `data/private_uploads/`; it only stores raw upload temp files during processing.

Use a strong one-time `ADMIN_PASSWORD` for bootstrap. After the first admin row exists, changing `ADMIN_PASSWORD` does not rotate the password.
