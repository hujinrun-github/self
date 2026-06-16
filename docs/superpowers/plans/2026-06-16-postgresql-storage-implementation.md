# PostgreSQL Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Go backend from SQLite to PostgreSQL as the single production database while preserving current API behavior and local media derivative storage.

**Architecture:** Keep the existing Go monolith and domain repositories, but replace SQLite connection, migration, schema, query, timestamp, and error behavior with PostgreSQL-specific implementations through `database/sql` plus pgx. Add explicit concurrency controls, media reference maintenance, upload consistency rules, and PostgreSQL-backed integration tests.

**Tech Stack:** Go 1.26.4, `database/sql`, `github.com/jackc/pgx/v5/stdlib`, PostgreSQL, embedded SQL migrations, PowerShell test commands, existing React frontend unchanged.

---

## File Structure

- Modify `go.mod` and `go.sum`: add pgx stdlib dependency and remove unused SQLite drivers after all code no longer imports them.
- Modify `internal/config/config.go`: replace `DatabasePath` with `DatabaseURL`, redact database URL in `String()`, keep session/upload settings unchanged.
- Modify `internal/config/config_test.go`: assert `DATABASE_URL` is required and redacted.
- Modify `internal/db/db.go`: open pgx-backed PostgreSQL, configure pool, ping, run migrations.
- Modify `internal/db/migrate.go`: use pinned `db.Conn(ctx)`, transaction-level advisory lock, statement-by-statement migration execution, PostgreSQL placeholders.
- Replace `internal/db/migrations/001_initial.sql`: PostgreSQL schema with BIGINT identities, JSONB, TIMESTAMPTZ, booleans, constraints, indexes, and singleton profile row.
- Create `internal/db/postgres_test.go`: migration, locking, and schema invariant tests.
- Create `internal/db/testutil_test.go`: PostgreSQL test schema helper using `TEST_DATABASE_URL`.
- Create `internal/storage/pgerrors.go`: SQLSTATE helpers and bounded retry helper shared by repositories.
- Create `internal/storage/time.go`: UTC microsecond timestamp normalization helpers.
- Modify `cmd/server/main.go`: pass `cfg.DatabaseURL` into `appdb.Open`, keep route wiring.
- Modify `internal/auth/auth.go`, `internal/auth/session.go`, and `internal/auth/csrf.go`: PostgreSQL placeholders, `RETURNING id`, idempotent bootstrap, timestamp handling.
- Modify `internal/auth/auth_test.go`: PostgreSQL-backed auth tests for bootstrap concurrency and session behavior.
- Modify `internal/profile/profile.go`: PostgreSQL placeholders, row-lock ETag protection with `SELECT updated_at FROM profile WHERE id = 1 FOR UPDATE`, `sql.NullTime`, media reference rebuilding.
- Modify `internal/profile/profile_test.go`: PostgreSQL-backed profile tests, stale ETag concurrency, media reference rebuild.
- Modify `internal/content/*.go`: PostgreSQL placeholders, `RETURNING id`, slug collision retry, sort advisory locks, hard-delete media reference cleanup, batch hydration, Markdown media validation.
- Modify `internal/content/content_test.go`: PostgreSQL-backed content tests for publish invariant, slug/sort concurrency, hard-delete reference cleanup, Markdown validation.
- Modify `internal/media/media.go`, `internal/media/references.go`, and `internal/media/media_test.go`: JSONB variants, upload staging cleanup, `ILIKE`, `EXISTS` referenced state, FK-to-ErrReferenced mapping.
- Modify `internal/site/home.go`, `internal/site/seo.go`, and tests: PostgreSQL placeholders and boolean/time scanning.
- Modify `internal/backup/backup.go` and `internal/backup/backup_test.go`: replace SQLite `VACUUM INTO` with `pg_dump` command construction, add write gate coverage and restore documentation hooks.
- Create `cmd/migrate-sqlite-to-postgres/main.go`: optional one-time data import command from SQLite to PostgreSQL.
- Modify `README.md`: update development, test, backup, restore, and migration instructions for PostgreSQL.

## Task 1: PostgreSQL Test Harness And Dependency

**Files:**
- Modify: `go.mod`
- Modify: `go.sum`
- Create: `internal/db/testutil_test.go`
- Create: `internal/db/postgres_test.go`

- [ ] **Step 1: Add pgx dependency**

Run:

```powershell
go get github.com/jackc/pgx/v5/stdlib
```

Expected: `go.mod` contains `github.com/jackc/pgx/v5`.

- [ ] **Step 2: Add PostgreSQL test helper**

Create `internal/db/testutil_test.go` with this helper shape:

```go
package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/url"
	"os"
	"strings"
	"testing"
)

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if value == "" {
		t.Skip("TEST_DATABASE_URL is required for PostgreSQL storage tests")
	}
	return value
}

func uniqueSchema(t *testing.T) string {
	t.Helper()
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatalf("rand schema: %v", err)
	}
	return "test_" + hex.EncodeToString(raw[:])
}

func urlWithSearchPath(t *testing.T, rawURL string, schema string) string {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	q := parsed.Query()
	q.Set("options", "-c search_path="+schema+",public -c timezone=UTC")
	parsed.RawQuery = q.Encode()
	return parsed.String()
}

func openTestPostgres(t *testing.T) (*sql.DB, string) {
	t.Helper()
	ctx := context.Background()
	adminURL := testDatabaseURL(t)
	adminDB, err := sql.Open("pgx", adminURL)
	if err != nil {
		t.Fatalf("open admin db: %v", err)
	}
	t.Cleanup(func() { _ = adminDB.Close() })

	schema := uniqueSchema(t)
	if _, err := adminDB.ExecContext(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatalf("create schema %s: %v", schema, err)
	}
	t.Cleanup(func() {
		_, _ = adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS `+schema+` CASCADE`)
	})

	database, err := sql.Open("pgx", urlWithSearchPath(t, adminURL, schema))
	if err != nil {
		t.Fatalf("open schema db: %v", err)
	}
	database.SetMaxOpenConns(4)
	database.SetMaxIdleConns(4)
	t.Cleanup(func() { _ = database.Close() })

	if err := Migrate(database); err != nil {
		t.Fatalf("migrate schema db: %v", err)
	}
	return database, schema
}
```

- [ ] **Step 3: Add failing migration smoke test**

Create `internal/db/postgres_test.go`:

```go
package db

import "testing"

func TestPostgresMigrationCreatesProfileSingleton(t *testing.T) {
	database, _ := openTestPostgres(t)
	var profileID int64
	if err := database.QueryRow(`SELECT id FROM profile`).Scan(&profileID); err != nil {
		t.Fatalf("query profile singleton: %v", err)
	}
	if profileID != 1 {
		t.Fatalf("profile id = %d, want 1", profileID)
	}
}
```

- [ ] **Step 4: Run test and verify it fails before pgx wiring**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:$($env:POSTGRES_PASSWORD)@192.168.1.20:19588/portfolio_test?sslmode=disable"
go test ./internal/db -run TestPostgresMigrationCreatesProfileSingleton -count=1
```

Expected: FAIL because the pgx driver is not registered or SQLite migration SQL is still active.

- [ ] **Step 5: Commit dependency and failing test**

```powershell
git add go.mod go.sum internal/db/testutil_test.go internal/db/postgres_test.go
git commit -m "test: add postgres db test harness"
```

## Task 2: Config And PostgreSQL Connection

**Files:**
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`
- Modify: `internal/db/db.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Write config tests**

Update `internal/config/config_test.go` so the happy-path test sets `DATABASE_URL` instead of `DATABASE_PATH` and adds redaction coverage:

```go
func TestConfigStringRedactsDatabaseURL(t *testing.T) {
	passwordURL := "postgres://" + "postgres" + ":" + "secret" + "@192.168.1.20:19588/portfolio?sslmode=disable"
	cfg := Config{
		SiteName:    "Portfolio",
		DatabaseURL: passwordURL,
	}
	got := cfg.String()
	if strings.Contains(got, "secret") || strings.Contains(got, "sslmode") {
		t.Fatalf("String leaked database URL details: %s", got)
	}
	if !strings.Contains(got, "postgres://postgres@192.168.1.20:19588/portfolio") {
		t.Fatalf("String() = %q", got)
	}
}
```

- [ ] **Step 2: Run config tests and verify failure**

Run:

```powershell
go test ./internal/config -count=1
```

Expected: FAIL because `DatabaseURL` does not exist yet.

- [ ] **Step 3: Implement config changes**

In `internal/config/config.go`, rename the field and load `DATABASE_URL`:

```go
type Config struct {
	AppOrigin          string
	AllowedOrigins     []string
	PublicBaseURL      string
	SiteName           string
	AdminEmail         string
	AdminPassword      string
	SessionSecret      string
	DatabaseURL        string
	UploadsDir         string
	PrivateUploadsDir  string
	SessionTTL         time.Duration
	SessionIdleTimeout time.Duration
}
```

Use this redaction helper:

```go
func redactDatabaseURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "invalid"
	}
	if parsed.User != nil {
		username := parsed.User.Username()
		parsed.User = url.User(username)
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
```

Set `DatabaseURL: os.Getenv("DATABASE_URL")` and update required-config validation to require `cfg.DatabaseURL`.

- [ ] **Step 4: Implement PostgreSQL Open**

Replace `internal/db/db.go` with pgx-backed open behavior:

```go
package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func Open(databaseURL string) (*sql.DB, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("database url is required")
	}
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	database.SetMaxOpenConns(10)
	database.SetMaxIdleConns(5)
	database.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := database.PingContext(ctx); err != nil {
		database.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	if err := Migrate(database); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}
```

- [ ] **Step 5: Update server startup**

In `cmd/server/main.go`, replace:

```go
database, err := appdb.Open(cfg.DatabasePath)
```

with:

```go
database, err := appdb.Open(cfg.DatabaseURL)
```

- [ ] **Step 6: Run config tests**

Run:

```powershell
go test ./internal/config -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add internal/config/config.go internal/config/config_test.go internal/db/db.go cmd/server/main.go
git commit -m "feat: configure postgres connection"
```

## Task 3: PostgreSQL Migration Runner

**Files:**
- Modify: `internal/db/migrate.go`
- Modify: `internal/db/postgres_test.go`

- [ ] **Step 1: Add migration locking tests**

Append this test to `internal/db/postgres_test.go`:

```go
func TestMigrateIsIdempotent(t *testing.T) {
	database, _ := openTestPostgres(t)
	if err := Migrate(database); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = $1`, "001_initial").Scan(&count); err != nil {
		t.Fatalf("count migrations: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want 1", count)
	}
}
```

- [ ] **Step 2: Run migration tests and verify failure**

Run:

```powershell
go test ./internal/db -run 'TestPostgresMigrationCreatesProfileSingleton|TestMigrateIsIdempotent' -count=1
```

Expected: FAIL because `migrate.go` still uses SQLite `?` placeholders and whole-file execution.

- [ ] **Step 3: Rewrite migration runner**

In `internal/db/migrate.go`, keep embedded files, but replace migration execution with a pinned connection and transaction-level advisory lock:

```go
const migrationLockKey int64 = 710203991

func Migrate(database *sql.DB) error {
	ctx := context.Background()
	conn, err := database.Conn(ctx)
	if err != nil {
		return fmt.Errorf("pin migration connection: %w", err)
	}
	defer conn.Close()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration run: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, migrationLockKey); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied, err := readAppliedMigrations(ctx, tx)
	if err != nil {
		return err
	}
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version := strings.TrimSuffix(entry.Name(), ".sql")
		if applied[version] {
			continue
		}
		body, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		statements, err := splitSQLStatements(string(body))
		if err != nil {
			return fmt.Errorf("split migration %s: %w", version, err)
		}
		for _, statement := range statements {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("apply migration %s: %w", version, err)
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
			return fmt.Errorf("record migration %s: %w", version, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration run: %w", err)
	}
	return nil
}
```

Add a conservative splitter that handles semicolons outside single-quoted strings and line comments. If dollar-quoted functions are added later, add parser support before adding such migrations:

```go
func splitSQLStatements(sqlText string) ([]string, error) {
	statements := []string{}
	var current strings.Builder
	inSingleQuote := false
	inLineComment := false
	for i := 0; i < len(sqlText); i++ {
		ch := sqlText[i]
		next := byte(0)
		if i+1 < len(sqlText) {
			next = sqlText[i+1]
		}
		if inLineComment {
			current.WriteByte(ch)
			if ch == '\n' {
				inLineComment = false
			}
			continue
		}
		if !inSingleQuote && ch == '-' && next == '-' {
			inLineComment = true
			current.WriteByte(ch)
			continue
		}
		if ch == '\'' {
			inSingleQuote = !inSingleQuote
			current.WriteByte(ch)
			continue
		}
		if !inSingleQuote && ch == ';' {
			statement := strings.TrimSpace(current.String())
			if statement != "" {
				statements = append(statements, statement)
			}
			current.Reset()
			continue
		}
		current.WriteByte(ch)
	}
	if inSingleQuote {
		return nil, fmt.Errorf("unterminated single-quoted string")
	}
	tail := strings.TrimSpace(current.String())
	if tail != "" {
		statements = append(statements, tail)
	}
	return statements, nil
}
```

- [ ] **Step 4: Run migration tests**

Run:

```powershell
go test ./internal/db -count=1
```

Expected: still FAIL until the PostgreSQL schema replaces SQLite SQL in Task 4.

- [ ] **Step 5: Commit migration runner**

```powershell
git add internal/db/migrate.go internal/db/postgres_test.go
git commit -m "feat: add postgres migration runner"
```

## Task 4: PostgreSQL Schema Migration

**Files:**
- Replace: `internal/db/migrations/001_initial.sql`
- Modify: `internal/db/postgres_test.go`

- [ ] **Step 1: Add schema invariant tests**

Add tests in `internal/db/postgres_test.go` for profile singleton, publish invariant, unique media key, and JSONB:

```go
func TestPostgresSchemaInvariants(t *testing.T) {
	database, _ := openTestPostgres(t)
	if _, err := database.Exec(`INSERT INTO profile (id, updated_at) VALUES ($1, now())`, 2); err == nil {
		t.Fatal("expected profile singleton check to reject id 2")
	}
	if _, err := database.Exec(`INSERT INTO projects (title, slug, status, featured, sort_order, created_at, updated_at) VALUES ($1, $2, 'published', false, 10, now(), now())`, "No Date", "no-date"); err == nil {
		t.Fatal("expected published project without published_at to fail")
	}
	_, err := database.Exec(`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())`, "a.png", "same-key", "image/png", 10, 1, 1, `{}`, "sum-1")
	if err != nil {
		t.Fatalf("insert media asset: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())`, "b.png", "same-key", "image/png", 10, 1, 1, `{}`, "sum-2"); err == nil {
		t.Fatal("expected duplicate storage_key to fail")
	}
}
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```powershell
go test ./internal/db -run TestPostgresSchemaInvariants -count=1
```

Expected: FAIL until schema SQL is replaced.

- [ ] **Step 3: Replace schema SQL**

Replace `internal/db/migrations/001_initial.sql` with PostgreSQL DDL. Include these representative patterns throughout:

```sql
CREATE TABLE admins (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE media_assets (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  variants JSONB NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE profile (
  id BIGINT PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_media_id BIGINT REFERENCES media_assets(id) ON DELETE RESTRICT,
  email TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  og_image_media_id BIGINT REFERENCES media_assets(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

INSERT INTO profile (id, updated_at)
VALUES (1, now())
ON CONFLICT (id) DO NOTHING;
```

For every publishable table, use:

```sql
status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
published_at TIMESTAMPTZ,
CHECK (status <> 'published' OR published_at IS NOT NULL)
```

For booleans, use:

```sql
featured BOOLEAN NOT NULL DEFAULT false
```

For JSONB, use:

```sql
variants JSONB NOT NULL
```

- [ ] **Step 4: Run db tests**

Run:

```powershell
go test ./internal/db -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit schema**

```powershell
git add internal/db/migrations/001_initial.sql internal/db/postgres_test.go
git commit -m "feat: add postgres schema"
```

## Task 5: Shared PostgreSQL Helpers

**Files:**
- Create: `internal/storage/pgerrors.go`
- Create: `internal/storage/time.go`
- Create: `internal/storage/retry.go`

- [ ] **Step 1: Create helper package tests inline with implementation**

Create `internal/storage/pgerrors.go`:

```go
package storage

import (
	"errors"

	"github.com/jackc/pgconn"
)

const (
	CodeSerializationFailure = "40001"
	CodeDeadlockDetected     = "40P01"
	CodeUniqueViolation      = "23505"
	CodeForeignKeyViolation  = "23503"
	CodeCheckViolation       = "23514"
)

func SQLState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func IsSQLState(err error, code string) bool {
	return SQLState(err) == code
}
```

Create `internal/storage/time.go`:

```go
package storage

import "time"

func NormalizeTime(value time.Time) time.Time {
	return value.UTC().Truncate(time.Microsecond)
}

func TimePtrValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	normalized := NormalizeTime(*value)
	return normalized
}
```

Create `internal/storage/retry.go`:

```go
package storage

import (
	"context"
	"time"
)

func RetryTransient(ctx context.Context, attempts int, fn func() error) error {
	if attempts <= 0 {
		attempts = 1
	}
	var last error
	for attempt := 1; attempt <= attempts; attempt++ {
		if err := fn(); err != nil {
			last = err
			if !IsSQLState(err, CodeSerializationFailure) && !IsSQLState(err, CodeDeadlockDetected) {
				return err
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 10 * time.Millisecond):
			}
			continue
		}
		return nil
	}
	return last
}
```

- [ ] **Step 2: Run helper package tests**

Run:

```powershell
go test ./internal/storage -count=1
```

Expected: PASS because there are no test files and package compiles.

- [ ] **Step 3: Commit helpers**

```powershell
git add internal/storage
git commit -m "feat: add postgres storage helpers"
```

## Task 6: Auth And Sessions

**Files:**
- Modify: `internal/auth/auth.go`
- Modify: `internal/auth/session.go`
- Modify: `internal/auth/csrf.go`
- Modify: `internal/auth/auth_test.go`

- [ ] **Step 1: Add concurrent bootstrap test**

In `internal/auth/auth_test.go`, add:

```go
func TestBootstrapAdminConcurrentIsIdempotent(t *testing.T) {
	database, _ := dbtest.OpenPostgres(t)
	cfg := testConfig()
	service := NewService(database, cfg)
	errs := make(chan error, 2)
	go func() { errs <- service.BootstrapAdmin(t.Context()) }()
	go func() { errs <- service.BootstrapAdmin(t.Context()) }()
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("BootstrapAdmin concurrent err = %v", err)
		}
	}
	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM admins`).Scan(&count); err != nil {
		t.Fatalf("count admins: %v", err)
	}
	if count != 1 {
		t.Fatalf("admin count = %d, want 1", count)
	}
}
```

Use the same PostgreSQL test helper pattern from `internal/db` or extract it to `internal/testutil/postgres`.

- [ ] **Step 2: Run auth tests and verify failure**

Run:

```powershell
go test ./internal/auth -run TestBootstrapAdminConcurrentIsIdempotent -count=1
```

Expected: FAIL until auth SQL uses PostgreSQL and bootstrap is idempotent.

- [ ] **Step 3: Update SQL placeholders and timestamps**

Change auth queries from `?` to `$1`, `$2`. Use `storage.NormalizeTime`.

Use `RETURNING id` for session creation:

```go
err := s.db.QueryRowContext(ctx, `INSERT INTO sessions (admin_id, session_token_hash, csrf_token_hash, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
	adminID,
	hashToken(rawToken),
	session.CSRFHash,
	storage.NormalizeTime(session.CreatedAt),
	storage.NormalizeTime(session.LastSeen),
	storage.NormalizeTime(session.ExpiresAt),
).Scan(&session.ID)
```

- [ ] **Step 4: Make bootstrap idempotent**

Use a transaction-level advisory lock:

```go
const bootstrapAdminLockKey int64 = 710203992

tx, err := s.db.BeginTx(ctx, nil)
if err != nil {
	return err
}
defer tx.Rollback()
if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, bootstrapAdminLockKey); err != nil {
	return err
}
var count int
if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM admins`).Scan(&count); err != nil {
	return err
}
if count > 0 {
	return tx.Commit()
}
_, err = tx.ExecContext(ctx, `INSERT INTO admins (email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`, s.cfg.AdminEmail, string(hash), now, now)
if err != nil {
	return err
}
return tx.Commit()
```

- [ ] **Step 5: Run auth tests**

Run:

```powershell
go test ./internal/auth -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit auth migration**

```powershell
git add internal/auth internal/storage
git commit -m "feat: migrate auth storage to postgres"
```

## Task 7: Profile Repository, ETags, And References

**Files:**
- Modify: `internal/profile/profile.go`
- Modify: `internal/profile/profile_test.go`
- Modify: `internal/media/references.go`

- [ ] **Step 1: Add concurrent ETag test**

In `internal/profile/profile_test.go`, add a test that loads one ETag, runs two `SaveAdmin` calls concurrently with that ETag, and expects one success plus one `ErrConflict`.

Use this assertion shape:

```go
if success != 1 || conflicts != 1 {
	t.Fatalf("success=%d conflicts=%d, want 1 and 1", success, conflicts)
}
```

- [ ] **Step 2: Add media reference save test**

Insert a media asset, save it as avatar, and assert:

```sql
SELECT COUNT(*) FROM media_references WHERE resource_type = 'profile' AND resource_id = 1 AND source = 'avatar'
```

returns `1`.

- [ ] **Step 3: Run profile tests and verify failure**

Run:

```powershell
go test ./internal/profile -count=1
```

Expected: FAIL until profile uses PostgreSQL placeholders, row locking, and reference rebuilding.

- [ ] **Step 4: Implement profile row lock**

Inside `SaveAdmin`, replace the initial read with:

```go
var updatedAt time.Time
if err := tx.QueryRowContext(ctx, `SELECT updated_at FROM profile WHERE id = 1 FOR UPDATE`).Scan(&updatedAt); err != nil {
	return err
}
if etagForTime(updatedAt) != ifMatch {
	return ErrConflict
}
```

Use normalized timestamps:

```go
now := storage.NormalizeTime(r.clock())
```

- [ ] **Step 5: Rebuild profile media references**

Add an interface in `internal/media/references.go`:

```go
func RebuildReferences(ctx context.Context, tx *sql.Tx, resourceType string, resourceID int64, refs []Reference) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM media_references WHERE resource_type = $1 AND resource_id = $2`, resourceType, resourceID); err != nil {
		return err
	}
	now := storage.NormalizeTime(time.Now())
	for _, ref := range refs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO media_references (media_asset_id, resource_type, resource_id, source, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, ref.MediaAssetID, resourceType, resourceID, ref.Source, now); err != nil {
			return err
		}
	}
	return nil
}
```

Call it from profile save with avatar and OG refs.

- [ ] **Step 6: Run profile tests**

Run:

```powershell
go test ./internal/profile -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit profile work**

```powershell
git add internal/profile internal/media/references.go
git commit -m "feat: migrate profile storage to postgres"
```

## Task 8: Content Repository PostgreSQL And Concurrency

**Files:**
- Modify: `internal/content/projects.go`
- Modify: `internal/content/writing.go`
- Modify: `internal/content/talks.go`
- Modify: `internal/content/experience.go`
- Modify: `internal/content/reorder.go`
- Modify: `internal/content/terms.go`
- Modify: `internal/content/public.go`
- Modify: `internal/content/admin_list.go`
- Modify: `internal/content/content_test.go`

- [ ] **Step 1: Add failing concurrency tests**

Add tests for slug and sort concurrency:

```go
func TestConcurrentProjectCreateAllocatesUniqueSlugAndSortOrder(t *testing.T) {
	repo := newContentRepo(t)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Same Title"})
			errs <- err
		}()
	}
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("CreateProject concurrent: %v", err)
		}
	}
	items, err := repo.ListProjects(t.Context(), 10)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if items[0].Slug == items[1].Slug || items[0].SortOrder == items[1].SortOrder {
		t.Fatalf("duplicate slug or sort order: %+v", items)
	}
}
```

- [ ] **Step 2: Add hard-delete reference cleanup test**

Create project with cover media, delete the never-published draft, and assert `media_references` count for that project is `0`.

- [ ] **Step 3: Add Markdown validation test**

Save writing content containing `![x](/uploads/a/b/card.jpg)` and expect a validation error that maps to HTTP `400 validation_error`.

- [ ] **Step 4: Run content tests and verify failure**

Run:

```powershell
go test ./internal/content -count=1
```

Expected: FAIL until content repository uses PostgreSQL, locks, retries, and reference maintenance.

- [ ] **Step 5: Implement table lock helper**

In `internal/content/reorder.go`, add:

```go
func lockContentOrder(ctx context.Context, tx *sql.Tx, table string) error {
	keys := map[string]int64{
		"projects":    710204101,
		"writings":    710204102,
		"talks":       710204103,
		"experiences": 710204104,
	}
	key, ok := keys[table]
	if !ok {
		return fmt.Errorf("unknown order table %s", table)
	}
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, key)
	return err
}
```

Call `lockContentOrder` before `nextSortOrder` and before reorder validation.

- [ ] **Step 6: Implement slug retry**

Wrap create operations in a bounded loop:

```go
for attempt := 0; attempt < 10; attempt++ {
	project, err := r.createProjectAttempt(ctx, input, attempt)
	if err == nil {
		return project, nil
	}
	if !storage.IsSQLState(err, storage.CodeUniqueViolation) {
		return Project{}, err
	}
}
return Project{}, ErrSlugTooLong
```

Inside attempts, use suffix-aware slug candidates and `RETURNING id`.

- [ ] **Step 7: Convert terms upsert**

Replace `INSERT OR IGNORE`:

```go
err := tx.QueryRowContext(ctx, `INSERT INTO `+table+` (name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at RETURNING id`, name, slug, now, now).Scan(&id)
```

Keep `table` from an internal whitelist only.

- [ ] **Step 8: Implement reference cleanup on delete**

In project hard delete transaction:

```go
if _, err := tx.ExecContext(ctx, `DELETE FROM media_references WHERE resource_type = $1 AND resource_id = $2`, "project", id); err != nil {
	return err
}
if _, err := tx.ExecContext(ctx, `DELETE FROM projects WHERE id = $1`, id); err != nil {
	return err
}
```

- [ ] **Step 9: Run content tests**

Run:

```powershell
go test ./internal/content -count=1
```

Expected: PASS.

- [ ] **Step 10: Commit content work**

```powershell
git add internal/content
git commit -m "feat: migrate content storage to postgres"
```

## Task 9: Media Service PostgreSQL And Upload Consistency

**Files:**
- Modify: `internal/media/media.go`
- Modify: `internal/media/references.go`
- Modify: `internal/media/media_test.go`

- [ ] **Step 1: Add failing upload cleanup test**

In `internal/media/media_test.go`, add a test that forces duplicate `storage_key` or database insert failure and asserts the generated derivative directory is removed.

Expected assertion:

```go
if _, err := os.Stat(filepath.Join(uploadsDir, key[:2], key[2:4])); !os.IsNotExist(err) {
	t.Fatalf("expected upload derivatives to be cleaned up, stat err=%v", err)
}
```

- [ ] **Step 2: Add delete FK mapping test**

Insert a media asset, insert a `media_references` row, call `service.Delete`, and assert `errors.Is(err, ErrReferenced)`.

- [ ] **Step 3: Run media tests and verify failure**

Run:

```powershell
go test ./internal/media -count=1
```

Expected: FAIL until media service is migrated.

- [ ] **Step 4: Implement PostgreSQL insert with staging**

Use an uncommitted transaction around metadata insert and final file activation:

```go
tx, err := s.db.BeginTx(ctx, nil)
if err != nil {
	return Asset{}, err
}
defer tx.Rollback()
err = tx.QueryRowContext(ctx, `INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING id`,
	filepath.Base(fileName),
	storageKey,
	mimeType,
	len(rawBytes),
	width,
	height,
	string(variantsJSON),
	checksum,
	storage.NormalizeTime(time.Now()),
).Scan(&id)
if err != nil {
	_ = os.RemoveAll(stagingDir)
	return Asset{}, err
}
if err := os.Rename(stagingDir, finalDir); err != nil {
	_ = os.RemoveAll(stagingDir)
	return Asset{}, err
}
if err := tx.Commit(); err != nil {
	_ = os.RemoveAll(finalDir)
	return Asset{}, err
}
```

- [ ] **Step 5: Optimize media list query**

Use `ILIKE` and `EXISTS`:

```sql
SELECT id, file_name, storage_key, mime_type, width, height, variants,
       EXISTS (SELECT 1 FROM media_references WHERE media_asset_id = media_assets.id) AS referenced
FROM media_assets
WHERE file_name ILIKE $1
ORDER BY id DESC
LIMIT $2 OFFSET $3
```

- [ ] **Step 6: Map FK delete errors**

In `Delete`, after `DELETE FROM media_assets WHERE id = $1`, map `23503`:

```go
if storage.IsSQLState(err, storage.CodeForeignKeyViolation) {
	return ErrReferenced
}
```

- [ ] **Step 7: Run media tests**

Run:

```powershell
go test ./internal/media -count=1
```

Expected: PASS.

- [ ] **Step 8: Commit media work**

```powershell
git add internal/media
git commit -m "feat: migrate media storage to postgres"
```

## Task 10: Site Queries And Public Read Paths

**Files:**
- Modify: `internal/site/home.go`
- Modify: `internal/site/seo.go`
- Modify: `internal/site/home_test.go`
- Modify: `internal/site/seo_test.go`

- [ ] **Step 1: Update tests to PostgreSQL placeholders**

Change test seed SQL from `?` to `$1`, `$2`, and insert booleans as `true` or `false`.

- [ ] **Step 2: Update home queries**

Use PostgreSQL placeholders and bool scanning:

```go
rows, err := r.db.QueryContext(ctx, `SELECT id, title, slug, `+summaryColumn+`, featured, sort_order, published_at FROM `+table+` WHERE status = 'published' AND published_at <= $1 ORDER BY featured DESC, published_at DESC, sort_order ASC LIMIT $2`, r.now(), limit)
```

Keep `summaryColumn` whitelisted to `talks:summary`, `writings:excerpt`, `projects:summary`.

- [ ] **Step 3: Run site tests**

Run:

```powershell
go test ./internal/site -count=1
```

Expected: PASS.

- [ ] **Step 4: Commit site work**

```powershell
git add internal/site
git commit -m "feat: migrate site reads to postgres"
```

## Task 11: Backup, Restore Notes, And Write Gate

**Files:**
- Modify: `internal/backup/backup.go`
- Modify: `internal/backup/backup_test.go`
- Modify: `README.md`

- [ ] **Step 1: Add write gate test**

Extend `internal/backup/backup_test.go` so a media/content write using `WithWriteLock` blocks while backup holds the lock. Keep the existing channel pattern and assert the write does not enter before backup releases.

- [ ] **Step 2: Replace VACUUM with pg_dump command construction**

In `backup.Run`, replace `VACUUM INTO` with an `exec.CommandContext` that calls `pg_dump`:

```go
cmd := exec.CommandContext(ctx, pgDumpPath, "--format=custom", "--no-owner", "--no-acl", "--file", filepath.Join(destinationDir, "database.dump"), databaseName)
cmd.Env = append(os.Environ(), "PGPASSWORD="+password)
```

Do not log password-bearing values.

- [ ] **Step 3: Update README restore steps**

Document:

```text
1. Stop the app or enable maintenance mode.
2. Restore database with pg_restore.
3. Restore uploads into a temporary directory.
4. Rename the restored uploads directory into place.
5. Start the app after both database and uploads are restored.
```

- [ ] **Step 4: Run backup tests**

Run:

```powershell
go test ./internal/backup -count=1
```

Expected: PASS when `pg_dump` is available or tests stub command execution.

- [ ] **Step 5: Commit backup work**

```powershell
git add internal/backup README.md
git commit -m "feat: add postgres backup workflow"
```

## Task 12: SQLite To PostgreSQL Import Command

**Files:**
- Create: `cmd/migrate-sqlite-to-postgres/main.go`
- Create: `cmd/migrate-sqlite-to-postgres/main_test.go`

- [ ] **Step 1: Add command argument test**

Create `main_test.go` with argument parsing tests:

```go
func TestParseArgsRequiresSQLiteAndPostgres(t *testing.T) {
	_, err := parseArgs([]string{"--sqlite", "data/portfolio.db"})
	if err == nil {
		t.Fatal("expected missing postgres error")
	}
}
```

- [ ] **Step 2: Implement import order**

In `main.go`, implement table import order:

```go
var importTables = []string{
	"admins",
	"media_assets",
	"profile",
	"social_links",
	"experiences",
	"talks",
	"writings",
	"tags",
	"writing_tags",
	"projects",
	"techs",
	"project_tech",
	"media_references",
}
```

For profile, use:

```sql
INSERT INTO profile (id, name, headline, summary, bio, avatar_media_id, email, seo_title, seo_description, og_image_media_id, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  headline = EXCLUDED.headline,
  summary = EXCLUDED.summary,
  bio = EXCLUDED.bio,
  avatar_media_id = EXCLUDED.avatar_media_id,
  email = EXCLUDED.email,
  seo_title = EXCLUDED.seo_title,
  seo_description = EXCLUDED.seo_description,
  og_image_media_id = EXCLUDED.og_image_media_id,
  updated_at = EXCLUDED.updated_at
```

- [ ] **Step 3: Reset identities**

After import, run per identity table:

```sql
SELECT setval(pg_get_serial_sequence('projects', 'id'), COALESCE((SELECT MAX(id) FROM projects), 1), true)
```

- [ ] **Step 4: Run command tests**

Run:

```powershell
go test ./cmd/migrate-sqlite-to-postgres -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit migration command**

```powershell
git add cmd/migrate-sqlite-to-postgres
git commit -m "feat: add sqlite to postgres import command"
```

## Task 13: Final Verification And Cleanup

**Files:**
- Modify: `README.md`
- Modify: `go.mod`
- Modify: `go.sum`

- [ ] **Step 1: Remove SQLite imports and dependencies**

Run:

```powershell
rg "sqlite|modernc.org/sqlite|mattn/go-sqlite3|DATABASE_PATH|PRAGMA|VACUUM INTO|LastInsertId|INSERT OR IGNORE" .
```

Expected: only historical docs or the SQLite import command mention SQLite. Runtime packages do not import SQLite drivers.

- [ ] **Step 2: Tidy modules**

Run:

```powershell
go mod tidy
```

Expected: `modernc.org/sqlite` is removed from runtime dependencies unless the import command keeps a SQLite reader dependency.

- [ ] **Step 3: Run backend tests**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:$($env:POSTGRES_PASSWORD)@192.168.1.20:19588/portfolio_test?sslmode=disable"
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1
```

Expected: PASS.

- [ ] **Step 4: Run frontend tests and build**

Run:

```powershell
cd web
npm test -- --run
npm run build
cd ..
```

Expected: PASS and `web/dist` is updated or unchanged according to the frontend build.

- [ ] **Step 5: Run server smoke test**

Run:

```powershell
$env:APP_ORIGIN="http://localhost:8080"
$env:APP_ORIGINS="http://127.0.0.1:8080,http://localhost:8080"
$env:PUBLIC_BASE_URL="http://localhost:8080"
$env:SITE_NAME="Portfolio"
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD=$env:PORTFOLIO_ADMIN_PASSWORD
$env:SESSION_SECRET=$env:PORTFOLIO_SESSION_SECRET
$env:DATABASE_URL="postgres://postgres:$($env:POSTGRES_PASSWORD)@192.168.1.20:19588/portfolio?sslmode=disable"
$env:UPLOADS_DIR="data/uploads"
$env:PRIVATE_UPLOADS_DIR="data/private_uploads"
go run ./cmd/server
```

Expected: server starts, logs do not print the password, and migrations complete.

- [ ] **Step 6: Final commit**

```powershell
git add README.md go.mod go.sum
git commit -m "chore: finalize postgres storage migration"
```

## Self-Review Checklist

- [ ] Every storage entry point uses PostgreSQL placeholders.
- [ ] No runtime code uses `LastInsertId`.
- [ ] No runtime code uses SQLite PRAGMA statements.
- [ ] Migration lock uses `pg_advisory_xact_lock` inside a pinned-connection transaction.
- [ ] Published content cannot have NULL `published_at`.
- [ ] Profile ETag writes are protected by row lock or version check.
- [ ] Slug and sort-order write races are covered by retries or advisory locks.
- [ ] Media references are rebuilt on save and cleared on hard delete.
- [ ] Media upload failure paths clean staging or final derivative files.
- [ ] Backup and restore docs avoid password-bearing command lines.
- [ ] PostgreSQL tests run with `TEST_DATABASE_URL`.
