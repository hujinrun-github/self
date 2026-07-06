# GitHub Auto Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a SHA-pinned GitHub Actions -> SSH -> Docker Compose deployment pipeline for the portfolio app that reuses the `all_note` host and external PostgreSQL/MinIO services while adding CI gates, hybrid-media health checks, migration-aware backups, and explicit rollback handling.

**Architecture:** Keep the current Go monolith plus React SPA as one containerized service mounted at the site root. Add testable runtime health and startup preflight primitives in Go, package the app with Docker Compose, and drive remote orchestration through small Bash scripts plus a GitHub Actions workflow. Treat releases that change `internal/db/migrations/*.sql` as a separate deployment mode that stops the running app before backup so the v1 migration path preserves RPO 0.

**Tech Stack:** Go 1.26.4, React/Vite build artifacts, PostgreSQL, MinIO, Docker Compose, GitHub Actions, Bash.

---

## File Structure

- Create `internal/db/ping.go`: open-and-ping PostgreSQL without running migrations so deploy preflight and health logic can validate connectivity safely.
- Create `internal/db/ping_test.go`: coverage proving ping-only checks do not create `schema_migrations` or mutate an empty database.
- Modify `internal/db/db.go`: reuse shared validation logic while keeping `Open(...)` as the migrate-on-start path.
- Create `internal/media/blobstore_health.go`: shared blob-store round-trip probe for hybrid media health checks.
- Create `internal/media/blobstore_health_test.go`: unit tests for successful probes, read failures, and cleanup behavior.
- Modify `internal/media/blobstore_minio.go`: expose enough typed access for round-trip probing while keeping the existing `BlobStore` API unchanged.
- Create `internal/health/service.go`: `/api/health` status builder plus JSON response helper.
- Create `internal/health/service_test.go`: health success/failure coverage for database and MinIO dependency checks.
- Create `internal/health/startup.go`: startup preflight that fails fast when hybrid MinIO access is broken.
- Create `internal/health/startup_test.go`: coverage for `local` vs `hybrid` startup behavior.
- Create `cmd/server/router.go`: move top-level route assembly out of `main` so route priority and `/api/health` behavior are testable.
- Create `cmd/server/router_test.go`: verify `/api/health` is public, non-HTML, and registered before SPA fallback.
- Modify `cmd/server/main.go`: wire startup preflight, new router builder, and health dependencies.
- Create `Dockerfile`: multi-stage build for web assets plus Go binary, with a runtime image that explicitly includes `wget` for Compose health checks.
- Create `.dockerignore`: exclude local build artifacts, temp uploads, `.git`, and docs noise from image context.
- Create `docker-compose.yml`: single `portfolio-app` service, host port `4300`, persistent upload mounts, `.env` loading, and container health check.
- Create `scripts/deploy/compose_contract_test.sh`: shell contract test that asserts the Compose file exposes the expected service shape.
- Create `scripts/deploy/lib.sh`: reusable deployment helpers for release-type detection, port-owner checks, `.env` rendering, backup gating, and Compose capability detection.
- Create `scripts/deploy/lib_test.sh`: shell tests for release-type detection, `PORTFOLIO_*` to runtime env mapping, and port-ownership rules.
- Create `scripts/deploy/remote-deploy.sh`: remote deployment entrypoint used by GitHub Actions.
- Create `scripts/deploy/remote_deploy_test.sh`: mocked-command tests for SHA pinning, migration backup order, and fallback waiting logic.
- Create `scripts/deploy/workflow_contract_test.sh`: shell assertions for the GitHub Actions workflow shape and required jobs.
- Create `.github/workflows/deploy.yml`: CI-gated deployment workflow with `workflow_dispatch` release-type override and SSH execution.
- Create `scripts/deploy/bootstrap/portfolio.sql`: first-deploy PostgreSQL bootstrap template for `portfolio` and `portfolio_app`.
- Create `scripts/deploy/bootstrap/minio-policy.json.example`: bucket policy example limited to `portfolio-media`.
- Modify `README.md`: document first-deploy bootstrap, GitHub Environment secrets, migration release behavior, rollback paths, and verification commands.

## Task 1: Health Primitives And Non-Migrating DB Ping

**Files:**
- Create: `internal/db/ping.go`
- Create: `internal/db/ping_test.go`
- Modify: `internal/db/db.go`
- Create: `internal/media/blobstore_health.go`
- Create: `internal/media/blobstore_health_test.go`
- Modify: `internal/media/blobstore_minio.go`

- [ ] **Step 1: Write the failing Go tests first**

Add `internal/db/ping_test.go` coverage proving the preflight path does not run migrations:

```go
func TestPingDoesNotCreateSchemaMigrations(t *testing.T) {
	databaseURL := openFreshPostgresDatabase(t)

	if err := Ping(context.Background(), databaseURL); err != nil {
		t.Fatalf("Ping returned error: %v", err)
	}

	if tableExists(t, databaseURL, "schema_migrations") {
		t.Fatal("Ping should not create schema_migrations")
	}
}
```

Add `internal/media/blobstore_health_test.go` coverage around the MinIO/local shared probe contract:

```go
func TestCheckBlobStoreRoundTrip(t *testing.T) {
	store := &stubBlobStore{}

	if err := CheckBlobStoreRoundTrip(context.Background(), store, "_healthchecks"); err != nil {
		t.Fatalf("CheckBlobStoreRoundTrip returned error: %v", err)
	}
	if len(store.putKeys) != 1 || len(store.deletedKeys) != 1 {
		t.Fatal("expected probe object to be written and deleted exactly once")
	}
	if store.putKeys[0] != store.deletedKeys[0] {
		t.Fatal("probe object should be deleted after the round-trip check")
	}
}
```

- [ ] **Step 2: Run the tests and confirm the red phase**

Run:

```powershell
go test ./internal/db -run TestPingDoesNotCreateSchemaMigrations -count=1
go test ./internal/media -run TestCheckBlobStoreRoundTrip -count=1
```

Expected: FAIL because `Ping(...)` and `CheckBlobStoreRoundTrip(...)` do not exist yet.

- [ ] **Step 3: Implement the smallest production code that makes the tests pass**

Create `internal/db/ping.go`:

```go
func Ping(ctx context.Context, databaseURL string) error {
	database, err := open(databaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return database.PingContext(ctx)
}
```

Create `internal/media/blobstore_health.go`:

```go
func CheckBlobStoreRoundTrip(ctx context.Context, store BlobStore, prefix string) error {
	key := path.Join(prefix, uuid.NewString()+".txt")
	payload := []byte("healthcheck")

	if err := store.Put(ctx, key, bytes.NewReader(payload), "text/plain"); err != nil {
		return fmt.Errorf("put probe object: %w", err)
	}
	defer store.Delete(context.Background(), key)

	reader, err := store.Open(ctx, key)
	if err != nil {
		return fmt.Errorf("open probe object: %w", err)
	}
	defer reader.Close()

	_, err = io.ReadAll(reader)
	return err
}
```

Refactor `internal/db/db.go` so `Open(...)` and `Ping(...)` share the same URL validation and connection setup, but only `Open(...)` calls `Migrate(...)`.

- [ ] **Step 4: Return to green**

Run:

```powershell
go test ./internal/db ./internal/media -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit the slice**

Suggested commit after green:

```powershell
git add internal/db/ping.go internal/db/ping_test.go internal/db/db.go internal/media/blobstore_health.go internal/media/blobstore_health_test.go internal/media/blobstore_minio.go
git commit -m "feat(deploy): add health probe primitives"
```

## Task 2: Public `/api/health`, Hybrid Startup Preflight, And Testable Router Assembly

**Files:**
- Create: `internal/health/service.go`
- Create: `internal/health/service_test.go`
- Create: `internal/health/startup.go`
- Create: `internal/health/startup_test.go`
- Create: `cmd/server/router.go`
- Create: `cmd/server/router_test.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Write the failing handler and startup tests**

Add `cmd/server/router_test.go` to lock route priority and public access:

```go
func TestBuildRouterServesAPIHealthBeforeSPAFallback(t *testing.T) {
	router := buildRouter(routerDeps{
		HealthHandler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		}),
		SPAFallback: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("<html>spa</html>"))
		}),
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Fatalf("content-type = %q", got)
	}
}
```

Add `internal/health/startup_test.go` to lock the hybrid-only preflight rule:

```go
func TestRunStartupChecksRequiresBlobStoreProbeInHybridMode(t *testing.T) {
	err := RunStartupChecks(context.Background(), StartupConfig{
		MediaBlobBackend: "hybrid",
		BlobStoreProbe: func(context.Context) error {
			return errors.New("bucket denied")
		},
	})

	if err == nil || !strings.Contains(err.Error(), "bucket denied") {
		t.Fatalf("expected hybrid startup to fail on blob store error, got %v", err)
	}
}
```

- [ ] **Step 2: Run the tests and confirm the red phase**

Run:

```powershell
go test ./internal/health ./cmd/server -count=1
```

Expected: FAIL because the new health package, startup preflight, and router builder do not exist yet.

- [ ] **Step 3: Implement the minimum viable health path**

Create `internal/health/service.go` with a simple dependency-injected status builder:

```go
type Service struct {
	PingDatabase func(context.Context) error
	ProbeBlob    func(context.Context) error
	HybridMedia  bool
}

func (s Service) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	status := http.StatusOK
	body := map[string]any{"ok": true, "database": "ok", "media": "disabled"}

	if err := s.PingDatabase(req.Context()); err != nil {
		status = http.StatusServiceUnavailable
		body["ok"] = false
		body["database"] = err.Error()
	}
	if s.HybridMedia {
		if err := s.ProbeBlob(req.Context()); err != nil {
			status = http.StatusServiceUnavailable
			body["ok"] = false
			body["media"] = err.Error()
		} else {
			body["media"] = "ok"
		}
	}
	writeJSON(w, status, body)
}
```

Create `internal/health/startup.go`:

```go
type StartupConfig struct {
	MediaBlobBackend string
	BlobStoreProbe   func(context.Context) error
}

func RunStartupChecks(ctx context.Context, cfg StartupConfig) error {
	if cfg.MediaBlobBackend != "hybrid" {
		return nil
	}
	if cfg.BlobStoreProbe == nil {
		return fmt.Errorf("hybrid startup requires a blob store probe")
	}
	return cfg.BlobStoreProbe(ctx)
}
```

Create `cmd/server/router.go` and move top-level route registration out of `main`, making `/api/health` an explicit public route registered before the SPA catch-all.

Update `cmd/server/main.go` to:

- construct the health service with `db.Ping` and `media.CheckBlobStoreRoundTrip`
- run `health.RunStartupChecks(...)` before `http.ListenAndServe(...)`
- call `buildRouter(...)` instead of assembling routes inline

- [ ] **Step 4: Return to green and verify behavior**

Run:

```powershell
go test ./cmd/server ./internal/health -count=1
```

Then do one manual smoke check:

```powershell
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1
```

Expected: PASS, with `/api/health` now a first-class public JSON route and hybrid startup failing fast when MinIO access is broken.

- [ ] **Step 5: Commit the slice**

Suggested commit after green:

```powershell
git add internal/health cmd/server/router.go cmd/server/router_test.go cmd/server/main.go
git commit -m "feat(deploy): add public health endpoint and startup preflight"
```

## Task 3: Containerize The App And Lock The Compose Contract

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `scripts/deploy/compose_contract_test.sh`

- [ ] **Step 1: Write the failing Compose contract test first**

Create `scripts/deploy/compose_contract_test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

config="$(docker compose -f docker-compose.yml config)"

grep -F "portfolio-app:" <<<"$config" >/dev/null
grep -F "4300:8080" <<<"$config" >/dev/null
grep -F "container_name: portfolio-app" <<<"$config" >/dev/null
grep -F "wget -qO- http://127.0.0.1:8080/api/health" <<<"$config" >/dev/null
grep -F "runtime/uploads:/app/data/uploads" <<<"$config" >/dev/null
grep -F "runtime/private_uploads:/app/data/private_uploads" <<<"$config" >/dev/null
```

- [ ] **Step 2: Run the contract test and confirm the red phase**

Run:

```powershell
bash scripts/deploy/compose_contract_test.sh
```

Expected: FAIL because `docker-compose.yml` does not exist yet.

- [ ] **Step 3: Implement the smallest container setup that satisfies the contract**

Create `Dockerfile` as a multi-stage build:

```dockerfile
FROM node:24-alpine AS web-build
WORKDIR /app
COPY web/package*.json web/
RUN npm --prefix web ci
COPY web web
RUN npm --prefix web run build

FROM golang:1.26.4-alpine AS go-build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web-build /app/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/server ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=go-build /out/server /app/server
COPY --from=go-build /src/web/dist /app/web/dist
EXPOSE 8080
CMD ["/app/server"]
```

Create `docker-compose.yml` with:

- one service named `portfolio-app`
- `container_name: portfolio-app`
- `ports: - "${PORT_HOST:-4300}:8080"`
- `env_file: .env`
- upload mounts for `runtime/uploads` and `runtime/private_uploads`
- health check using `wget -qO- http://127.0.0.1:8080/api/health`

Add `.dockerignore` entries for `.git`, `.worktrees`, `data/`, `runtime/`, `node_modules`, `server-*.log`, and docs snapshots that should not bloat the build context.

- [ ] **Step 4: Return to green and validate the image locally**

Run:

```powershell
bash scripts/deploy/compose_contract_test.sh
docker compose config
docker compose build portfolio-app
```

Expected: PASS.

- [ ] **Step 5: Commit the slice**

Suggested commit after green:

```powershell
git add Dockerfile .dockerignore docker-compose.yml scripts/deploy/compose_contract_test.sh
git commit -m "feat(deploy): add container and compose assets"
```

## Task 4: Release Classification, Backup Gating, And Remote Deploy Script

**Files:**
- Create: `scripts/deploy/lib.sh`
- Create: `scripts/deploy/lib_test.sh`
- Create: `scripts/deploy/remote-deploy.sh`
- Create: `scripts/deploy/remote_deploy_test.sh`

- [ ] **Step 1: Write the failing shell tests first**

Create `scripts/deploy/lib_test.sh` with small focused checks:

```bash
#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"

test_release_type_detects_migration_diff() {
  local actual
  actual="$(resolve_release_type "$fixture_repo" "$base_sha" "$head_sha" "auto")"
  [[ "$actual" == "migration" ]]
}

test_manual_app_only_rejects_migration_diff() {
  if resolve_release_type "$fixture_repo" "$base_sha" "$head_sha" "app-only"; then
    echo "expected failure" >&2
    return 1
  fi
}

test_render_env_file_maps_portfolio_prefix() {
  local target
  target="$(mktemp)"
  PORTFOLIO_DATABASE_URL="postgres://example" \
  PORTFOLIO_MINIO_BUCKET="portfolio-media" \
    render_env_file "$target"
  grep -F "DATABASE_URL=postgres://example" "$target" >/dev/null
  grep -F "MINIO_BUCKET=portfolio-media" "$target" >/dev/null
}
```

Create `scripts/deploy/remote_deploy_test.sh` with mocked commands proving migration ordering and SHA pinning:

```bash
#!/usr/bin/env bash
set -euo pipefail

TRACE_FILE="$(mktemp)"
PATH="$(pwd)/scripts/deploy/test-bin:$PATH" \
TRACE_FILE="$TRACE_FILE" \
GITHUB_SHA="deadbeef" \
RELEASE_TYPE="migration" \
DRY_RUN=1 \
  bash scripts/deploy/remote-deploy.sh

grep -n 'git checkout --detach deadbeef' "$TRACE_FILE" >/dev/null
stop_line="$(grep -n 'docker compose stop portfolio-app' "$TRACE_FILE" | cut -d: -f1)"
dump_line="$(grep -n 'pg_dump' "$TRACE_FILE" | cut -d: -f1)"
[[ "$stop_line" -lt "$dump_line" ]]
```

- [ ] **Step 2: Run the shell tests and confirm the red phase**

Run:

```powershell
bash scripts/deploy/lib_test.sh
bash scripts/deploy/remote_deploy_test.sh
```

Expected: FAIL because the deploy library and remote script do not exist yet.

- [ ] **Step 3: Implement the smallest deploy library that satisfies the tests**

Create `scripts/deploy/lib.sh` with functions for:

- `resolve_release_type repo current_sha target_sha override`
- `compose_supports_wait`
- `assert_port_owner_ok port`
- `render_env_file target_path`
- `require_pg_dump_or_container_fallback`
- `run_schema_backup`
- `run_full_backup`

Key behavior to lock in:

- `auto` release type becomes `migration` when `internal/db/migrations/*.sql` changed
- first deploy without a current SHA is always `migration`
- manual `app-only` override must fail if migration files changed
- `.env` rendering maps `PORTFOLIO_*` GitHub secrets/vars into runtime keys like `DATABASE_URL`, `MINIO_BUCKET`, `PORT_HOST`, `APP_ORIGIN`
- port `4300` is allowed when currently owned by the existing `portfolio-app` container, and rejected only when held by another process/container

Create `scripts/deploy/remote-deploy.sh` to execute this order:

1. `git fetch --all --tags --prune`
2. `git checkout --detach "$GITHUB_SHA"`
3. detect release type
4. validate port ownership
5. detect Compose `--wait` support
6. ensure `runtime/uploads`, `runtime/private_uploads`, `runtime/backups`
7. render `.env`
8. run MinIO preflight when `MEDIA_BLOB_BACKEND=hybrid`
9. for `migration`, stop `portfolio-app` before backups
10. `docker compose config`
11. `docker compose build`
12. `docker compose up -d --remove-orphans --wait` or fallback polling loop
13. emit `docker compose ps` and recent logs

- [ ] **Step 4: Return to green**

Run:

```powershell
bash scripts/deploy/lib_test.sh
bash scripts/deploy/remote_deploy_test.sh
```

Expected: PASS.

- [ ] **Step 5: Commit the slice**

Suggested commit after green:

```powershell
git add scripts/deploy
git commit -m "feat(deploy): add migration-aware remote deploy scripts"
```

## Task 5: GitHub Actions Workflow With CI Gates And SHA-Pinned Remote Deploy

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `scripts/deploy/workflow_contract_test.sh`

- [ ] **Step 1: Write the failing workflow contract test first**

Create `scripts/deploy/workflow_contract_test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

workflow=".github/workflows/deploy.yml"

grep -F "workflow_dispatch:" "$workflow" >/dev/null
grep -F "release_type:" "$workflow" >/dev/null
grep -F "needs: ci" "$workflow" >/dev/null
grep -F "go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1" "$workflow" >/dev/null
grep -F "npm --prefix web test -- --run" "$workflow" >/dev/null
grep -F "npm --prefix web run build" "$workflow" >/dev/null
grep -F 'git checkout --detach "$GITHUB_SHA"' "$workflow" >/dev/null
grep -F "appleboy/ssh-action" "$workflow" >/dev/null
```

- [ ] **Step 2: Run the contract test and confirm the red phase**

Run:

```powershell
bash scripts/deploy/workflow_contract_test.sh
```

Expected: FAIL because `.github/workflows/deploy.yml` does not exist yet.

- [ ] **Step 3: Implement the workflow**

Create `.github/workflows/deploy.yml` with:

- `on.push.branches: [main]`
- `on.workflow_dispatch.inputs.release_type` with values `auto`, `app-only`, `migration`
- `ci` job using PostgreSQL service for Go integration tests
- `deploy` job that `needs: ci`
- GitHub Environment isolation for `production`
- SSH execution that exports `GITHUB_SHA`, `RELEASE_TYPE`, `PORTFOLIO_*` secrets/vars, then runs `bash scripts/deploy/remote-deploy.sh`

Use the repository's existing green commands:

```bash
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1
npm --prefix web test -- --run
npm --prefix web run build
```

- [ ] **Step 4: Return to green and lint the workflow**

Run:

```powershell
bash scripts/deploy/workflow_contract_test.sh
docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest
```

Expected: PASS.

- [ ] **Step 5: Commit the slice**

Suggested commit after green:

```powershell
git add .github/workflows/deploy.yml scripts/deploy/workflow_contract_test.sh
git commit -m "feat(ci): add github auto deploy workflow"
```

## Task 6: Bootstrap Assets, Rollback Runbook, And Final Verification

**Files:**
- Create: `scripts/deploy/bootstrap/portfolio.sql`
- Create: `scripts/deploy/bootstrap/minio-policy.json.example`
- Modify: `README.md`

- [ ] **Step 1: Write the docs and bootstrap artifacts**

Add `scripts/deploy/bootstrap/portfolio.sql` with a template for:

```sql
CREATE ROLE portfolio_app LOGIN PASSWORD '<strong-password>';
CREATE DATABASE portfolio OWNER portfolio_app;
```

Add `scripts/deploy/bootstrap/minio-policy.json.example` scoped to:

- `arn:aws:s3:::portfolio-media`
- `arn:aws:s3:::portfolio-media/*`

Update `README.md` with:

- first-deploy prerequisites for the remote repo checkout, PostgreSQL database, MinIO bucket, and bucket policy
- required GitHub Environment secrets/variables using `PORTFOLIO_` prefixes
- the distinction between `app-only` and `migration` releases
- the migration release maintenance window and backup expectations
- rollback path A (app-only or backward-compatible schema) vs path B (migration restore)

- [ ] **Step 2: Run the full verification matrix**

Run:

```powershell
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1
bash scripts/deploy/compose_contract_test.sh
bash scripts/deploy/lib_test.sh
bash scripts/deploy/remote_deploy_test.sh
bash scripts/deploy/workflow_contract_test.sh
npm --prefix web test -- --run
npm --prefix web run build
docker compose config
docker compose build portfolio-app
docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest
```

Expected: PASS.

- [ ] **Step 3: Do one dry-run deploy rehearsal before touching production**

Run a local or staging dry run with placeholders:

```powershell
$env:DRY_RUN = "1"
$env:GITHUB_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
$env:RELEASE_TYPE = "app-only"
bash scripts/deploy/remote-deploy.sh
```

Expected: The script should print the ordered deploy steps without mutating production resources.

- [ ] **Step 4: Commit the final docs slice**

Suggested commit after green:

```powershell
git add README.md scripts/deploy/bootstrap
git commit -m "docs(deploy): add bootstrap and rollback runbook"
```

## Rollout Notes

- Keep the first production run manual through `workflow_dispatch` even if `push main` is enabled, so we can observe the initial environment and secret wiring.
- Treat the first release as `migration` unless the target database is already known-good and fully initialized.
- Do not merge follow-up deployment polish until the base workflow, health path, and rollback documentation are green.

## Execution Order

1. Task 1: health primitives and non-migrating DB ping
2. Task 2: `/api/health`, startup preflight, and router extraction
3. Task 3: Dockerfile and Compose contract
4. Task 4: deploy shell library and remote deploy orchestration
5. Task 5: GitHub Actions workflow
6. Task 6: bootstrap artifacts, docs, and full verification
