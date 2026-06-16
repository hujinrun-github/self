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
- Use a PostgreSQL advisory lock around the migration run so concurrent app startups cannot apply the same migration twice.
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
id SMALLINT PRIMARY KEY CHECK (id = 1)
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

### Index Strategy

Required indexes:

```sql
CREATE INDEX idx_social_links_profile_sort ON social_links (profile_id, sort_order);
CREATE INDEX idx_experiences_public_order ON experiences (status, published_at DESC, sort_order);
CREATE INDEX idx_talks_public_order ON talks (status, published_at DESC, sort_order);
CREATE INDEX idx_talks_featured_order ON talks (status, featured, sort_order, published_at DESC);
CREATE INDEX idx_writings_public_order ON writings (status, published_at DESC, sort_order);
CREATE INDEX idx_writings_featured_order ON writings (status, featured, sort_order, published_at DESC);
CREATE INDEX idx_projects_public_order ON projects (status, published_at DESC, sort_order);
CREATE INDEX idx_projects_featured_order ON projects (status, featured, sort_order, published_at DESC);
CREATE INDEX idx_writing_tags_tag_id ON writing_tags (tag_id);
CREATE INDEX idx_project_tech_tech_id ON project_tech (tech_id);
CREATE INDEX idx_media_references_asset_id ON media_references (media_asset_id);
CREATE INDEX idx_sessions_admin_expires ON sessions (admin_id, expires_at);
```

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

## Time Handling

Go code should scan nullable timestamps with `sql.NullTime` instead of `sql.NullString`.

Current helper direction:

```text
formatTime(time.Time) string      -> keep only for API formatting if useful
timePtrString(*time.Time) any     -> replace with timePtrValue(*time.Time) any
parseTime(string)                 -> remove from database scan paths
```

PostgreSQL stores and returns time values as timestamps, while JSON APIs continue exposing RFC 3339 strings.

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

Future implementation:

```text
MinIOBlobStore
```

The PostgreSQL redesign should not require MinIO, but it should avoid baking filesystem assumptions into the media metadata schema. Database rows should store stable blob keys and variant metadata, while the active `BlobStore` decides how a blob key becomes a public URL.

In this stage, existing variant paths can remain same-origin `/uploads/...` URLs for compatibility. A later MinIO migration can evolve variant metadata from path-oriented fields to key-oriented fields if needed.

## Query Optimization

The PostgreSQL redesign should also remove the highest-impact N+1 storage patterns.

Required first-pass optimizations:

- `media.List` should compute `referenced` with `EXISTS` in the list query instead of calling `IsReferenced` once per row.
- Project list queries should fetch projects and project tech terms in batches.
- Writing list queries should fetch writings and tags in batches.
- Public list routes should use the same batch hydration path as admin list routes where possible.

Recommended batch pattern:

```sql
SELECT project_id, techs.name, techs.slug, project_tech.sort_order
FROM project_tech
JOIN techs ON techs.id = project_tech.tech_id
WHERE project_id = ANY($1)
ORDER BY project_id, project_tech.sort_order;
```

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

Repository helpers must never accept arbitrary table or column names from HTTP request values.

## Error Mapping

PostgreSQL constraint errors should be mapped to existing domain errors where practical.

Useful PostgreSQL SQLSTATE codes:

```text
23505 unique_violation
23503 foreign_key_violation
23514 check_violation
```

Examples:

- Duplicate slug maps to conflict behavior.
- Invalid status maps to validation behavior.
- Missing referenced media maps to validation or conflict behavior depending on the route.

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
pg_dump --format=custom --no-owner --no-acl --file <destination>/database.dump <DATABASE_URL>
```

Backup rules:

- Keep the existing application write mutex concept during backup.
- Block admin writes and media uploads while the backup is running.
- Run `pg_dump` first.
- Copy `UPLOADS_DIR` after the database dump while writes remain blocked.
- Continue excluding `PRIVATE_UPLOADS_DIR`.
- Write into a temporary backup directory and rename it into place after success.
- Log backup start and finish timestamps.

This gives a consistent database and upload-derivative snapshot without introducing object storage in this stage.

Restore command shape:

```text
pg_restore --clean --if-exists --no-owner --dbname <DATABASE_URL> database.dump
```

Uploads are restored by copying the backed-up `uploads/` tree back to `UPLOADS_DIR`.

## SQLite To PostgreSQL Data Migration

If existing SQLite data must be preserved, use a one-time migration command rather than trying to support both databases at runtime.

Suggested command:

```text
go run ./cmd/migrate-sqlite-to-postgres --sqlite data/portfolio.db --postgres "$env:DATABASE_URL"
```

Migration flow:

1. Stop the running app or place it in maintenance mode.
2. Run the current SQLite backup.
3. Create the PostgreSQL database if it does not exist.
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

Rollback plan:

- Keep the SQLite backup and upload snapshot.
- If PostgreSQL verification fails before cutover, keep using the SQLite-backed release.
- If cutover has already happened, stop writes, restore the previous release and SQLite backup, then replay any manually identified content changes made after cutover.

## Test Strategy

Backend storage tests should run against PostgreSQL through `TEST_DATABASE_URL`.

Recommended test isolation:

- Each test package creates a unique schema.
- The test connection sets `search_path` to that schema.
- Migrations run inside that schema.
- The schema is dropped during cleanup.

This avoids requiring permission to create and drop whole databases while still isolating tests.

Tests that need PostgreSQL should skip with a clear message when `TEST_DATABASE_URL` is missing. CI and local full verification should provide it.

Required test coverage:

- PostgreSQL migrations create all tables, constraints, and indexes.
- Migration locking prevents concurrent double-apply.
- Profile singleton constraint rejects `id != 1`.
- Foreign keys enforce media delete restrictions.
- `RETURNING id` paths work for admins, sessions, media, projects, writings, talks, and experiences.
- `ON CONFLICT` term upsert works for tags and techs.
- Status checks reject invalid values.
- Boolean fields scan as Go booleans.
- `TIMESTAMPTZ` fields scan as `time.Time` and serialize as RFC 3339.
- `media_assets.variants` round-trips as JSONB.
- Public content queries exclude drafts, archived rows, and future published rows.
- Batch hydration returns project techs and writing tags in the expected order.
- Media list returns `referenced` state without per-row reference queries.
- Backup command produces a PostgreSQL dump and upload copy.

Frontend tests do not need storage-specific changes unless API response shapes change. This design keeps response shapes stable.

## Delivery Sequence

1. Add PostgreSQL dependency and redesign `internal/db` configuration, connection, ping, and migration locking.
2. Replace the initial migration with PostgreSQL schema SQL.
3. Update config loading and documentation from `DATABASE_PATH` to `DATABASE_URL`.
4. Introduce business-facing store interfaces where handlers currently depend directly on concrete repositories.
5. Keep PostgreSQL as the only database implementation behind those interfaces.
6. Rewrite repository SQL placeholders and insert-ID paths.
7. Replace SQLite-specific upserts with PostgreSQL `ON CONFLICT`.
8. Convert timestamp scans from strings to `sql.NullTime` or `time.Time`.
9. Convert boolean storage from integers to PostgreSQL booleans.
10. Rename `media_assets.variants_json` to `variants` and store JSONB.
11. Introduce `LocalBlobStore` behind a `BlobStore` interface while preserving current local upload behavior.
12. Optimize media, project, and writing list queries to avoid N+1 reads.
13. Replace SQLite backup behavior with `pg_dump` plus upload-directory copy.
14. Add PostgreSQL test helpers using `TEST_DATABASE_URL`.
15. Update README deployment and development instructions.
16. Add the optional one-time SQLite-to-PostgreSQL migration command if existing data must be carried forward.

## Open Review Points

- Confirm whether existing SQLite data must be migrated or whether a fresh PostgreSQL database is acceptable.
- Confirm whether local tests may depend on the LAN PostgreSQL service, or whether CI should provide its own PostgreSQL service.
- Confirm whether backup should remain an internal Go command or become an operational script documented in README.
