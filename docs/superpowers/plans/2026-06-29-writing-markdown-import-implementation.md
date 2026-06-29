# Writing Markdown Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preview-first Markdown import workflow for admin writing so local `.md` files can create or overwrite draft writings, import referenced local image/audio/video assets into MinIO-backed media storage, and render those assets publicly through stable same-origin `/media/{assetID}/{variant}` URLs.

**Architecture:** Keep article storage in `writings` and `writings.content_md`, but add import-session tables, hybrid media storage support, and a writing-import orchestration service that rewrites local file references into durable `media://asset/...` references. Public rendering should stop depending on `/uploads/...` and instead resolve all media through `item.media` plus a backend-owned `/media/{assetID}/{variant}` route, while admin stays Chinese-first and uses TDD to ship one working slice at a time.

**Tech Stack:** Go 1.26.4, PostgreSQL, chi, React 19, React Router 7, Vitest, Testing Library, MinIO Go SDK, embedded SQL migrations.

---

## File Structure

- Create `internal/db/migrations/003_writing_import.sql`: add hybrid media columns, import session tables, and indexes.
- Modify `internal/db/postgres_test.go`: migration coverage for new tables, constraints, and nullable image dimensions.
- Modify `internal/config/config.go`: add `MEDIA_BLOB_BACKEND`, `MINIO_*`, and import-session cleanup settings.
- Modify `internal/config/config_test.go`: verify optional MinIO config loads and secrets are not leaked in `Config.String()`.
- Create `internal/media/blobstore.go`: `BlobStore` interface and shared backend types.
- Create `internal/media/blobstore_local.go`: local filesystem blob store rooted at `UPLOADS_DIR`.
- Create `internal/media/blobstore_minio.go`: MinIO-backed blob store using stable object keys.
- Create `internal/media/blobstore_test.go`: unit tests for local key resolution and MinIO adapter behavior.
- Modify `internal/media/media.go`: support `storage_backend`, `lifecycle_state`, `media_kind`, nullable dimensions, `PrepareImportAsset`, `ActivatePreparedAsset`, `CleanupPreparedAsset`, and lifecycle-aware `List`.
- Create `internal/media/public_routes.go`: public `/media/{id}/{variant}` handler that streams from the correct backend.
- Create `internal/media/public_routes_test.go`: coverage for local and MinIO asset delivery.
- Modify `internal/media/routes.go`: keep admin upload image-only, but filter pending assets out of list responses.
- Modify `internal/media/media_test.go`: extend service tests for pending assets, audio/video preparation, and cleanup.
- Modify `cmd/server/main.go`: wire blob-store config, MinIO client, public media routes, startup cleanup, and periodic import cleanup sweeper.
- Modify `internal/content/writing.go`: add `Media` to `Writing`, keep `translation_source_version` behavior, and reuse existing write path for commit.
- Create `internal/content/markdown_media.go`: extract `media://asset/...` refs and build `MediaMap` for public detail responses.
- Create `internal/content/markdown_media_test.go`: dedupe, batch lookup, and `/media/...` URL mapping tests.
- Modify `internal/content/public.go`: enrich writing detail reads with `item.media`.
- Modify `internal/content/routes.go`: register preview, recovery, and commit endpoints under `/api/admin/writing/imports/*`.
- Create `internal/content/writing_import.go`: front matter parsing, local path resolution, media preparation, session persistence, and commit orchestration.
- Create `internal/content/writing_import_test.go`: parser, rewrite, traversal rejection, and overwrite warning coverage.
- Create `internal/content/writing_import_routes.go`: multipart preview, preview restore, and commit handlers.
- Create `internal/content/writing_import_routes_test.go`: route-level preview/restore/commit tests and cleanup checks.
- Modify `internal/content/content_test.go`: writing validation, conflict handling, and public detail response assertions.
- Modify `web/src/lib/types.ts`: make `MediaVariant.width` and `height` optional.
- Modify `web/src/lib/media.ts`: keep `resolveMediaURL(...)`, but let markdown rendering resolve `media://` before link safety checks.
- Modify `web/src/components/markdown/MarkdownView.tsx`: stop gating image rewrites on `/uploads/...`, resolve anchor links, and only render resolved `/media/...` URLs.
- Modify `web/src/components/markdown/MarkdownView.test.tsx`: image and audio/video media resolution coverage.
- Modify `web/src/features/public/detail.tsx`: continue reading `detail.item.media` with no contract change.
- Create `web/src/features/admin/writingImport.ts`: shared frontend types and request helpers for preview/restore/commit.
- Create `web/src/features/admin/WritingImportDialog.tsx`: two-step chooser + preview UI.
- Create `web/src/features/admin/WritingImportDialog.test.tsx`: preview-first workflow tests.
- Modify `web/src/features/admin/ContentListPage.tsx`: add list-page `Import Markdown` entry for writing.
- Modify `web/src/features/admin/ContentEditPage.tsx`: add draft-only overwrite entry for writing and preview restore behavior.
- Modify `web/src/features/admin/MediaPage.tsx`: represent audio/video assets with placeholder tiles and media-aware markdown copy helpers.
- Modify `web/src/features/admin/AdminUI.test.tsx`: list/edit entry points, media page placeholders, and upload reference text coverage.
- Modify `web/src/features/admin/Admin.module.css`: modal, preview split-view, and media placeholder styles.
- Modify `go.mod` and `go.sum`: add MinIO Go SDK dependency.
- Modify `README.md`: document hybrid media config, MinIO requirements, and import feature test commands.

## Task 1: Add Hybrid Media Schema And Runtime Config

**Files:**
- Create: `internal/db/migrations/003_writing_import.sql`
- Modify: `internal/db/postgres_test.go`
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`
- Modify: `go.mod`
- Modify: `go.sum`

- [ ] **Step 1: Write the failing schema and config tests**

Add to `internal/config/config_test.go`:

```go
func TestLoadIncludesOptionalMediaBlobConfig(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "1234567890abcdef")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgres://postgres@localhost:5432/portfolio?sslmode=disable")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	t.Setenv("MEDIA_BLOB_BACKEND", "hybrid")
	t.Setenv("MINIO_ENDPOINT", "http://127.0.0.1:19000")
	t.Setenv("MINIO_ACCESS_KEY", "minio-user")
	t.Setenv("MINIO_SECRET_KEY", "minio-secret")
	t.Setenv("MINIO_BUCKET", "portfolio-media")
	t.Setenv("MINIO_USE_SSL", "false")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.MediaBlobBackend != "hybrid" {
		t.Fatalf("MediaBlobBackend = %q", cfg.MediaBlobBackend)
	}
	if cfg.MinIOEndpoint != "http://127.0.0.1:19000" {
		t.Fatalf("MinIOEndpoint = %q", cfg.MinIOEndpoint)
	}
	if cfg.MinIOBucket != "portfolio-media" {
		t.Fatalf("MinIOBucket = %q", cfg.MinIOBucket)
	}
	if cfg.MinIOUseSSL {
		t.Fatal("MinIOUseSSL = true, want false")
	}
}
```

Add to `internal/db/postgres_test.go`:

```go
func TestPostgresMigrationCreatesWritingImportSchema(t *testing.T) {
	database := openMigratedPostgres(t)

	var widthNullable bool
	if err := database.QueryRow(`
SELECT is_nullable = 'YES'
FROM information_schema.columns
WHERE table_name = 'media_assets' AND column_name = 'width'
`).Scan(&widthNullable); err != nil {
		t.Fatalf("query width column: %v", err)
	}
	if !widthNullable {
		t.Fatal("media_assets.width should be nullable after migration")
	}

	for _, table := range []string{"writing_import_sessions", "writing_import_session_assets"} {
		var exists bool
		if err := database.QueryRow(`
SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_name = $1
)`, table).Scan(&exists); err != nil {
			t.Fatalf("query table %s: %v", table, err)
		}
		if !exists {
			t.Fatalf("expected table %s to exist", table)
		}
	}
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
go test ./internal/config -run TestLoadIncludesOptionalMediaBlobConfig -count=1
go test ./internal/db -run TestPostgresMigrationCreatesWritingImportSchema -count=1
```

Expected: FAIL because `Config` does not yet expose media blob settings and the import-session migration does not exist.

- [ ] **Step 3: Write the minimal config and migration implementation**

Update `internal/config/config.go`:

```go
type Config struct {
	AppOrigin         string
	AllowedOrigins    []string
	PublicBaseURL     string
	SiteName          string
	AdminEmail        string
	AdminPassword     string
	SessionSecret     string
	DatabaseURL       string
	UploadsDir        string
	PrivateUploadsDir string

	MediaBlobBackend string
	MinIOEndpoint    string
	MinIOAccessKey   string
	MinIOSecretKey   string
	MinIOBucket      string
	MinIOUseSSL      bool

	SessionTTL                time.Duration
	SessionIdleTimeout        time.Duration
	TranslationProvider       string
	TranslationAPIKey         string
	TranslationBaseURL        string
	TranslationModel          string
	TranslationTimeoutSeconds int
}
```

And in `Load()`:

```go
cfg := Config{
	AppOrigin:                 appOrigin,
	AllowedOrigins:            parseAllowedOrigins(appOrigin, os.Getenv("APP_ORIGINS")),
	PublicBaseURL:             os.Getenv("PUBLIC_BASE_URL"),
	SiteName:                  os.Getenv("SITE_NAME"),
	AdminEmail:                os.Getenv("ADMIN_EMAIL"),
	AdminPassword:             os.Getenv("ADMIN_PASSWORD"),
	SessionSecret:             os.Getenv("SESSION_SECRET"),
	DatabaseURL:               os.Getenv("DATABASE_URL"),
	UploadsDir:                os.Getenv("UPLOADS_DIR"),
	PrivateUploadsDir:         os.Getenv("PRIVATE_UPLOADS_DIR"),
	MediaBlobBackend: strings.TrimSpace(os.Getenv("MEDIA_BLOB_BACKEND")),
	MinIOEndpoint:    strings.TrimSpace(os.Getenv("MINIO_ENDPOINT")),
	MinIOAccessKey:   strings.TrimSpace(os.Getenv("MINIO_ACCESS_KEY")),
	MinIOSecretKey:   strings.TrimSpace(os.Getenv("MINIO_SECRET_KEY")),
	MinIOBucket:      strings.TrimSpace(os.Getenv("MINIO_BUCKET")),
	MinIOUseSSL:      strings.EqualFold(strings.TrimSpace(os.Getenv("MINIO_USE_SSL")), "true"),
	SessionTTL:                durationFromHours("SESSION_TTL_HOURS", 12),
	SessionIdleTimeout:        durationFromMinutes("SESSION_IDLE_TIMEOUT_MINUTES", 120),
	TranslationProvider:       strings.TrimSpace(os.Getenv("TRANSLATION_PROVIDER")),
	TranslationAPIKey:         strings.TrimSpace(os.Getenv("TRANSLATION_API_KEY")),
	TranslationBaseURL:        strings.TrimSpace(os.Getenv("TRANSLATION_BASE_URL")),
	TranslationModel:          strings.TrimSpace(os.Getenv("TRANSLATION_MODEL")),
	TranslationTimeoutSeconds: int(durationFromSeconds("TRANSLATION_TIMEOUT_SECONDS", 30) / time.Second),
}
if cfg.MediaBlobBackend == "" {
	cfg.MediaBlobBackend = "local"
}
```

Create `internal/db/migrations/003_writing_import.sql`:

```sql
ALTER TABLE media_assets
  ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'local' CHECK (storage_backend IN ('local', 'minio')),
  ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'pending_import')),
  ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'image' CHECK (media_kind IN ('image', 'video', 'audio'));

ALTER TABLE media_assets
  ALTER COLUMN width DROP NOT NULL,
  ALTER COLUMN height DROP NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'media_assets'::regclass
      AND pg_get_constraintdef(oid) LIKE '%width > 0%'
  LOOP
    EXECUTE format('ALTER TABLE media_assets DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'media_assets'::regclass
      AND pg_get_constraintdef(oid) LIKE '%height > 0%'
  LOOP
    EXECUTE format('ALTER TABLE media_assets DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_kind_dimensions_check CHECK (
    (media_kind = 'image' AND width IS NOT NULL AND width > 0 AND height IS NOT NULL AND height > 0)
    OR
    (media_kind IN ('audio', 'video') AND width IS NULL AND height IS NULL)
  );

CREATE TABLE writing_import_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  admin_session_id BIGINT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('create', 'overwrite')),
  target_writing_id BIGINT REFERENCES writings(id) ON DELETE SET NULL,
  target_writing_etag TEXT,
  source_file_name TEXT NOT NULL,
  source_checksum_sha256 TEXT NOT NULL,
  front_matter JSONB NOT NULL DEFAULT '{}'::jsonb,
  ignored_front_matter_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  original_markdown TEXT NOT NULL,
  rewritten_markdown TEXT NOT NULL,
  parsed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('preview_ready', 'committed', 'expired', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE writing_import_session_assets (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES writing_import_sessions(id) ON DELETE CASCADE,
  media_asset_id BIGINT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  original_relative_path TEXT NOT NULL,
  normalized_source_path TEXT NOT NULL,
  replacement_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'failed', 'activated', 'cleaned')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX writing_import_sessions_expires_at_idx ON writing_import_sessions (expires_at);
CREATE INDEX writing_import_sessions_admin_session_id_idx ON writing_import_sessions (admin_session_id);
CREATE INDEX writing_import_session_assets_session_id_idx ON writing_import_session_assets (session_id);
CREATE INDEX writing_import_session_assets_media_asset_id_idx ON writing_import_session_assets (media_asset_id);
```

Add dependency:

```powershell
go get github.com/minio/minio-go/v7@v7.0.86
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
go test ./internal/config -run TestLoadIncludesOptionalMediaBlobConfig -count=1
go test ./internal/db -run TestPostgresMigrationCreatesWritingImportSchema -count=1
```

Expected: PASS with config exposing hybrid media settings and migration creating the new schema.

- [ ] **Step 5: Commit the schema/config slice**

```powershell
git add internal/db/migrations/003_writing_import.sql internal/db/postgres_test.go internal/config/config.go internal/config/config_test.go go.mod go.sum
git commit -m "feat: add writing import schema and media config"
```

## Task 2: Add Hybrid Media Blob Stores And Same-Origin Public Delivery

**Files:**
- Create: `internal/media/blobstore.go`
- Create: `internal/media/blobstore_local.go`
- Create: `internal/media/blobstore_minio.go`
- Create: `internal/media/blobstore_test.go`
- Create: `internal/media/public_routes.go`
- Create: `internal/media/public_routes_test.go`
- Modify: `internal/media/media.go`
- Modify: `internal/media/routes.go`
- Modify: `internal/media/media_test.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Write the failing media delivery and filtering tests**

Add to `internal/media/public_routes_test.go`:

```go
func TestServeVariantStreamsLegacyLocalAsset(t *testing.T) {
	service := newMediaService(t)
	asset, err := service.Upload(context.Background(), "cover.png", bytes.NewReader(testPNG(t, 64, 64)))
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	router := chi.NewRouter()
	RegisterPublicRoutes(router, service)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/media/%d/content", asset.ID), nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("Content-Type = %q", got)
	}
	if recorder.Body.Len() == 0 {
		t.Fatal("expected streamed body")
	}
}

func TestServeVariantStreamsPreparedMinIOAsset(t *testing.T) {
	service := newImportReadyMediaService(t, stubBlobStore{
		keyBodies: map[string][]byte{"audio/2026/06/abc/original.mp3": []byte("mp3")},
	})
	assetID := insertPreparedAudioAsset(t, service.db)

	router := chi.NewRouter()
	RegisterPublicRoutes(router, service)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/media/%d/original", assetID), nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "audio/mpeg" {
		t.Fatalf("Content-Type = %q", got)
	}
	if recorder.Body.String() != "mp3" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

type stubBlobStore struct {
	keyBodies map[string][]byte
}

func (s stubBlobStore) Put(context.Context, string, io.Reader, string) error { return nil }
func (s stubBlobStore) Delete(context.Context, string) error                 { return nil }
func (s stubBlobStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	body, ok := s.keyBodies[key]
	if !ok {
		return nil, os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(body)), nil
}

func newImportReadyMediaService(t *testing.T, minioStore BlobStore) *Service {
	t.Helper()
	database, _ := dbtest.OpenPostgres(t)
	root := t.TempDir()
	return NewService(
		database,
		filepath.Join(root, "uploads"),
		filepath.Join(root, "private_uploads"),
		NewLocalBlobStore(filepath.Join(root, "uploads")),
		minioStore,
	)
}

func insertPreparedAudioAsset(t *testing.T, database *sql.DB) int64 {
	t.Helper()
	var id int64
	err := database.QueryRow(`
INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at, storage_backend, lifecycle_state, media_kind)
VALUES ('intro.mp3', 'audio-key-1', 'audio/mpeg', 3, NULL, NULL, '{"original":{"key":"audio/2026/06/abc/original.mp3","mime_type":"audio/mpeg","size_bytes":3}}'::jsonb, 'sum-audio-1', now(), 'minio', 'active', 'audio')
RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("insertPreparedAudioAsset: %v", err)
	}
	return id
}
```

Add to `internal/media/media_test.go`:

```go
func TestListHidesPendingImportAssets(t *testing.T) {
	service := newMediaService(t)
	insertPendingImportAsset(t, service.db, "pending-audio.mp3")

	items, err := service.List(context.Background(), 1, 20, "")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, item := range items {
		if item.FileName == "pending-audio.mp3" {
			t.Fatalf("pending import asset leaked into admin list: %+v", item)
		}
	}
}

func insertPendingImportAsset(t *testing.T, database *sql.DB, fileName string) {
	t.Helper()
	if _, err := database.Exec(`
INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at, storage_backend, lifecycle_state, media_kind)
VALUES ($1, 'pending-audio-key', 'audio/mpeg', 4, NULL, NULL, '{"original":{"key":"audio/2026/06/pending/original.mp3","mime_type":"audio/mpeg","size_bytes":4}}'::jsonb, 'sum-pending-audio', now(), 'minio', 'pending_import', 'audio')
`, fileName); err != nil {
		t.Fatalf("insertPendingImportAsset: %v", err)
	}
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
go test ./internal/media -run "TestServeVariantStreamsLegacyLocalAsset|TestServeVariantStreamsPreparedMinIOAsset|TestListHidesPendingImportAssets" -count=1
```

Expected: FAIL because no `/media/{id}/{variant}` route exists, `List` still returns all rows, and the service cannot open assets by backend.

- [ ] **Step 3: Write the minimal blob-store and public-route implementation**

Create `internal/media/blobstore.go`:

```go
package media

import (
	"context"
	"io"
)

type BlobStore interface {
	Put(ctx context.Context, key string, reader io.Reader, contentType string) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}
```

Create `internal/media/blobstore_local.go`:

```go
type LocalBlobStore struct {
	root string
}

func NewLocalBlobStore(root string) *LocalBlobStore {
	return &LocalBlobStore{root: root}
}

func (s *LocalBlobStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	return os.Open(filepath.Join(s.root, filepath.FromSlash(key)))
}
```

Create `internal/media/public_routes.go`:

```go
func RegisterPublicRoutes(r chi.Router, service *Service) {
	r.Get("/media/{id}/{variant}", func(w http.ResponseWriter, req *http.Request) {
		assetID, err := strconv.ParseInt(chi.URLParam(req, "id"), 10, 64)
		if err != nil || assetID <= 0 {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid media id", nil)
			return
		}
		stream, mimeType, err := service.OpenVariant(req.Context(), assetID, chi.URLParam(req, "variant"))
		if err != nil {
			httpserver.WriteError(w, http.StatusNotFound, "not_found", "Media not found", nil)
			return
		}
		defer stream.Close()
		w.Header().Set("Content-Type", mimeType)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		_, _ = io.Copy(w, stream)
	})
}
```

Add to `internal/media/media.go`:

```go
type Service struct {
	db                *sql.DB
	uploadsDir        string
	privateUploadsDir string
	localStore        BlobStore
	minioStore        BlobStore
	storageKeyFunc    func() (string, error)
}

func (s *Service) OpenVariant(ctx context.Context, mediaID int64, variant string) (io.ReadCloser, string, error) {
	asset, err := s.loadAsset(ctx, mediaID)
	if err != nil {
		return nil, "", err
	}
	data, ok := asset.Variants[variant]
	if !ok {
		return nil, "", ErrNotFound
	}
	if asset.StorageBackend == "minio" {
		key := data.Key
		stream, err := s.minioStore.Open(ctx, key)
		return stream, data.MimeType, err
	}
	fileName, err := legacyLocalVariantFileName(variant)
	if err != nil {
		return nil, "", err
	}
	key := path.Join(asset.StorageKey[:2], asset.StorageKey[2:4], fileName)
	stream, err := s.localStore.Open(ctx, key)
	return stream, data.MimeType, err
}
```

Tighten `List`:

```go
rows, err := s.db.QueryContext(ctx, `
SELECT id, file_name, storage_key, mime_type, width, height, variants,
       EXISTS (SELECT 1 FROM media_references WHERE media_asset_id = media_assets.id) AS referenced
FROM media_assets
WHERE file_name ILIKE $1
  AND lifecycle_state = 'active'
ORDER BY id DESC
LIMIT $2 OFFSET $3`, pattern, limit, offset)
```

Wire in `cmd/server/main.go`:

```go
localStore := media.NewLocalBlobStore(cfg.UploadsDir)
minioStore, err := media.NewMinIOBlobStore(media.MinIOConfig{
	Endpoint:  cfg.MinIOEndpoint,
	AccessKey: cfg.MinIOAccessKey,
	SecretKey: cfg.MinIOSecretKey,
	Bucket:    cfg.MinIOBucket,
	UseSSL:    cfg.MinIOUseSSL,
})
if err != nil && cfg.MediaBlobBackend == "hybrid" {
	log.Fatal(err)
}
mediaService := media.NewService(database, cfg.UploadsDir, cfg.PrivateUploadsDir, localStore, minioStore)
media.RegisterPublicRoutes(r, mediaService)
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
go test ./internal/media -run "TestServeVariantStreamsLegacyLocalAsset|TestServeVariantStreamsPreparedMinIOAsset|TestListHidesPendingImportAssets" -count=1
```

Expected: PASS with same-origin `/media/...` delivery working for local and MinIO assets and admin media lists hiding `pending_import`.

- [ ] **Step 5: Commit the media delivery slice**

```powershell
git add internal/media/blobstore.go internal/media/blobstore_local.go internal/media/blobstore_minio.go internal/media/blobstore_test.go internal/media/public_routes.go internal/media/public_routes_test.go internal/media/media.go internal/media/routes.go internal/media/media_test.go cmd/server/main.go
git commit -m "feat: add hybrid media blob delivery"
```

## Task 3: Fix The Public Markdown Media Contract

**Files:**
- Create: `internal/content/markdown_media.go`
- Create: `internal/content/markdown_media_test.go`
- Modify: `internal/content/writing.go`
- Modify: `internal/content/public.go`
- Modify: `internal/content/content_test.go`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/media.ts`
- Modify: `web/src/components/markdown/MarkdownView.tsx`
- Modify: `web/src/components/markdown/MarkdownView.test.tsx`

- [ ] **Step 1: Write the failing public enrichment and renderer tests**

Add to `internal/content/markdown_media_test.go`:

```go
func TestBuildMediaMapDeduplicatesMediaRefsAndReturnsMediaRouteURLs(t *testing.T) {
	repo := newContentRepo(t)
	mediaID := insertContentMediaAsset(t, repo)

	markdown := fmt.Sprintf("![cover](media://asset/%d/content)\n\n[podcast](media://asset/%d/content)", mediaID, mediaID)
	mediaMap, err := repo.buildMediaMap(t.Context(), markdown)
	if err != nil {
		t.Fatalf("buildMediaMap: %v", err)
	}

	content := mediaMap[strconv.FormatInt(mediaID, 10)]["content"]
	if content.URL != fmt.Sprintf("/media/%d/content", mediaID) {
		t.Fatalf("content URL = %q", content.URL)
	}
	if content.Width == nil || *content.Width == 0 {
		t.Fatalf("expected width in %+v", content)
	}
}
```

Add to `web/src/components/markdown/MarkdownView.test.tsx`:

```tsx
it("resolves image media through /media routes instead of /uploads", () => {
  const media: MediaMap = {
    "42": {
      content: {
        url: "/media/42/content",
        width: 1600,
        height: 900,
        mime_type: "image/jpeg",
      },
    },
  };
  renderWithApp(<MarkdownView markdown={"![cover](media://asset/42/content)"} media={media} />);
  expect(screen.getByRole("img", { name: "cover" })).toHaveAttribute("src", "/media/42/content");
});

it("resolves media links before safe-link validation", () => {
  const media: MediaMap = {
    "301": {
      original: {
        url: "/media/301/original",
        mime_type: "audio/mpeg",
      },
    },
  };
  renderWithApp(<MarkdownView markdown={"[podcast](media://asset/301/original)"} media={media} />);
  expect(screen.getByRole("link", { name: "podcast" })).toHaveAttribute("href", "/media/301/original");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
go test ./internal/content -run TestBuildMediaMapDeduplicatesMediaRefsAndReturnsMediaRouteURLs -count=1
npm --prefix web test -- src/components/markdown/MarkdownView.test.tsx
```

Expected: FAIL because `Writing` has no `Media` map, backend detail reads do not enrich `content_md`, and `MarkdownView` still only trusts `/uploads/...`.

- [ ] **Step 3: Write the minimal enrichment and frontend implementation**

Create `internal/content/markdown_media.go`:

```go
type MediaVariant struct {
	URL      string `json:"url"`
	Width    *int   `json:"width,omitempty"`
	Height   *int   `json:"height,omitempty"`
	MimeType string `json:"mime_type"`
}

type MediaMap map[string]map[string]MediaVariant

var mediaRefPattern = regexp.MustCompile(`media://asset/(\d+)/([a-zA-Z0-9_-]+)`)

func (r *Repository) buildMediaMap(ctx context.Context, markdown string) (MediaMap, error) {
	matches := mediaRefPattern.FindAllStringSubmatch(markdown, -1)
	if len(matches) == 0 {
		return MediaMap{}, nil
	}
	ids := make([]int64, 0, len(matches))
	seen := make(map[int64]struct{})
	for _, match := range matches {
		id, _ := strconv.ParseInt(match[1], 10, 64)
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return r.loadMediaMap(ctx, ids)
}

func (r *Repository) loadMediaMap(ctx context.Context, ids []int64) (MediaMap, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, variants
FROM media_assets
WHERE id = ANY($1)
ORDER BY id`, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := MediaMap{}
	for rows.Next() {
		var id int64
		var rawVariants []byte
		if err := rows.Scan(&id, &rawVariants); err != nil {
			return nil, err
		}
		var decoded map[string]struct {
			MimeType string `json:"mime_type"`
			Width    *int   `json:"width"`
			Height   *int   `json:"height"`
		}
		if err := json.Unmarshal(rawVariants, &decoded); err != nil {
			return nil, err
		}
		key := strconv.FormatInt(id, 10)
		result[key] = map[string]MediaVariant{}
		for variantName, variant := range decoded {
			result[key][variantName] = MediaVariant{
				URL:      fmt.Sprintf("/media/%d/%s", id, variantName),
				Width:    variant.Width,
				Height:   variant.Height,
				MimeType: variant.MimeType,
			}
		}
	}
	return result, rows.Err()
}
```

Update `internal/content/writing.go`:

```go
type Writing struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Slug        string     `json:"slug"`
	Excerpt     string     `json:"excerpt"`
	ContentMD   string     `json:"content_md"`
	Status      Status     `json:"status"`
	Featured    bool       `json:"featured"`
	SortOrder   int        `json:"sort_order"`
	PublishedAt *time.Time `json:"published_at"`
	Tags        []Term     `json:"tags"`
	Media       MediaMap   `json:"media,omitempty"`
}
```

Update `internal/content/public.go` around writing detail reads:

```go
func (r *Repository) PublicWritingByLocaleSlug(ctx context.Context, locale i18n.Locale, slug string) (Writing, LocaleMeta, []AlternateRoute, error) {
	writing, meta, alternates, err := r.publicWritingBaseByLocaleSlug(ctx, locale, slug)
	if err != nil {
		return Writing{}, LocaleMeta{}, nil, err
	}
	writing.Media, err = r.buildMediaMap(ctx, writing.ContentMD)
	if err != nil {
		return Writing{}, LocaleMeta{}, nil, err
	}
	return writing, meta, alternates, nil
}
```

Update `web/src/lib/types.ts`:

```ts
export type MediaVariant = {
  url: string;
  width?: number;
  height?: number;
  mime_type: string;
};
```

Update `web/src/components/markdown/MarkdownView.tsx`:

```tsx
function rewriteMediaImages(markdown: string, media: MediaMap) {
  const variantsByURL: Record<string, MediaVariant> = {};
  const safeMarkdown = markdown.replace(
    /!\[([^\]]*)\]\((media:\/\/asset\/(\d+)\/([a-zA-Z0-9_-]+))\)/g,
    (_match, alt: string, url: string) => {
      const variant = resolveMediaURL(url, media);
      if (!variant || !variant.url.startsWith("/media/")) {
        return `![${alt}]()`;
      }
      variantsByURL[variant.url] = variant;
      return `![${alt}](${variant.url})`;
    },
  );
  return { safeMarkdown, variantsByURL };
}

a({ href, children }) {
  const resolved = resolveMediaURL(href, media);
  const finalHref = resolved?.url ?? href;
  if (!isSafeLink(finalHref)) {
    return <a>{children}</a>;
  }
  return <a href={finalHref}>{children}</a>;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
go test ./internal/content -run TestBuildMediaMapDeduplicatesMediaRefsAndReturnsMediaRouteURLs -count=1
npm --prefix web test -- src/components/markdown/MarkdownView.test.tsx
```

Expected: PASS with public detail responses able to attach `item.media` and the frontend resolving both images and media links through `/media/...`.

- [ ] **Step 5: Commit the markdown contract slice**

```powershell
git add internal/content/markdown_media.go internal/content/markdown_media_test.go internal/content/writing.go internal/content/public.go internal/content/content_test.go web/src/lib/types.ts web/src/lib/media.ts web/src/components/markdown/MarkdownView.tsx web/src/components/markdown/MarkdownView.test.tsx
git commit -m "feat: enrich markdown pages with media maps"
```

## Task 4: Add The Writing Import Preview Service

**Files:**
- Create: `internal/content/writing_import.go`
- Create: `internal/content/writing_import_test.go`
- Modify: `internal/media/media.go`
- Modify: `internal/media/media_test.go`

- [ ] **Step 1: Write the failing preview-service tests**

Create `internal/content/writing_import_test.go`:

```go
func TestPreparePreviewParsesFrontMatterAndRewritesLocalMedia(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t)
	service := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})

	result, err := service.PreparePreview(t.Context(), PreviewRequest{
		AdminSessionID:    11,
		Mode:              ImportModeCreate,
		ParseFrontMatter:  true,
		MarkdownFileName:  "article.md",
		MarkdownContents: []byte(`---
title: Imported title
tags: AI, Notes
cover: ./images/cover.png
---
![cover](./images/cover.png)
`),
		MediaFiles: []UploadedImportFile{
			{RelativePath: "./images/cover.png", FileName: "cover.png", Contents: testPNG(t, 1280, 720)},
		},
	})
	if err != nil {
		t.Fatalf("PreparePreview: %v", err)
	}
	if result.Parsed.Title != "Imported title" {
		t.Fatalf("title = %q", result.Parsed.Title)
	}
	if !strings.Contains(result.Parsed.ContentMD, "media://asset/") {
		t.Fatalf("content_md not rewritten: %q", result.Parsed.ContentMD)
	}
	if result.Parsed.CoverMediaID == nil {
		t.Fatal("expected cover_media_id to be set")
	}
}

func TestPreparePreviewRejectsTraversalOutsideMarkdownRoot(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t)
	service := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})

	_, err := service.PreparePreview(t.Context(), PreviewRequest{
		AdminSessionID:   11,
		Mode:             ImportModeCreate,
		MarkdownFileName: "article.md",
		MarkdownContents: []byte(`![bad](../secret/cover.png)`),
	})
	if !errors.Is(err, ErrImportTraversal) {
		t.Fatalf("PreparePreview err = %v, want %v", err, ErrImportTraversal)
	}
}

func newPreparedImportMediaService(t *testing.T) *media.Service {
	t.Helper()
	return newImportReadyMediaService(t, stubBlobStore{keyBodies: map[string][]byte{}})
}
```

Add to `internal/media/media_test.go`:

```go
func TestPrepareImportAssetStoresAudioAsPendingImport(t *testing.T) {
	service := newImportReadyMediaService(t, stubBlobStore{})
	asset, err := service.PrepareImportAsset(context.Background(), PrepareImportAssetInput{
		FileName:        "intro.mp3",
		MediaKind:       "audio",
		Contents:        []byte("fake-mp3"),
		OriginalPath:    "./audio/intro.mp3",
		StorageBackend:  "minio",
	})
	if err != nil {
		t.Fatalf("PrepareImportAsset: %v", err)
	}
	if asset.LifecycleState != "pending_import" {
		t.Fatalf("LifecycleState = %q", asset.LifecycleState)
	}
	if _, ok := asset.Variants["original"]; !ok {
		t.Fatalf("variants = %+v", asset.Variants)
	}
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
go test ./internal/content -run "TestPreparePreviewParsesFrontMatterAndRewritesLocalMedia|TestPreparePreviewRejectsTraversalOutsideMarkdownRoot" -count=1
go test ./internal/media -run TestPrepareImportAssetStoresAudioAsPendingImport -count=1
```

Expected: FAIL because no import preview service exists and the media service has no non-image preparation path.

- [ ] **Step 3: Write the minimal preview-service implementation**

Create `internal/content/writing_import.go`:

```go
type PreviewRequest struct {
	AdminSessionID   int64
	Mode             ImportMode
	TargetWritingID  *int64
	ParseFrontMatter bool
	MarkdownFileName string
	MarkdownContents []byte
	MediaFiles       []UploadedImportFile
}

type UploadedImportFile struct {
	RelativePath string
	FileName     string
	Contents     []byte
}

func (s *WritingImportService) PreparePreview(ctx context.Context, req PreviewRequest) (PreviewResult, error) {
	frontMatter, body, ignored, err := parseFrontMatter(req.MarkdownContents, req.ParseFrontMatter)
	if err != nil {
		return PreviewResult{}, err
	}
	rewritten, preparedAssets, mediaMap, err := s.rewriteMarkdownMedia(ctx, body, req.MediaFiles)
	if err != nil {
		return PreviewResult{}, err
	}
	payload := buildPreviewPayload(frontMatter, rewritten, preparedAssets)
	session, err := s.persistPreviewSession(ctx, req, frontMatter, ignored, body, rewritten, payload, preparedAssets)
	if err != nil {
		return PreviewResult{}, err
	}
	return PreviewResult{
		ImportToken: session.Token,
		Parsed:      payload,
		MediaMap:    mediaMap,
		Media:       preparedAssets,
	}, nil
}
```

Add to `internal/media/media.go`:

```go
func (s *Service) PrepareImportAsset(ctx context.Context, input PrepareImportAssetInput) (Asset, error) {
	switch input.MediaKind {
	case "image":
		return s.prepareImportImage(ctx, input)
	case "audio", "video":
		return s.prepareImportBinary(ctx, input)
	default:
		return Asset{}, ErrUploadInvalid
	}
}
```

For audio/video, store one `original` variant:

```go
variants := map[string]Variant{
	"original": {
		Key:       key,
		MimeType:  mimeType,
		SizeBytes: int64(len(input.Contents)),
	},
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
go test ./internal/content -run "TestPreparePreviewParsesFrontMatterAndRewritesLocalMedia|TestPreparePreviewRejectsTraversalOutsideMarkdownRoot" -count=1
go test ./internal/media -run TestPrepareImportAssetStoresAudioAsPendingImport -count=1
```

Expected: PASS with preview parsing, local media rewrite, pending-import asset preparation, and traversal rejection working.

- [ ] **Step 5: Commit the preview-service slice**

```powershell
git add internal/content/writing_import.go internal/content/writing_import_test.go internal/media/media.go internal/media/media_test.go
git commit -m "feat: add writing import preview service"
```

## Task 5: Add Preview, Restore, Commit, And Cleanup Routes

**Files:**
- Create: `internal/content/writing_import_routes.go`
- Create: `internal/content/writing_import_routes_test.go`
- Modify: `internal/content/routes.go`
- Modify: `internal/content/content_test.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Write the failing route and cleanup tests**

Create `internal/content/writing_import_routes_test.go`:

```go
func TestPreviewRouteCreatesImportSessionAndReturnsMediaMap(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t)
	imports := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})
	router := chi.NewRouter()
	RegisterWritingImportRoutes(router, imports)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	markdownPart, _ := writer.CreateFormFile("markdown_file", "article.md")
	_, _ = markdownPart.Write([]byte("![cover](./images/cover.png)"))
	mediaPart, _ := writer.CreateFormFile("media_files[]", "cover.png")
	_, _ = mediaPart.Write(testPNG(t, 1280, 720))
	_ = writer.WriteField("media_paths[]", "./images/cover.png")
	_ = writer.WriteField("mode", "create")
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/admin/writing/imports/preview", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"media_map"`) {
		t.Fatalf("response missing media_map: %s", recorder.Body.String())
	}
}

func TestCommitRouteRejectsChangedOverwriteTarget(t *testing.T) {
	repo := newContentRepo(t)
	writing, _ := repo.CreateWriting(t.Context(), WritingInput{Title: "Draft", ContentMD: "Body"})
	mediaService := newPreparedImportMediaService(t)
	imports := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})

	session := createPreviewSession(t, repo.db, writing.ID, `"etag-1"`)
	_, _ = repo.UpdateWriting(t.Context(), writing.ID, WritingInput{Title: "Changed", ContentMD: "Changed body"})

	router := chi.NewRouter()
	RegisterWritingImportRoutes(router, imports)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/admin/writing/imports/commit", strings.NewReader(fmt.Sprintf(`{"import_token":"%s","mode":"overwrite","target_id":%d,"payload":{"title":"Edited","content_md":"Body"}}`, session.Token, writing.ID))))

	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func createPreviewSession(t *testing.T, database *sql.DB, writingID int64, etag string) struct{ Token string } {
	t.Helper()
	token := "preview-token-1"
	if _, err := database.Exec(`
INSERT INTO writing_import_sessions (token_hash, admin_session_id, mode, target_writing_id, target_writing_etag, source_file_name, source_checksum_sha256, original_markdown, rewritten_markdown, parsed_payload, status, expires_at, created_at, updated_at)
VALUES ($1, 11, 'overwrite', $2, $3, 'article.md', 'checksum-1', 'Body', 'Body', '{}'::jsonb, 'preview_ready', now() + interval '2 hours', now(), now())
`, hashToken(token), writingID, etag); err != nil {
		t.Fatalf("createPreviewSession: %v", err)
	}
	return struct{ Token string }{Token: token}
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
go test ./internal/content -run "TestPreviewRouteCreatesImportSessionAndReturnsMediaMap|TestCommitRouteRejectsChangedOverwriteTarget" -count=1
```

Expected: FAIL because the import endpoints are not registered and no cleanup/commit orchestration exists yet.

- [ ] **Step 3: Write the minimal route and cleanup implementation**

Create `internal/content/writing_import_routes.go`:

```go
func RegisterWritingImportRoutes(r chi.Router, service *WritingImportService) {
	r.Post("/api/admin/writing/imports/preview", service.previewHandler())
	r.Get("/api/admin/writing/imports/preview/{token}", service.restoreHandler())
	r.Post("/api/admin/writing/imports/commit", service.commitHandler())
}
```

Register routes in `internal/content/routes.go`:

```go
func RegisterAdminRoutes(r chi.Router, repo *Repository, importService *WritingImportService, generators ...ContentTranslationGenerator) {
	r.Get("/api/admin/projects", listHandler(repo.ListProjects))
	r.Post("/api/admin/projects", createHandler(repo.CreateProject))
	r.Get("/api/admin/projects/{id}", getHandler(repo.GetProjectAdmin))
	r.Put("/api/admin/projects/{id}", updateProjectHandler(repo))
	r.Get("/api/admin/writing", listHandler(repo.ListWriting))
	r.Post("/api/admin/writing", createHandler(repo.CreateWriting))
	r.Get("/api/admin/writing/{id}", getHandler(repo.GetWritingAdmin))
	r.Put("/api/admin/writing/{id}", updateWritingHandler(repo))
	r.Put("/api/admin/writing/{id}/translations/{locale}", saveWritingTranslationHandler(repo))
	if importService != nil {
		RegisterWritingImportRoutes(r, importService)
	}
	r.Post("/api/admin/writing/{id}/translations/{locale}/review", reviewWritingTranslationHandler(repo))
	r.Get("/api/admin/talks", listHandler(repo.ListTalks))
}
```

And update `cmd/server/main.go`:

```go
importService := content.NewWritingImportService(contentRepo, mediaService, func() time.Time { return time.Now().UTC() })
content.RegisterAdminRoutes(adminRoutes, contentRepo, importService, translationService)
```

Implement commit orchestration in `internal/content/writing_import.go`:

```go
func (s *WritingImportService) Commit(ctx context.Context, req CommitRequest) (WritingImportCommitResult, error) {
	session, err := s.loadActiveSession(ctx, req.ImportToken)
	if err != nil {
		return WritingImportCommitResult{}, err
	}
	if session.Mode == ImportModeOverwrite {
		if err := s.ensureOverwriteTargetUnchanged(ctx, session); err != nil {
			return WritingImportCommitResult{}, err
		}
	}
	writing, err := s.saveWriting(ctx, session, req.Payload)
	if err != nil {
		return WritingImportCommitResult{}, err
	}
	if err := s.activatePreparedAssets(ctx, session.ID); err != nil {
		return WritingImportCommitResult{}, err
	}
	if err := s.markSessionCommitted(ctx, session.ID); err != nil {
		return WritingImportCommitResult{}, err
	}
	writing.Media, err = s.repo.buildMediaMap(ctx, writing.ContentMD)
	if err != nil {
		return WritingImportCommitResult{}, err
	}
	return WritingImportCommitResult{Writing: writing}, nil
}
```

Wire startup cleanup and periodic sweeper in `cmd/server/main.go`:

```go
if err := importService.CleanupExpiredSessions(context.Background()); err != nil {
	log.Printf("import cleanup failed: %v", err)
}
go func() {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		if err := importService.CleanupExpiredSessions(context.Background()); err != nil {
			log.Printf("import cleanup failed: %v", err)
		}
	}
}()
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
go test ./internal/content -run "TestPreviewRouteCreatesImportSessionAndReturnsMediaMap|TestCommitRouteRejectsChangedOverwriteTarget" -count=1
```

Expected: PASS with multipart preview, restore-ready session persistence, overwrite conflict protection, and scheduled cleanup wired.

- [ ] **Step 5: Commit the route slice**

```powershell
git add internal/content/writing_import_routes.go internal/content/writing_import_routes_test.go internal/content/routes.go internal/content/content_test.go cmd/server/main.go
git commit -m "feat: add writing import admin routes"
```

## Task 6: Add The Admin Writing Import Workflow

**Files:**
- Create: `web/src/features/admin/writingImport.ts`
- Create: `web/src/features/admin/WritingImportDialog.tsx`
- Create: `web/src/features/admin/WritingImportDialog.test.tsx`
- Modify: `web/src/features/admin/ContentListPage.tsx`
- Modify: `web/src/features/admin/ContentEditPage.tsx`
- Modify: `web/src/features/admin/Admin.module.css`
- Modify: `web/src/features/admin/AdminUI.test.tsx`

- [ ] **Step 1: Write the failing admin workflow tests**

Create `web/src/features/admin/WritingImportDialog.test.tsx`:

```tsx
it("uploads markdown and shows parsed preview before commit", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          import_token: "token-1",
          mode: "create",
          parsed: {
            title: "Imported title",
            excerpt: "Imported excerpt",
            slug: "imported-title",
            content_md: "![cover](media://asset/201/content)",
          },
          media_map: {
            "201": {
              content: {
                url: "/media/201/content",
                width: 1600,
                height: 900,
                mime_type: "image/jpeg",
              },
            },
          },
          media: [{ original_path: "./images/cover.png", replacement_ref: "media://asset/201/content", status: "prepared" }],
          warnings: [],
          blocking_errors: [],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  renderWithApp(<WritingImportDialog open onClose={() => {}} mode="create" />);

  await userEvent.upload(screen.getByLabelText(/markdown 文件/i), new File(["# title"], "article.md", { type: "text/markdown" }));
  await userEvent.click(screen.getByRole("button", { name: /生成预览/i }));

  expect(await screen.findByDisplayValue("Imported title")).toBeInTheDocument();
  expect(screen.getByText("media://asset/201/content")).toBeInTheDocument();
});
```

Add to `web/src/features/admin/AdminUI.test.tsx`:

```tsx
it("shows an import markdown action on the writing list page", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" }, status: 200 })));
  renderWithApp(<ContentListPage resource="writing" />);
  expect(await screen.findByRole("button", { name: /导入 Markdown/i })).toBeInTheDocument();
});

it("shows overwrite import only on draft writing edit pages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 9,
    title: "Draft writing",
    slug: "draft-writing",
    excerpt: "",
    content_md: "Body",
    status: "draft",
    translations: { en: { exists: false, etag: null, translation_status: "empty" }, ja: { exists: false, etag: null, translation_status: "empty" } }
  }), { headers: { "Content-Type": "application/json" }, status: 200 })));

  const router = createMemoryRouter([{ path: "/admin/writing/:id", element: <ContentEditPage resource="writing" /> }], { initialEntries: ["/admin/writing/9"] });
  renderWithApp(<RouterProvider router={router} />);
  expect(await screen.findByRole("button", { name: /导入本地 Markdown/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm --prefix web test -- src/features/admin/WritingImportDialog.test.tsx src/features/admin/AdminUI.test.tsx
```

Expected: FAIL because no dialog component or writing import entry points exist yet.

- [ ] **Step 3: Write the minimal admin workflow implementation**

Create `web/src/features/admin/writingImport.ts`:

```ts
export type WritingImportPreview = {
  import_token: string;
  mode: "create" | "overwrite";
  parsed: {
    title: string;
    excerpt: string;
    slug: string;
    cover_media_id?: number;
    seo_title?: string;
    seo_description?: string;
    content_md: string;
    tags?: string[];
  };
  media_map: MediaMap;
  media: Array<{
    original_path: string;
    replacement_ref: string;
    status: "prepared" | "failed";
  }>;
  warnings: string[];
  blocking_errors: string[];
};
```

Create `web/src/features/admin/WritingImportDialog.tsx`:

```tsx
export function WritingImportDialog({ mode, open, onClose, targetId }: WritingImportDialogProps) {
  const [step, setStep] = useState<"choose" | "preview">("choose");
  const [preview, setPreview] = useState<WritingImportPreview | null>(null);

  async function requestPreview(form: FormData) {
    const response = await apiFetch<WritingImportPreview>("/api/admin/writing/imports/preview", {
      body: form,
      method: "POST",
    });
    setPreview(response);
    setStep("preview");
  }

  return open ? (
    <div className={styles.modal}>
      {step === "choose" ? <ChooseImportFiles onSubmit={requestPreview} /> : <ImportPreviewPanel preview={preview} />}
    </div>
  ) : null;
}
```

Modify `web/src/features/admin/ContentListPage.tsx`:

```tsx
const [showImport, setShowImport] = useState(false);
{typedResource === "writing" ? (
  <button className={styles.button} onClick={() => setShowImport(true)} type="button">
    导入 Markdown
  </button>
) : null}
<WritingImportDialog mode="create" open={showImport} onClose={() => setShowImport(false)} />
```

Modify `web/src/features/admin/ContentEditPage.tsx`:

```tsx
const [showImport, setShowImport] = useState(false);
const canOverwriteFromImport = typedResource === "writing" && isEditing;

{canOverwriteFromImport ? (
  <button className={styles.button} onClick={() => setShowImport(true)} type="button">
    导入本地 Markdown
  </button>
) : null}
<WritingImportDialog mode="overwrite" open={showImport} onClose={() => setShowImport(false)} targetId={id ? Number(id) : undefined} />
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
npm --prefix web test -- src/features/admin/WritingImportDialog.test.tsx src/features/admin/AdminUI.test.tsx
```

Expected: PASS with writing-only import entry points, preview-first UI, and draft overwrite affordance.

- [ ] **Step 5: Commit the admin workflow slice**

```powershell
git add web/src/features/admin/writingImport.ts web/src/features/admin/WritingImportDialog.tsx web/src/features/admin/WritingImportDialog.test.tsx web/src/features/admin/ContentListPage.tsx web/src/features/admin/ContentEditPage.tsx web/src/features/admin/Admin.module.css web/src/features/admin/AdminUI.test.tsx
git commit -m "feat: add writing import admin workflow"
```

## Task 7: Support Non-Image Assets In The Admin Media Library

**Files:**
- Modify: `web/src/features/admin/MediaPage.tsx`
- Modify: `web/src/features/admin/AdminUI.test.tsx`
- Modify: `web/src/features/admin/Admin.module.css`
- Modify: `web/src/lib/types.ts`

- [ ] **Step 1: Write the failing media-library tests**

Add to `web/src/features/admin/AdminUI.test.tsx`:

```tsx
it("renders audio and video assets with placeholders and original media refs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 21,
              file_name: "podcast.mp3",
              mime_type: "audio/mpeg",
              referenced: false,
              variants: {
                original: {
                  url: "/media/21/original",
                  mime_type: "audio/mpeg",
                },
              },
            },
            {
              id: 22,
              file_name: "demo.mp4",
              mime_type: "video/mp4",
              referenced: false,
              variants: {
                original: {
                  url: "/media/22/original",
                  mime_type: "video/mp4",
                },
              },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    ),
  );

  renderWithApp(<MediaPage />);

  expect(await screen.findByText("podcast.mp3")).toBeInTheDocument();
  expect(screen.getByText("AUDIO")).toBeInTheDocument();
  expect(screen.getByText("VIDEO")).toBeInTheDocument();
  expect(screen.getByText("[podcast.mp3](media://asset/21/original)")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm --prefix web test -- src/features/admin/AdminUI.test.tsx
```

Expected: FAIL because `MediaPage` assumes `variants.card` thumbnails and always emits image markdown syntax.

- [ ] **Step 3: Write the minimal media-page implementation**

Update `web/src/features/admin/MediaPage.tsx`:

```tsx
function mediaReference(item: MediaItem) {
  if (item.mime_type.startsWith("image/")) {
    return `![${item.file_name}](media://asset/${item.id}/card)`;
  }
  return `[${item.file_name}](media://asset/${item.id}/original)`;
}

function mediaKind(item: MediaItem) {
  if (item.mime_type.startsWith("audio/")) {
    return "audio";
  }
  if (item.mime_type.startsWith("video/")) {
    return "video";
  }
  return "image";
}
```

Render placeholder tiles:

```tsx
const kind = mediaKind(item);
const card = item.variants.card;
{kind === "image" && card ? (
  <img alt="" className={styles.thumb} src={card.url} width={card.width} height={card.height} />
) : (
  <div className={`${styles.thumb} ${styles.mediaPlaceholder}`}>
    <strong>{kind === "audio" ? "AUDIO" : "VIDEO"}</strong>
    <span>{item.mime_type}</span>
  </div>
)}
<code>{mediaReference(item)}</code>
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
npm --prefix web test -- src/features/admin/AdminUI.test.tsx
```

Expected: PASS with non-image media cards showing placeholders and correct `[label](media://asset/{id}/original)` copy helpers.

- [ ] **Step 5: Commit the media-library slice**

```powershell
git add web/src/features/admin/MediaPage.tsx web/src/features/admin/AdminUI.test.tsx web/src/features/admin/Admin.module.css web/src/lib/types.ts
git commit -m "feat: support non-image media cards"
```

## Task 8: Final Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `cmd/server/main.go`
- Modify: `internal/content/writing_import.go`
- Modify: `internal/media/blobstore_minio.go`

- [ ] **Step 1: Write the last failing documentation/config verification tests**

Add to `internal/content/writing_import_routes_test.go`:

```go
func TestRestorePreviewReturnsGoneAfterExpiry(t *testing.T) {
	repo := newContentRepo(t)
	mediaService := newPreparedImportMediaService(t)
	imports := NewWritingImportService(repo, mediaService, func() time.Time {
		return time.Date(2026, 6, 29, 8, 0, 0, 0, time.UTC)
	})
	session := createExpiredPreviewSession(t, repo.db)

	router := chi.NewRouter()
	RegisterWritingImportRoutes(router, imports)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/admin/writing/imports/preview/"+session.Token, nil))

	if recorder.Code != http.StatusGone {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func createExpiredPreviewSession(t *testing.T, database *sql.DB) struct{ Token string } {
	t.Helper()
	token := "expired-preview-token"
	if _, err := database.Exec(`
INSERT INTO writing_import_sessions (token_hash, admin_session_id, mode, source_file_name, source_checksum_sha256, original_markdown, rewritten_markdown, parsed_payload, status, expires_at, created_at, updated_at)
VALUES ($1, 11, 'create', 'expired.md', 'checksum-expired', 'Body', 'Body', '{}'::jsonb, 'preview_ready', now() - interval '1 minute', now(), now())
`, hashToken(token)); err != nil {
		t.Fatalf("createExpiredPreviewSession: %v", err)
	}
	return struct{ Token string }{Token: token}
}
```

- [ ] **Step 2: Run the verification tests and full focused suite**

Run:

```powershell
go test ./internal/config ./internal/db ./internal/media ./internal/content -count=1
npm --prefix web test -- src/components/markdown/MarkdownView.test.tsx src/features/admin/WritingImportDialog.test.tsx src/features/admin/AdminUI.test.tsx
```

Expected: At least one failure remains until the cleanup and docs polish are complete.

- [ ] **Step 3: Finish cleanup behavior and documentation**

Update `README.md` with a new section:

```md
## Writing Markdown Import

Set the following environment variables when `MEDIA_BLOB_BACKEND=hybrid`:

- `MINIO_ENDPOINT`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`
- `MINIO_USE_SSL`

Run the focused verification commands:

```bash
go test ./internal/config ./internal/db ./internal/media ./internal/content -count=1
npm --prefix web test -- src/components/markdown/MarkdownView.test.tsx src/features/admin/WritingImportDialog.test.tsx src/features/admin/AdminUI.test.tsx
```
```

Ensure `cmd/server/main.go` fails fast in hybrid mode when MinIO config is missing:

```go
if cfg.MediaBlobBackend == "hybrid" && (cfg.MinIOEndpoint == "" || cfg.MinIOAccessKey == "" || cfg.MinIOSecretKey == "" || cfg.MinIOBucket == "") {
	log.Fatal("hybrid media backend requires MinIO configuration")
}
```

- [ ] **Step 4: Run the complete verification suite and keep it green**

Run:

```powershell
go test ./internal/config ./internal/db ./internal/media ./internal/content -count=1
npm --prefix web test -- src/components/markdown/MarkdownView.test.tsx src/features/admin/WritingImportDialog.test.tsx src/features/admin/AdminUI.test.tsx
```

Expected: PASS with no pending red tests in the focused backend and frontend suites for this feature.

- [ ] **Step 5: Commit the documentation and final verification slice**

```powershell
git add README.md cmd/server/main.go internal/content/writing_import.go internal/media/blobstore_minio.go internal/content/writing_import_routes_test.go
git commit -m "docs: document writing import runtime config"
```

## Spec Coverage Check

- Preview-first admin workflow: covered by Tasks 4, 5, and 6.
- Create new writing and overwrite draft modes: covered by Tasks 4, 5, and 6.
- Front matter parsing, cover mapping, and local media rewrite: covered by Task 4.
- MinIO-backed imported media with same-origin `/media/...` delivery: covered by Tasks 2 and 4.
- Public `item.media` enrichment and frontend `media://` rendering contract: covered by Task 3.
- Media library support for audio/video placeholders and correct markdown copy helpers: covered by Task 7.
- Cleanup of expired preview sessions and pending assets: covered by Task 5 and Task 8.
- Runtime config and verification commands: covered by Tasks 1 and 8.

## Placeholder Scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- Every task lists exact files, explicit test names, concrete commands, and a concrete commit message.
- The public media contract consistently uses `/media/{assetID}/{variant}` and never falls back to direct MinIO URLs.

## Type Consistency Check

- Backend `Writing.Media` and frontend `detail.item.media` stay aligned.
- Frontend `MediaVariant.width` and `height` become optional everywhere the plan references audio/video support.
- Import preview types use `media_map` in preview/restore responses and `media` on returned writing detail objects, matching the approved spec.

Plan complete and saved to `docs/superpowers/plans/2026-06-29-writing-markdown-import-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
