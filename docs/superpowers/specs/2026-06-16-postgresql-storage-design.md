# PostgreSQL Storage Redesign

Date: 2026-06-16
Status: Draft for review

## Goal

Redesign the backend storage layer so the Go application uses PostgreSQL as the single target database while keeping the existing service shape, admin workflows, public APIs, and local media-file handling intact.

This design covers architecture and migration strategy only. It does not implement code changes.

## Confirmed Decisions

- Use PostgreSQL as the target backend database.
- Prefer one database target instead of maintaining a long-term SQLite and PostgreSQL compatibility layer.
- Keep the existing Go repository boundaries for `auth`, `profile`, `content`, `media`, and `site`.
- Keep media derivatives on local disk for this stage. PostgreSQL stores media metadata and references only.
- Defer MinIO object storage migration to a separate future design.
- Treat `BlobStore` as a separate delivery point from the PostgreSQL migration so database work and media storage refactoring do not expand each other's risk.
- Replace `DATABASE_PATH` with `DATABASE_URL`.
- Use real PostgreSQL in backend storage tests through `TEST_DATABASE_URL`.

## Non-Goals

- Do not redesign the public React frontend.
- Do not add multi-user admin roles.
- Do not move upload derivatives to MinIO in this stage.
- Do not introduce a full ORM.
- Do not preserve active admin sessions during SQLite-to-PostgreSQL data migration; admins can log in again.
- Do not add read replicas, sharding, or multi-tenant database routing.

## Recommended Architecture

The backend remains a Go monolith. PostgreSQL becomes the system of record for:

- Admin accounts and sessions.
- Profile and social links.
- Projects, writing, talks, experience entries, tags, and tech stacks.
- Media metadata, generated variant metadata, and media references.
- Migration history.

The application keeps `database/sql` at the repository boundary and uses the `pgx` standard-library driver underneath. This keeps the current `*sql.DB` dependency shape and avoids a broad rewrite of every repository constructor.

Suggested dependency:

```text
github.com/jackc/pgx/v5/stdlib
```

Connection ownership remains in `internal/db`. Application packages receive a ready `*sql.DB`; they do not parse environment variables or manage connection pools themselves.

## Storage Abstraction Boundary

This redesign uses a light storage abstraction, not a fully pluggable SQL dialect system.

HTTP handlers and services should depend on business-facing interfaces where the boundary is useful, such as:

```go
type ProjectStore interface {
	CreateProject(ctx context.Context, input ProjectInput) (Project, error)
	UpdateProject(ctx context.Context, id int64, input ProjectInput) (Project, error)
	GetProject(ctx context.Context, id int64) (Project, error)
	ListProjects(ctx context.Context, limit int) ([]Project, error)
	PublicProjects(ctx context.Context, limit int) ([]Project, error)
	PublicProjectBySlug(ctx context.Context, slug string) (Project, error)
	SetProjectStatus(ctx context.Context, id int64, status Status, publishedAt *time.Time) error
	DeleteProject(ctx context.Context, id int64) error
	ReorderProjects(ctx context.Context, orderedIDs []int64) error
}
```

The first implementation is PostgreSQL-backed. The design intentionally does not add SQLite, MySQL, or generic SQL dialect plugins because PostgreSQL-specific behavior is part of the target design: `RETURNING`, `JSONB`, `TIMESTAMPTZ`, `ON CONFLICT`, `ANY($1)`, advisory migration locks, and PostgreSQL SQLSTATE error mapping.

The abstraction goal is to keep HTTP and application workflows independent from repository implementation details, not to make every relational database interchangeable.

Recommended interface boundaries:

- `auth.AdminStore` for admin lookup, bootstrap, sessions, and CSRF token persistence.
- `profile.Store` for profile and social links.
- `content.Store` or resource-specific interfaces for projects, writing, talks, and experience.
- `media.AssetStore` for media metadata and references.
- `site.HomeStore` for homepage and sitemap reads.

Repository implementations should live beside their domain packages or in clearly named PostgreSQL files, such as `postgres_repository.go`, when the split improves clarity. Keep constructors explicit, for example `content.NewPostgresRepository(database)`.

Avoid generic CRUD interfaces. Each interface should express the operations the application actually needs.

## Runtime Configuration

Required storage configuration:

```text
DATABASE_URL
```

Recommended optional configuration:

```text
DATABASE_MAX_OPEN_CONNS
DATABASE_MAX_IDLE_CONNS
DATABASE_CONN_MAX_LIFETIME_MINUTES
DATABASE_CONNECT_TIMEOUT_SECONDS
TEST_DATABASE_URL
PGDUMP_PATH
```

`DATABASE_URL` shape:

```text
postgres://postgres:${POSTGRES_PASSWORD}@192.168.1.20:19588/portfolio?sslmode=disable
```

The password must come from the runtime environment or secret store. It must not be committed to the repository.

Local development may use `sslmode=disable` for the LAN PostgreSQL service. Production should use `sslmode=require` or `sslmode=verify-full` when TLS is available.

`DATABASE_PATH` becomes unsupported after the migration. Startup should fail with a clear message if `DATABASE_URL` is missing.

Configuration logging must never print the full `DATABASE_URL`. `Config.String()` and startup logs should redact credentials and query parameters, for example `db=postgres://postgres@192.168.1.20:19588/portfolio`.

## Database Connection Behavior

`internal/db.Open` should be redesigned around these responsibilities:

- Validate that `DATABASE_URL` is not empty.
- Register/open the `pgx` SQL driver.
- Configure connection pool limits.
- Ping PostgreSQL with a context timeout.
- Run migrations before returning the database handle.
- Return wrapped errors that identify whether connection, ping, or migration failed.

Suggested pool defaults for this app:

```text
MaxOpenConns: 10
MaxIdleConns: 5
ConnMaxLifetime: 30 minutes
ConnectTimeout: 5 seconds
```

The current SQLite-specific behavior must be removed:

- Directory creation for the database file.
- SQLite driver import.
- `SetMaxOpenConns(1)`.
- `PRAGMA journal_mode`.
- `PRAGMA foreign_keys`.
- `PRAGMA busy_timeout`.
- `PRAGMA synchronous`.

## Migration System

Keep embedded SQL migration files under `internal/db/migrations`, but rewrite them for PostgreSQL.

Migration table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migration rules:

- Run migrations at startup before serving HTTP traffic.
- Apply migration files in lexical order.
- Wrap each migration file in a transaction.
- Use a PostgreSQL session-level advisory lock around the full migration run so concurrent app startups cannot apply the same migration twice.
- Pin migrations to one physical connection with `db.Conn(ctx)`.
- Acquire the advisory lock on that pinned connection before creating or reading `schema_migrations`.
- Create `schema_migrations` after the advisory lock has been acquired.
- Start each migration transaction with `conn.BeginTx(ctx, nil)` so the lock and all migration transactions stay on the same PostgreSQL connection.
- Execute migration SQL statement-by-statement inside each migration transaction. Do not rely on whole-file `Exec` for multi-statement migration files.
- Use a parser or splitter that understands PostgreSQL comments, quoted strings, and dollar-quoted function bodies. If that is not implemented, require each migration file to contain exactly one SQL statement.
- Do not switch migrations to `QueryExecModeSimpleProtocol` just to support multi-statement strings; keep normal query execution and make statement boundaries explicit.
- Release the lock with `pg_advisory_unlock` in a `defer`; closing the pinned connection is the final fallback if unlock fails.
- Record the migration version after the SQL file succeeds.
- Fail startup if any migration fails.

The migration runner must use PostgreSQL placeholders such as `$1`, not SQLite `?`.

## PostgreSQL Schema Design

Use PostgreSQL-native types:

- IDs: `BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`.
- Text fields: `TEXT`.
- Boolean flags: `BOOLEAN NOT NULL DEFAULT false`.
- Timestamps: `TIMESTAMPTZ`.
- Media variants: `JSONB`.
- Status fields: `TEXT` with `CHECK (status IN ('draft', 'published', 'archived'))`.

Use UTC in application code and store timestamps as `TIMESTAMPTZ`. API serialization remains RFC 3339.

### Core Tables

The PostgreSQL schema keeps the existing logical tables:

```text
admins
media_assets
profile
social_links
experiences
talks
writings
tags
writing_tags
projects
techs
project_tech
media_references
sessions
schema_migrations
```

`profile` remains a singleton:

```sql
id BIGINT PRIMARY KEY CHECK (id = 1)
```

The initial migration inserts the singleton row with `id = 1`.

### Type Changes From SQLite

Important field mappings:

```text
INTEGER PRIMARY KEY AUTOINCREMENT -> BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY
INTEGER boolean 0/1              -> BOOLEAN
TEXT timestamp                   -> TIMESTAMPTZ
variants_json TEXT               -> variants JSONB
CURRENT_TIMESTAMP                -> now()
```

`media_assets.variants_json` should be renamed to `variants` during the PostgreSQL redesign. Go API structs can keep returning `variants` as they do now.

### Required Unique Constraints

The PostgreSQL schema must preserve these uniqueness guarantees from the current SQLite schema:

```sql
ALTER TABLE admins ADD CONSTRAINT admins_email_key UNIQUE (email);
ALTER TABLE media_assets ADD CONSTRAINT media_assets_storage_key_key UNIQUE (storage_key);
ALTER TABLE talks ADD CONSTRAINT talks_slug_key UNIQUE (slug);
ALTER TABLE writings ADD CONSTRAINT writings_slug_key UNIQUE (slug);
ALTER TABLE projects ADD CONSTRAINT projects_slug_key UNIQUE (slug);
ALTER TABLE tags ADD CONSTRAINT tags_slug_key UNIQUE (slug);
ALTER TABLE techs ADD CONSTRAINT techs_slug_key UNIQUE (slug);
ALTER TABLE writing_tags ADD CONSTRAINT writing_tags_writing_id_tag_id_key UNIQUE (writing_id, tag_id);
ALTER TABLE project_tech ADD CONSTRAINT project_tech_project_id_tech_id_key UNIQUE (project_id, tech_id);
ALTER TABLE social_links ADD CONSTRAINT social_links_profile_id_label_key UNIQUE (profile_id, label);
ALTER TABLE social_links ADD CONSTRAINT social_links_profile_id_url_key UNIQUE (profile_id, url);
ALTER TABLE media_references ADD CONSTRAINT media_references_unique_usage UNIQUE (media_asset_id, resource_type, resource_id, source);
ALTER TABLE sessions ADD CONSTRAINT sessions_session_token_hash_key UNIQUE (session_token_hash);
```

`schema_migrations.version` and every primary key are already unique through their primary-key constraints.

### Index Strategy

Required indexes:

```sql
CREATE INDEX idx_social_links_profile_sort ON social_links (profile_id, sort_order);
CREATE INDEX idx_experiences_public_order ON experiences (status, published_at DESC, sort_order);
CREATE INDEX idx_experiences_home_order ON experiences (status, sort_order, published_at DESC);
CREATE INDEX idx_talks_public_order ON talks (status, published_at DESC, sort_order);
CREATE INDEX idx_talks_featured_order ON talks (status, featured DESC, published_at DESC, sort_order);
CREATE INDEX idx_writings_public_order ON writings (status, published_at DESC, sort_order);
CREATE INDEX idx_writings_featured_order ON writings (status, featured DESC, published_at DESC, sort_order);
CREATE INDEX idx_projects_public_order ON projects (status, published_at DESC, sort_order);
CREATE INDEX idx_projects_featured_order ON projects (status, featured DESC, published_at DESC, sort_order);
CREATE INDEX idx_writing_tags_tag_id ON writing_tags (tag_id);
CREATE INDEX idx_project_tech_tech_id ON project_tech (tech_id);
CREATE INDEX idx_media_references_asset_id ON media_references (media_asset_id);
CREATE INDEX idx_sessions_admin_expires ON sessions (admin_id, expires_at);
```

The featured indexes match homepage ordering for talks, writing, and projects: `ORDER BY featured DESC, published_at DESC, sort_order ASC`. `idx_experiences_home_order` matches the homepage experience ordering: `ORDER BY sort_order ASC, published_at DESC`.

Partial indexes for published content can be added later if query volume requires them. The first PostgreSQL version should prefer straightforward indexes that match the current query patterns.

### Constraints And Foreign Keys

Keep the current foreign-key behavior:

- Profile avatar and content cover media use `ON DELETE RESTRICT`.
- OG image references use `ON DELETE SET NULL`.
- Join rows for tags and techs cascade when their parent content row is deleted.
- Tag and tech term deletion is restricted while join rows reference them.
- Sessions cascade when an admin is deleted.
- Media references restrict media deletion.

Use PostgreSQL `CHECK` constraints for:

- Valid status values.
- Positive media dimensions.
- Non-negative media size.
- Valid media reference resource types.
- Valid media reference sources.
- Singleton profile row.

## Repository SQL Changes

All repository SQL must be rewritten for PostgreSQL placeholders:

```text
? -> $1, $2, $3
```

All insert paths that need a new ID must use `RETURNING id`.

Examples:

```sql
INSERT INTO projects (...) VALUES (...) RETURNING id;
```

```sql
INSERT INTO sessions (...) VALUES (...) RETURNING id;
```

SQLite-specific insert behavior must be replaced:

```sql
INSERT OR IGNORE
```

becomes:

```sql
INSERT INTO tags (name, slug, created_at, updated_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (slug) DO NOTHING;
```

or, when the current display name should be refreshed:

```sql
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = EXCLUDED.updated_at
RETURNING id;
```

`LastInsertId()` must not be used with PostgreSQL.

## Concurrency Rules

PostgreSQL will expose write races that SQLite's single-writer behavior often hides. The migration must make these paths explicitly concurrency-safe.

Profile saves:

- Preserve the `If-Match` behavior for admin profile updates.
- The profile save transaction must prevent two concurrent requests with the same stale `If-Match` value from both succeeding.
- Acceptable implementation: `SELECT updated_at FROM profile WHERE id = 1 FOR UPDATE`, compare the ETag while holding the row lock, then update profile and replace social links in the same transaction.
- Alternative implementation: add a numeric `version` column, return ETags from that version, and `UPDATE profile ... WHERE id = 1 AND version = $oldVersion`, checking affected rows.
- A stale or concurrently consumed ETag returns the existing `409 conflict` response.

Slug generation:

- Keep slug uniqueness enforced by database unique constraints.
- Treat pre-insert slug availability checks as advisory only.
- Project, writing, and talk creation must handle `23505 unique_violation` on the slug constraint by retrying with the next suffix, such as `my-post-2`.
- Because a PostgreSQL error aborts the current transaction, retry by rolling back the current transaction and starting a fresh attempt, or use an atomic `INSERT ... ON CONFLICT (slug) DO NOTHING RETURNING id` loop inside a transaction.
- Limit slug retry attempts, for example 10 attempts, and return a conflict or validation error if no available slug is found.
- Slug updates for drafts need the same collision handling. Published and archived slug immutability rules stay unchanged.

Sort order writes:

- `nextSortOrder`, reorder endpoints, and any operation that reads current order then writes new `sort_order` values must be serialized per resource table.
- Preferred implementation: take a transaction-level PostgreSQL advisory lock keyed by resource type before `SELECT MAX(sort_order)`, bulk reorder validation, and reorder updates.
- Example lock keys can be derived from stable names such as `portfolio.sort.projects`, `portfolio.sort.writings`, `portfolio.sort.talks`, and `portfolio.sort.experiences`.
- Alternative implementation: run the operation at `SERIALIZABLE` isolation and retry serialization failures.
- This lock is separate from migration locks and backup write gates. It protects ordering invariants during normal concurrent admin writes.

Admin bootstrap:

- Admin bootstrap must be idempotent under concurrent app startup.
- Do not implement bootstrap as `SELECT COUNT(*)` followed by unconditional `INSERT`.
- Preferred implementation: take a bootstrap advisory lock, check for existing admins, then insert the initial admin inside the same transaction.
- The insert should still use `INSERT ... ON CONFLICT (email) DO NOTHING` as a final guard.
- If another instance creates the admin first, bootstrap should re-check that at least one admin exists and continue startup instead of failing on a unique constraint.

## Time Handling

Go code should scan nullable timestamps with `sql.NullTime` instead of `sql.NullString`.

Current helper direction:

```text
formatTime(time.Time) string      -> keep only for API formatting if useful
timePtrString(*time.Time) any     -> replace with timePtrValue(*time.Time) any
parseTime(string)                 -> remove from database scan paths
```

PostgreSQL stores and returns time values as timestamps, while JSON APIs continue exposing RFC 3339 strings.

Timestamp precision and timezone rules:

- Set each PostgreSQL session timezone to UTC through connection parameters, for example `timezone=UTC`, or an after-connect/session initialization hook.
- Before writing application-generated timestamps, normalize with `value.UTC().Truncate(time.Microsecond)`.
- Use one stable RFC 3339 microsecond format for API responses and ETag source strings.
- Profile ETags must be derived from the same normalized value that is written to and read from PostgreSQL, or from a dedicated monotonic `version` column.
- Tests must cover profile ETag stability across save/read cycles because PostgreSQL stores timestamps at microsecond precision while Go `time.Time` may contain nanoseconds.

## Boolean Handling

Go code should pass and scan real booleans.

Remove the storage-level `boolInt` pattern from SQL writes and scans. It can remain only if a frontend response or legacy helper still needs integer conversion, but database writes should use `true` and `false`.

## JSONB Handling

`media_assets.variants` stores generated derivative metadata as JSONB.

The media service can continue marshaling and unmarshaling the same Go map:

```go
map[string]Variant
```

Database writes pass `[]byte` or `string` JSON to PostgreSQL. Database reads scan JSONB into `[]byte` or `string` and unmarshal as today.

No JSONB GIN index is needed in the first PostgreSQL version because the app does not query inside variant JSON.

## Media Reference Maintenance

`media_references` is required system data, not a passive table.

Every profile or content write that can change media usage must rebuild references inside the same database transaction as the owning row update.

Repository ownership:

- `profile.Repository` must rebuild profile media references during `SaveAdmin`.
- `content.Repository` must rebuild project, writing, and talk references during create/update operations.
- The rebuild API must accept the caller's `*sql.Tx`; it must not open its own transaction or use the base `*sql.DB`.
- If the media service remains a separate package, expose a small reference-maintenance interface that repositories can call inside their existing write transactions.

Reference sources:

- Profile avatar: `resource_type = 'profile'`, `resource_id = 1`, `source = 'avatar'`.
- Profile OG image: `resource_type = 'profile'`, `resource_id = 1`, `source = 'og_image'`.
- Project, writing, and talk cover images: `source = 'cover'`.
- Project, writing, and talk OG images: `source = 'og_image'`.
- Markdown images in project and writing bodies: `source = 'markdown'`.

Write flow:

1. Validate explicit media IDs before saving the owning row.
2. Parse Markdown for `media://asset/{id}/{variant}` references.
3. Validate each referenced asset exists and the requested variant exists in `media_assets.variants`.
4. Save the profile/content row.
5. Delete existing `media_references` for that resource.
6. Insert the rebuilt reference set.
7. Commit the transaction.

Reference rebuilding should de-duplicate repeated Markdown references to the same asset/source pair before insert. The unique constraint remains the final guard.

Markdown parsing:

- Only the internal syntax `media://asset/{id}/{variant}` creates Markdown media references.
- Raw `/uploads/*`, remote URLs, `data:`, and SVG image references are rejected by new backend validation on content save. The API returns `validation_error` with a field-level error for `content_md`.
- Missing media IDs, unknown variants, and malformed `media://` image URLs are also backend validation errors.
- The frontend Markdown renderer may still render unsupported images as empty output defensively, but backend save validation is the authoritative gate for persisted content.
- Store asset-level references only; variants remain in Markdown and in `media_assets.variants`.

Media deletion must continue checking `media_references` so referenced assets cannot be deleted.

## Media Blob Storage Abstraction

File storage is the part of this system that should be designed as pluggable now, because local disk and MinIO have a natural interface boundary.

Introduce a blob storage interface for generated media derivatives and temporary raw upload handling:

```go
type BlobStore interface {
	Put(ctx context.Context, key string, reader io.Reader, contentType string) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	PublicURL(ctx context.Context, key string) string
}
```

First implementation:

```text
LocalBlobStore
```

`LocalBlobStore` keeps the current behavior:

- Store public derivatives under `UPLOADS_DIR`.
- Serve public derivatives under `/uploads/*`.
- Store raw temporary uploads under `PRIVATE_UPLOADS_DIR`.
- Exclude private temporary uploads from backup.
- In the PostgreSQL migration stage, deleting a media asset deletes metadata only and leaves existing derivative files in place, matching current behavior.
- Physical blob cleanup is a separate future task that should scan unreferenced blob keys and delete them in a controlled cleanup job, not inline during metadata delete.

Future implementation:

```text
MinIOBlobStore
```

The PostgreSQL redesign should not require MinIO, but it should avoid baking filesystem assumptions into the media metadata schema. Database rows should store stable blob keys and variant metadata, while the active `BlobStore` decides how a blob key becomes a public URL.

In this stage, existing variant paths can remain same-origin `/uploads/...` URLs for compatibility. A later MinIO migration can evolve variant metadata from path-oriented fields to key-oriented fields if needed.

## Media Upload Consistency

Media upload spans filesystem writes and a database insert, so the PostgreSQL redesign must define failure cleanup explicitly.

First-stage local filesystem behavior:

- Generate derivatives into a staging directory under `PRIVATE_UPLOADS_DIR` or a non-public staging area.
- Insert the `media_assets` row only after derivative generation succeeds.
- After the database insert commits, atomically move the staged derivative directory into its final public `UPLOADS_DIR` location where the filesystem supports rename.
- If the database insert fails, delete the staged derivative directory before returning the error.
- If the final move fails after the database insert, delete the `media_assets` row in a compensating cleanup path or mark the asset unavailable and return an upload error.
- Log cleanup failures with the storage key so an orphan cleanup command can report them later.

If implementation keeps the current direct-to-public derivative generation during the first cut, it must at minimum delete the generated derivative directory whenever the PostgreSQL insert fails. The staging approach is preferred because it avoids exposing files before metadata commit.

Backups should only include activated public derivatives, not staging directories.

## Query Optimization

The PostgreSQL redesign should also remove the highest-impact N+1 storage patterns.

Required first-pass optimizations:

- `media.List` should compute `referenced` with `EXISTS` in the list query instead of calling `IsReferenced` once per row.
- `media.List` should preserve case-insensitive admin search by using `ILIKE` for `file_name` or `lower(file_name) LIKE lower($1)`.
- Project list queries should fetch projects and project tech terms in batches.
- Writing list queries should fetch writings and tags in batches.
- Public list routes should use the same batch hydration path as admin list routes where possible.

Recommended batch pattern:

```sql
SELECT project_id, techs.name, techs.slug, project_tech.sort_order
FROM project_tech
JOIN techs ON techs.id = project_tech.tech_id
WHERE project_id = ANY($1::bigint[])
ORDER BY project_id, project_tech.sort_order;
```

When the ID slice is empty, repository helpers must return an empty result without querying PostgreSQL. This avoids empty-array type inference issues and unnecessary round trips. Non-empty ID slices should be bound as PostgreSQL `bigint[]` values compatible with `database/sql` plus the pgx driver.

This keeps Repository APIs stable while reducing per-request query counts.

## Dynamic SQL Safety

The code currently builds some SQL with table names. PostgreSQL migration should keep that limited and whitelist-driven.

Allowed dynamic table names:

```text
projects
writings
talks
experiences
tags
techs
project_tech
writing_tags
```

Allowed dynamic column use must also be whitelist-driven. Current homepage summary queries should either be split into three static queries or limited to these table/summary-column pairs:

```text
talks -> summary
writings -> excerpt
projects -> summary
```

Repository helpers must never accept arbitrary table or column names from HTTP request values.

## Error Mapping

PostgreSQL constraint errors should be mapped to existing domain errors where practical.

Useful PostgreSQL SQLSTATE codes:

```text
40001 serialization_failure
40P01 deadlock_detected
23505 unique_violation
23503 foreign_key_violation
23514 check_violation
```

Examples:

- Duplicate slug maps to conflict behavior.
- Invalid status maps to validation behavior.
- Missing referenced media maps to validation or conflict behavior depending on the route.
- Sort order operations that use `SERIALIZABLE` must retry boundedly on `40001 serialization_failure`.
- Operations that take advisory locks or update multiple rows should retry boundedly on `40P01 deadlock_detected` when the operation is known to be idempotent.
- Media delete must map `23503 foreign_key_violation` from `DELETE FROM media_assets` to `ErrReferenced` and return the existing `409 conflict` response. This handles the race where another transaction inserts a media reference after the pre-delete reference check.
- Non-idempotent operations must not be retried unless they are wrapped so the full attempt can be safely replayed.

The public API error shape does not change.

## Backup Design

SQLite `VACUUM INTO` is replaced by `pg_dump`.

Recommended backup output:

```text
backup/
  database.dump
  uploads/
```

Database backup command:

```text
pg_dump --format=custom --no-owner --no-acl --host <host> --port <port> --username <user> --dbname <database> --file <destination>/database.dump
```

Do not pass a password-bearing `DATABASE_URL` as a process argument and do not log the full dump command with secrets. Use `PGPASSWORD` in the child process environment, `.pgpass`, or split non-secret connection arguments plus a secret environment variable.

Backup rules:

- Introduce a real application write gate before relying on backup consistency.
- Every profile, content, auth-session mutation that matters for backup consistency, media metadata write, media delete, and media upload path must enter the write gate.
- Backup acquires the same gate before running `pg_dump` and keeps it until the upload directory copy completes.
- The application write gate only blocks writes through this Go process. It does not block another service instance, `psql`, or external jobs that write directly to PostgreSQL.
- For single-process deployment, the write gate is enough for app-level consistency. For multi-process deployment, use maintenance mode, a deployment-level singleton backup job, or PostgreSQL/object-store operational snapshots instead.
- Run `pg_dump` first.
- Copy `UPLOADS_DIR` after the database dump while writes remain blocked.
- Continue excluding `PRIVATE_UPLOADS_DIR`.
- Write into a temporary backup directory and rename it into place after success.
- Log backup start and finish timestamps.

This gives a consistent database and upload-derivative snapshot without introducing object storage in this stage.

Restore command shape:

```text
pg_restore --clean --if-exists --no-owner --host <host> --port <port> --username <user> --dbname <database> database.dump
```

Uploads are restored by copying the backed-up `uploads/` tree back to `UPLOADS_DIR`.

Restore rules:

- Restore requires the app to be stopped or placed in maintenance mode before touching PostgreSQL or `UPLOADS_DIR`.
- Restore database first into a known target database while the app is not serving writes.
- Restore uploads into a temporary directory, verify the copy, then atomically rename it into place where the filesystem supports it.
- Keep the previous uploads directory until database restore and upload restore have both succeeded.
- If database restore succeeds but upload restore fails, keep the app in maintenance mode and either retry upload restore or restore the previous database dump before serving traffic.
- If upload restore succeeds but database restore fails, keep the old active uploads directory and do not switch the restored upload tree into place.
- Log restore start, database restore completion, upload restore completion, and final activation.

## SQLite To PostgreSQL Data Migration

If existing SQLite data must be preserved, use a one-time migration command rather than trying to support both databases at runtime.

Suggested command:

```text
go run ./cmd/migrate-sqlite-to-postgres --sqlite data/portfolio.db --postgres "$env:DATABASE_URL"
```

The `--postgres` target database must already exist. The command should fail fast with a clear message when it cannot connect to the target database.

If the migration command is expected to create the target database, it needs a separate maintenance connection:

```text
go run ./cmd/migrate-sqlite-to-postgres --sqlite data/portfolio.db --postgres "$env:DATABASE_URL" --postgres-admin "$env:POSTGRES_ADMIN_URL" --create-database portfolio
```

`POSTGRES_ADMIN_URL` should connect to an existing maintenance database such as `postgres`, not to the database being created.

Migration flow:

1. Stop the running app or place it in maintenance mode.
2. Run the current SQLite backup.
3. Create the PostgreSQL database beforehand, or provide a maintenance connection through `--postgres-admin` and `--create-database`.
4. Run PostgreSQL migrations.
5. Import tables in foreign-key order.
6. Preserve existing numeric IDs during import.
7. Convert timestamp strings to UTC `time.Time`.
8. Convert integer booleans to PostgreSQL booleans.
9. Convert `variants_json` text to JSONB.
10. Skip active sessions so admins must log in again.
11. Reset PostgreSQL identity sequences after importing explicit IDs.
12. Compare row counts and selected sample records.
13. Start the app with `DATABASE_URL`.

Foreign-key import order:

```text
admins
media_assets
profile
social_links
experiences
talks
writings
tags
writing_tags
projects
techs
project_tech
media_references
```

Sessions are intentionally not imported.

Special import rules:

- The initial PostgreSQL migration creates the singleton `profile` row with `id = 1`.
- SQLite import must not use a plain `INSERT` for `profile`.
- Import `profile` with `INSERT ... ON CONFLICT (id) DO UPDATE` or update the existing singleton row directly.
- The importer must not truncate `profile` unless it also recreates the singleton invariant inside the same import transaction.
- After importing explicit IDs into identity columns, reset every affected identity sequence with `setval` based on the imported max ID.

Rollback plan:

- Keep the SQLite backup and upload snapshot.
- If PostgreSQL verification fails before cutover, keep using the SQLite-backed release.
- If cutover has already happened, stop writes, restore the previous release and SQLite backup, then replay any manually identified content changes made after cutover.

## Test Strategy

Backend storage tests should run against PostgreSQL through `TEST_DATABASE_URL`.

Recommended test isolation:

- Each test package creates a unique schema.
- The test helper sets `search_path` for every pooled connection through connection runtime parameters, for example `options=-c search_path=<schema>,public`.
- Do not rely on one `SET search_path` statement executed on `*sql.DB`; it only affects whichever pooled connection handled that statement.
- Migrations run inside that schema.
- The schema is dropped during cleanup.

This avoids requiring permission to create and drop whole databases while still isolating tests.

If runtime `search_path` parameters are not available in a specific test environment, the fallback is to set `MaxOpenConns(1)`, pin a single `db.Conn(ctx)`, run `SET search_path` on that connection, and run migrations plus repository checks through helpers that use that pinned connection. The preferred path remains runtime parameters because it exercises normal pooled behavior.

Tests that need PostgreSQL should skip with a clear message when `TEST_DATABASE_URL` is missing. CI and local full verification should provide it.

Required test coverage:

- PostgreSQL migrations create all tables, constraints, and indexes.
- Migration locking prevents concurrent double-apply.
- Migration runner acquires the advisory lock before creating `schema_migrations`.
- Migration runner executes multi-statement files statement-by-statement or rejects multi-statement files when no safe splitter is available.
- Profile singleton constraint rejects `id != 1`.
- SQLite-to-PostgreSQL import updates the existing `profile id = 1` singleton without primary-key conflict.
- Concurrent admin bootstrap across two app instances results in one admin row and both instances continue startup.
- Concurrent profile saves with the same ETag allow only one write and return conflict for the other.
- Concurrent project, writing, or talk creation with the same title resolves slug collisions deterministically or returns a controlled conflict after bounded retries.
- Concurrent project, writing, talk, or experience creation does not assign duplicate `sort_order` values.
- Concurrent reorder and create operations for the same resource table preserve a valid ordering or retry cleanly.
- Foreign keys enforce media delete restrictions.
- `RETURNING id` paths work for admins, sessions, media, projects, writings, talks, and experiences.
- `ON CONFLICT` term upsert works for tags and techs.
- Status checks reject invalid values.
- Boolean fields scan as Go booleans.
- `TIMESTAMPTZ` fields scan as `time.Time` and serialize as RFC 3339.
- Timestamp writes truncate to microsecond precision and profile ETags remain stable after round trips.
- `media_assets.variants` round-trips as JSONB.
- Public content queries exclude drafts, archived rows, and future published rows.
- Batch hydration returns project techs and writing tags in the expected order.
- Media list returns `referenced` state without per-row reference queries.
- Media list search remains case-insensitive after moving from SQLite `LIKE` to PostgreSQL.
- Profile and content saves rebuild `media_references` for avatar, cover, OG image, and Markdown media references in the same transaction as the content write.
- Backend content save validation rejects raw `/uploads/*`, remote, `data:`, SVG, malformed `media://`, missing media ID, and unknown variant Markdown image references with `validation_error`.
- Media upload cleans up generated derivative files or staging directories when the PostgreSQL metadata insert fails.
- Media delete maps a concurrent `23503 foreign_key_violation` to `ErrReferenced` and HTTP `409 conflict`.
- Sort order operations using `SERIALIZABLE` retry boundedly on `40001`, and advisory-lock operations retry boundedly on `40P01` where the full attempt is safe to replay.
- Backup command produces a PostgreSQL dump and upload copy.
- Backup gate blocks content writes and media uploads while backup holds the gate.
- Restore documentation or restore command enforces maintenance mode and avoids half-restored database/uploads states.

Frontend tests do not need storage-specific changes unless API response shapes change. This design keeps response shapes stable.

## Delivery Sequence

1. Add PostgreSQL dependency and redesign `internal/db` configuration, connection, ping, pinned-connection migration locking, and statement-by-statement migration execution.
2. Replace the initial migration with PostgreSQL schema SQL.
3. Update config loading and documentation from `DATABASE_PATH` to `DATABASE_URL`.
4. Introduce business-facing store interfaces where handlers currently depend directly on concrete repositories.
5. Keep PostgreSQL as the only database implementation behind those interfaces.
6. Rewrite repository SQL placeholders and insert-ID paths.
7. Replace SQLite-specific upserts with PostgreSQL `ON CONFLICT`.
8. Make admin bootstrap, profile `If-Match` saves, sort-order writes, reorder operations, and routable slug creation safe under concurrent PostgreSQL writes.
9. Convert timestamp scans from strings to `sql.NullTime` or `time.Time`, with UTC microsecond normalization.
10. Convert boolean storage from integers to PostgreSQL booleans.
11. Rename `media_assets.variants_json` to `variants` and store JSONB.
12. Wire profile and content saves to rebuild `media_references` in the same write transaction.
13. Add backend Markdown media validation and preserve the existing public API error shape.
14. Define media upload staging or cleanup behavior so filesystem derivatives and PostgreSQL metadata do not drift on failed writes.
15. Map PostgreSQL FK and transient concurrency errors to domain errors or bounded retry paths.
16. Optimize media, project, and writing list queries to avoid N+1 reads.
17. Replace SQLite backup behavior with `pg_dump` plus upload-directory copy, including the application write gate, restore maintenance-mode rules, and half-restore rollback behavior.
18. Add PostgreSQL test helpers using `TEST_DATABASE_URL`.
19. Update README deployment and development instructions.
20. Add the optional one-time SQLite-to-PostgreSQL migration command if existing data must be carried forward.

Independent media storage delivery point:

1. Introduce `LocalBlobStore` behind a `BlobStore` interface while preserving current local upload behavior.
2. Keep PostgreSQL media metadata compatible with local blob keys and public `/uploads/*` URLs.
3. Add `MinIOBlobStore` in a separate future change when object storage migration is approved.

## Open Review Points

- Confirm whether existing SQLite data must be migrated or whether a fresh PostgreSQL database is acceptable.
- Confirm whether local tests may depend on the LAN PostgreSQL service, or whether CI should provide its own PostgreSQL service.
- Confirm whether backup should remain an internal Go command or become an operational script documented in README.
