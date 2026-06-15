# Portfolio Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React + Go personal portfolio application described in `docs/superpowers/specs/2026-06-15-portfolio-site-design.md`.

**Architecture:** A single Go server owns API routes, auth, SQLite, media processing, SEO meta injection, uploads, sitemap, robots, and static asset serving. A Vite React app owns public pages, admin pages, Markdown rendering, media picker interactions, and client-side routing. Implementation proceeds backend-first for contracts and security, then frontend consumes those contracts.

**Tech Stack:** Go `net/http`, `chi`, `database/sql`, SQLite, SQL migrations, bcrypt, Vite, React, React Router, TypeScript, CSS Modules, `react-markdown`, `remark-gfm`, `rehype-sanitize`, `lucide-react`, `github.com/disintegration/imaging`, `golang.org/x/image/webp`.

---

## Scope And Execution Strategy

This is a multi-subsystem product. Execute in phases and commit after every task. Do not build UI before the backend contracts it depends on exist. Do not defer security, upload validation, Markdown sanitization, SEO escaping, or database constraints to the end.

Execution order:

1. Scaffold repository and baseline tooling.
2. Add backend config, database, migrations, and schema tests.
3. Add auth, sessions, CSRF, and route priority.
4. Add profile, social links, and admin bootstrap.
5. Add publishable content APIs and public home/list/detail APIs.
6. Add media upload, derivatives, references, and deletion blocking.
7. Add frontend foundation, Markdown renderer, and API client.
8. Add admin UI.
9. Add public UI, SEO shell injection, sitemap, robots, caching, and E2E flow.

## File Structure

Create this structure:

```text
cmd/server/main.go
internal/config/config.go
internal/config/config_test.go
internal/db/db.go
internal/db/migrate.go
internal/db/migrate_test.go
internal/db/migrations/001_initial.sql
internal/httpserver/server.go
internal/httpserver/routes.go
internal/httpserver/responses.go
internal/httpserver/security_headers.go
internal/auth/auth.go
internal/auth/session.go
internal/auth/csrf.go
internal/auth/rate_limit.go
internal/auth/auth_test.go
internal/site/home.go
internal/site/home_test.go
internal/site/seo.go
internal/site/seo_test.go
internal/profile/profile.go
internal/profile/profile_test.go
internal/content/slug.go
internal/content/slug_test.go
internal/content/status.go
internal/content/reorder.go
internal/content/projects.go
internal/content/writing.go
internal/content/talks.go
internal/content/experience.go
internal/content/content_test.go
internal/media/media.go
internal/media/variants.go
internal/media/references.go
internal/media/media_test.go
internal/backup/backup.go
internal/backup/backup_test.go
web/package.json
web/index.html
web/vite.config.ts
web/tsconfig.json
web/src/main.tsx
web/src/app/App.tsx
web/src/app/routes.tsx
web/src/styles/tokens.css
web/src/styles/global.css
web/src/lib/api.ts
web/src/lib/types.ts
web/src/lib/media.ts
web/src/components/markdown/MarkdownView.tsx
web/src/components/markdown/MarkdownView.test.tsx
web/src/features/auth/LoginPage.tsx
web/src/features/admin/AdminLayout.tsx
web/src/features/admin/ProfilePage.tsx
web/src/features/admin/ContentListPage.tsx
web/src/features/admin/ContentEditPage.tsx
web/src/features/admin/MediaPage.tsx
web/src/features/public/HomePage.tsx
web/src/features/public/ProjectDetailPage.tsx
web/src/features/public/WritingDetailPage.tsx
web/src/features/public/TalkDetailPage.tsx
web/src/features/public/PublicListPage.tsx
web/src/test/setup.ts
web/src/test/render.tsx
```

Responsibilities:

- `internal/config`: parse env, default values, production checks.
- `internal/db`: SQLite connection, PRAGMAs, migrations, transaction helper.
- `internal/httpserver`: route registration order, common JSON responses, static serving, security headers.
- `internal/auth`: admin bootstrap, bcrypt, session token hashing, CSRF, login throttling.
- `internal/profile`: singleton profile and nested social links with ETag handling.
- `internal/content`: shared slug/status/reorder behavior plus module repositories and handlers.
- `internal/media`: private raw upload handling, image validation, derivatives, media references, picker API.
- `internal/site`: public home/list/detail payloads, sitemap, robots, SEO meta injection.
- `web/src/lib`: typed API client and shared DTOs.
- `web/src/components/markdown`: only Markdown renderer used by public pages and admin preview.
- `web/src/features/admin`: authenticated management views.
- `web/src/features/public`: public portfolio views.

---

### Task 1: Scaffold Tooling And Repository Skeleton

**Files:**
- Create: `go.mod`
- Create: `cmd/server/main.go`
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/app/App.tsx`
- Create: `web/src/styles/tokens.css`
- Create: `web/src/styles/global.css`

- [ ] **Step 1: Initialize Go module**

Run:

```powershell
go mod init portfolio
go get github.com/go-chi/chi/v5
go get github.com/mattn/go-sqlite3
go get golang.org/x/crypto/bcrypt
go get golang.org/x/image/webp
go get github.com/disintegration/imaging
```

Expected: `go.mod` and `go.sum` exist.

- [ ] **Step 2: Add config test first**

Create `internal/config/config_test.go` with tests for required env parsing:

```go
package config

import "testing"

func TestLoadRequiresCoreEnv(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "1234567890abcdef")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_PATH", "data/portfolio.db")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.PublicBaseURL != "http://localhost:8080" {
		t.Fatalf("PublicBaseURL = %q", cfg.PublicBaseURL)
	}
}

func TestLoadRejectsShortAdminPassword(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "short")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_PATH", "data/portfolio.db")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for short ADMIN_PASSWORD")
	}
}
```

- [ ] **Step 3: Run config tests to verify failure**

Run:

```powershell
go test ./internal/config
```

Expected: FAIL because `Load` does not exist.

- [ ] **Step 4: Implement `internal/config/config.go`**

Implement `Config` and `Load` with exact fields from the spec:

```go
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppOrigin                 string
	PublicBaseURL             string
	SiteName                  string
	AdminEmail                string
	AdminPassword             string
	SessionSecret             string
	DatabasePath              string
	UploadsDir                string
	PrivateUploadsDir         string
	SessionTTL                time.Duration
	SessionIdleTimeout        time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		AppOrigin:         os.Getenv("APP_ORIGIN"),
		PublicBaseURL:     os.Getenv("PUBLIC_BASE_URL"),
		SiteName:          os.Getenv("SITE_NAME"),
		AdminEmail:        os.Getenv("ADMIN_EMAIL"),
		AdminPassword:     os.Getenv("ADMIN_PASSWORD"),
		SessionSecret:     os.Getenv("SESSION_SECRET"),
		DatabasePath:      os.Getenv("DATABASE_PATH"),
		UploadsDir:        os.Getenv("UPLOADS_DIR"),
		PrivateUploadsDir: os.Getenv("PRIVATE_UPLOADS_DIR"),
		SessionTTL:         durationFromHours("SESSION_TTL_HOURS", 12),
		SessionIdleTimeout: durationFromMinutes("SESSION_IDLE_TIMEOUT_MINUTES", 120),
	}
	if cfg.AppOrigin == "" || cfg.PublicBaseURL == "" || cfg.SiteName == "" ||
		cfg.AdminEmail == "" || cfg.AdminPassword == "" || cfg.SessionSecret == "" ||
		cfg.DatabasePath == "" || cfg.UploadsDir == "" || cfg.PrivateUploadsDir == "" {
		return Config{}, errors.New("missing required runtime configuration")
	}
	if len(cfg.AdminPassword) < 16 {
		return Config{}, errors.New("ADMIN_PASSWORD must be at least 16 characters")
	}
	if len(cfg.SessionSecret) < 32 {
		return Config{}, errors.New("SESSION_SECRET must be at least 32 characters")
	}
	return cfg, nil
}

func durationFromHours(name string, fallback int) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return time.Duration(fallback) * time.Hour
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * time.Hour
	}
	return time.Duration(n) * time.Hour
}

func durationFromMinutes(name string, fallback int) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return time.Duration(fallback) * time.Minute
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * time.Minute
	}
	return time.Duration(n) * time.Minute
}

func (c Config) String() string {
	return fmt.Sprintf("site=%s db=%s", c.SiteName, c.DatabasePath)
}
```

- [ ] **Step 5: Run config tests**

Run:

```powershell
go test ./internal/config
```

Expected: PASS.

- [ ] **Step 6: Initialize frontend package**

From `web/`, run:

```powershell
npm create vite@latest . -- --template react-ts
npm install react-router-dom lucide-react react-markdown remark-gfm rehype-sanitize
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Expected: Vite React project files exist under `web/`.

- [ ] **Step 7: Add global CSS tokens**

Create `web/src/styles/tokens.css` with the spec color and spacing variables:

```css
:root {
  --color-bg: #ffffff;
  --color-text: #111827;
  --color-text-secondary: #4b5563;
  --color-text-muted: #6b7280;
  --color-border: #e5e7eb;
  --color-surface-subtle: #f9fafb;
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #dc2626;
  --radius-card: 8px;
  --radius-button: 6px;
  --content-width: 1160px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}
```

- [ ] **Step 8: Run baseline checks**

Run:

```powershell
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup
cd web
npm test -- --run
npm run build
```

Expected: Go tests pass; frontend tests may report no test files; Vite build passes.

- [ ] **Step 9: Commit scaffold**

Run:

```powershell
git add go.mod go.sum cmd internal web
git commit -m "chore: scaffold portfolio app"
```

---

### Task 2: Database Schema, Migrations, PRAGMAs, And Backup

**Files:**
- Create: `internal/db/db.go`
- Create: `internal/db/migrate.go`
- Create: `internal/db/migrate_test.go`
- Create: `internal/db/migrations/001_initial.sql`
- Create: `internal/backup/backup.go`
- Create: `internal/backup/backup_test.go`

- [ ] **Step 1: Write migration tests**

Create tests that verify:

- `profile` singleton row with `id = 1`.
- required indexes exist.
- `PRAGMA foreign_keys` is enabled.
- `sessions.session_token_hash` is unique.
- `media_assets.storage_key` is unique.

Use this assertion helper in `internal/db/migrate_test.go`:

```go
func requireIndex(t *testing.T, db *sql.DB, table string, name string) {
	t.Helper()
	rows, err := db.Query(`PRAGMA index_list(` + table + `)`)
	if err != nil {
		t.Fatalf("index_list(%s): %v", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var seq int
		var idxName string
		var unique int
		var origin string
		var partial int
		if err := rows.Scan(&seq, &idxName, &unique, &origin, &partial); err != nil {
			t.Fatalf("scan index: %v", err)
		}
		if idxName == name {
			return
		}
	}
	t.Fatalf("missing index %s on %s", name, table)
}
```

- [ ] **Step 2: Run migration tests to verify failure**

Run:

```powershell
go test ./internal/db
```

Expected: FAIL because migration code and SQL do not exist.

- [ ] **Step 3: Write `001_initial.sql`**

Create all tables from the spec. Include:

- `CHECK (id = 1)` on `profile`.
- `UNIQUE` constraints for slugs, session hash, storage key.
- FK `ON DELETE` rules exactly from the spec.
- indexes listed under "Database Indexes".
- `schema_migrations` table.

- [ ] **Step 4: Implement database open and migration runner**

`Open(path string)` must:

- open SQLite,
- enable WAL,
- enable foreign keys,
- set busy timeout,
- run migrations inside transaction,
- fail if any migration fails.

- [ ] **Step 5: Run migration tests**

Run:

```powershell
go test ./internal/db
```

Expected: PASS.

- [ ] **Step 6: Write backup tests**

Test that backup:

- snapshots SQLite with `VACUUM INTO` or online backup API,
- blocks writes through an application mutex,
- excludes `PRIVATE_UPLOADS_DIR`.

- [ ] **Step 7: Implement backup command helper**

Create `internal/backup/backup.go` with a function:

```go
func Run(ctx context.Context, db *sql.DB, uploadsDir string, destinationDir string) error
```

The function must create a database snapshot and copy `uploadsDir`. It must not copy private upload temp files.

- [ ] **Step 8: Run database and backup tests**

Run:

```powershell
go test ./internal/db ./internal/backup
```

Expected: PASS.

- [ ] **Step 9: Commit database foundation**

Run:

```powershell
git add internal/db internal/backup
git commit -m "feat: add sqlite schema and backup foundation"
```

---

### Task 3: HTTP Server, Route Priority, Security Headers, Auth, Sessions, CSRF

**Files:**
- Create: `internal/httpserver/server.go`
- Create: `internal/httpserver/routes.go`
- Create: `internal/httpserver/responses.go`
- Create: `internal/httpserver/security_headers.go`
- Create: `internal/auth/auth.go`
- Create: `internal/auth/session.go`
- Create: `internal/auth/csrf.go`
- Create: `internal/auth/rate_limit.go`
- Create: `internal/auth/auth_test.go`

- [ ] **Step 1: Write auth and routing tests**

Tests must cover:

- login requires Origin or strict Referer but does not require session or CSRF,
- logout requires session and CSRF,
- other unsafe `/api/admin/*` methods require session and CSRF,
- session token stored only as `session_token_hash`,
- `/api/*`, `/uploads/*`, `/sitemap.xml`, `/robots.txt`, `/admin/preview/*` are handled before SPA fallback,
- production CSP contains `img-src 'self';` and no `data:`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
go test ./internal/auth ./internal/httpserver
```

Expected: FAIL because packages are not implemented.

- [ ] **Step 3: Implement response helpers**

`internal/httpserver/responses.go` must define:

```go
type APIError struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func WriteJSON(w http.ResponseWriter, status int, value any)
func WriteError(w http.ResponseWriter, status int, code string, message string, fields map[string]string)
```

- [ ] **Step 4: Implement auth service**

Implement:

- bcrypt password verification,
- admin bootstrap only when `admins` table is empty,
- `ADMIN_PASSWORD` length already checked by config,
- warning log if production starts with `ADMIN_PASSWORD` set after admin exists.

- [ ] **Step 5: Implement session service**

Session rules:

- cookie name `portfolio_session`,
- cookie contains raw random token,
- database stores SHA-256 hash,
- absolute expiration 12h default,
- idle timeout 2h default,
- rotate after login and renewal,
- logout revokes server row and clears cookie.

- [ ] **Step 6: Implement CSRF service**

Rules:

- `GET`, `HEAD`, `OPTIONS` do not require CSRF,
- `POST /api/admin/login` requires Origin or Referer and rate limit only,
- `POST /api/admin/logout` requires session and CSRF,
- all other unsafe admin methods require session and CSRF,
- token returned by `GET /api/admin/me` and `GET /api/admin/csrf`.

- [ ] **Step 7: Implement route priority**

In `internal/httpserver/routes.go`, register in this order:

```go
r.Route("/api", apiRoutes)
r.Handle("/uploads/*", uploadHandler)
r.Get("/sitemap.xml", sitemapHandler)
r.Get("/robots.txt", robotsHandler)
r.Get("/admin/preview/*", adminPreviewShellHandler)
r.Handle("/*", reactFallbackHandler)
```

- [ ] **Step 8: Run auth and server tests**

Run:

```powershell
go test ./internal/auth ./internal/httpserver
```

Expected: PASS.

- [ ] **Step 9: Commit auth/server foundation**

Run:

```powershell
git add internal/auth internal/httpserver
git commit -m "feat: add auth sessions csrf and route priority"
```

---

### Task 4: Profile And Social Links

**Files:**
- Create: `internal/profile/profile.go`
- Create: `internal/profile/profile_test.go`

- [ ] **Step 1: Write profile tests**

Tests must cover:

- `GET /api/admin/profile` returns profile plus nested `social_links`,
- response includes `ETag`,
- `PUT /api/admin/profile` requires `If-Match`,
- stale `If-Match` returns `409 conflict`,
- social link insert/update/delete bumps `profile.updated_at`,
- `GET /api/site/profile` returns public profile plus links.

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
go test ./internal/profile
```

Expected: FAIL because package does not exist.

- [ ] **Step 3: Implement profile repository**

Repository methods:

```go
func GetAdmin(ctx context.Context) (ProfileAdminDTO, string, error)
func SaveAdmin(ctx context.Context, input ProfileInput, ifMatch string) error
func GetPublic(ctx context.Context) (ProfilePublicDTO, error)
```

Use one transaction for profile and social links.

- [ ] **Step 4: Implement profile handlers**

Routes:

```text
GET /api/admin/profile
PUT /api/admin/profile
GET /api/site/profile
```

- [ ] **Step 5: Run profile tests**

Run:

```powershell
go test ./internal/profile
```

Expected: PASS.

- [ ] **Step 6: Commit profile feature**

Run:

```powershell
git add internal/profile
git commit -m "feat: add profile and social links api"
```

---

### Task 5: Content APIs, Slugify, Status, Reorder, Tags, Techs

**Files:**
- Create: `internal/content/slug.go`
- Create: `internal/content/slug_test.go`
- Create: `internal/content/status.go`
- Create: `internal/content/reorder.go`
- Create: `internal/content/projects.go`
- Create: `internal/content/writing.go`
- Create: `internal/content/talks.go`
- Create: `internal/content/experience.go`
- Create: `internal/content/content_test.go`
- Create: `internal/site/home.go`
- Create: `internal/site/home_test.go`

- [ ] **Step 1: Write slug tests**

Cases:

```go
map[string]string{
	"Hello, World!": "hello-world",
	"Developer's Notes": "developers-notes",
	"  AI   Workflow  ": "ai-workflow",
}
```

Also test:

- reserved words rejected,
- empty normalized slug rejected,
- max length 80,
- duplicate draft receives suffix,
- published slug immutable.

- [ ] **Step 2: Run slug tests to verify failure**

Run:

```powershell
go test ./internal/content -run TestSlug
```

Expected: FAIL.

- [ ] **Step 3: Implement slugify**

`Slugify(input string) (string, error)` must implement the spec exactly.

- [ ] **Step 4: Write content repository tests**

Tests must cover:

- create defaults to draft,
- publish sets `published_at` when empty,
- future `published_at` does not appear publicly,
- archived content does not appear publicly,
- hard delete only allowed for never-published drafts,
- reorder requires all resource IDs and normalizes `sort_order` to `10, 20, 30`,
- writing tags auto-upsert global tags,
- project techs auto-upsert global techs.

- [ ] **Step 5: Implement content repositories and handlers**

Admin routes:

```text
GET/POST/GET:id/PUT:id/PATCH:id/status/DELETE:id/PATCH reorder
```

Public routes:

```text
GET /api/site/projects
GET /api/site/projects/:slug
GET /api/site/writing
GET /api/site/writing/:slug
GET /api/site/talks
GET /api/site/talks/:slug
GET /api/site/home
```

- [ ] **Step 6: Implement home API backfill**

Rules:

- experiences up to 4,
- talks up to 4 featured then recent,
- writing up to 5 featured then recent,
- projects up to 4 featured then recent,
- no duplicate IDs,
- empty optional arrays returned as `[]`.

- [ ] **Step 7: Run content and home tests**

Run:

```powershell
go test ./internal/content ./internal/site
```

Expected: PASS.

- [ ] **Step 8: Commit content APIs**

Run:

```powershell
git add internal/content internal/site
git commit -m "feat: add portfolio content APIs"
```

---

### Task 6: Media Upload, Derivatives, References, Picker

**Files:**
- Create: `internal/media/media.go`
- Create: `internal/media/variants.go`
- Create: `internal/media/references.go`
- Create: `internal/media/media_test.go`

- [ ] **Step 1: Write media tests**

Tests must cover:

- rejects SVG,
- rejects oversized file > 5MB,
- rejects invalid MIME mismatch,
- rejects pixel dimensions above `6000 x 6000` or `24MP`,
- raw temp files are stored in private dir and deleted,
- startup cleanup removes private temp files older than 24 hours,
- derivatives are JPEG or PNG only,
- variants JSON includes `content`, `cover`, `card`, `avatar`,
- media references block delete,
- media picker item includes `referenced`.

- [ ] **Step 2: Run media tests to verify failure**

Run:

```powershell
go test ./internal/media
```

Expected: FAIL.

- [ ] **Step 3: Implement upload processor**

Pipeline:

1. save raw file to `PRIVATE_UPLOADS_DIR`,
2. sniff MIME,
3. decode image,
4. enforce pixel limits,
5. generate random storage key,
6. generate derivatives under `UPLOADS_DIR`,
7. write `media_assets` row with `variants_json`,
8. delete raw file.

- [ ] **Step 4: Implement media references**

Functions:

```go
func RebuildReferences(ctx context.Context, tx *sql.Tx, resourceType string, resourceID int64, refs []Reference) error
func IsReferenced(ctx context.Context, mediaID int64) (bool, error)
```

- [ ] **Step 5: Implement media handlers**

Routes:

```text
GET /api/admin/media?page=:page&limit=:limit&q=:q
POST /api/admin/media
DELETE /api/admin/media/:id
```

- [ ] **Step 6: Run media tests**

Run:

```powershell
go test ./internal/media
```

Expected: PASS.

- [ ] **Step 7: Commit media feature**

Run:

```powershell
git add internal/media
git commit -m "feat: add media upload and references"
```

---

### Task 7: Frontend Foundation, API Client, Markdown Renderer

**Files:**
- Create: `web/src/lib/types.ts`
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/media.ts`
- Create: `web/src/components/markdown/MarkdownView.tsx`
- Create: `web/src/components/markdown/MarkdownView.module.css`
- Create: `web/src/components/markdown/MarkdownView.test.tsx`
- Create: `web/src/test/setup.ts`
- Create: `web/src/test/render.tsx`

- [ ] **Step 1: Add Vitest setup**

Configure `web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});
```

- [ ] **Step 2: Define shared API types**

`web/src/lib/types.ts` must include:

```ts
export type MediaVariant = {
  url: string;
  width: number;
  height: number;
  mime_type: string;
};

export type MediaMap = Record<string, Record<string, MediaVariant>>;

export type APIError = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};
```

- [ ] **Step 3: Write Markdown tests**

Tests:

- raw HTML is not rendered,
- `javascript:` links are removed,
- remote images are rejected,
- `media://asset/42/content` resolves through media map,
- rendered image has width and height.

- [ ] **Step 4: Implement Markdown renderer**

Use:

- `react-markdown`,
- `remark-gfm`,
- `rehype-sanitize`,
- project media resolver before sanitize,
- custom image component.

- [ ] **Step 5: Run frontend Markdown tests**

Run:

```powershell
cd web
npm test -- --run MarkdownView
```

Expected: PASS.

- [ ] **Step 6: Commit frontend foundation**

Run:

```powershell
git add web/src/lib web/src/components/markdown web/src/test web/vite.config.ts
git commit -m "feat: add frontend api types and markdown renderer"
```

---

### Task 8: Admin UI

**Files:**
- Create: `web/src/features/auth/LoginPage.tsx`
- Create: `web/src/features/admin/AdminLayout.tsx`
- Create: `web/src/features/admin/ProfilePage.tsx`
- Create: `web/src/features/admin/ContentListPage.tsx`
- Create: `web/src/features/admin/ContentEditPage.tsx`
- Create: `web/src/features/admin/MediaPage.tsx`
- Modify: `web/src/app/routes.tsx`

- [ ] **Step 1: Write admin UI tests**

Tests:

- login success and failure render correctly,
- unsafe admin mutations send `X-CSRF-Token`,
- profile form sends `If-Match`,
- stale profile response shows conflict message,
- field errors from `error.fields` render beside inputs,
- media picker disables delete when `referenced` is true.

- [ ] **Step 2: Implement API client**

`web/src/lib/api.ts` must:

- include credentials on requests,
- keep CSRF token in memory,
- attach `X-CSRF-Token` for unsafe admin methods after login,
- map `error.fields` into typed errors.

- [ ] **Step 3: Implement admin routes**

Routes:

```text
/admin/login
/admin
/admin/profile
/admin/experience
/admin/talks
/admin/writing
/admin/projects
/admin/media
/admin/preview/:resource/:id
```

- [ ] **Step 4: Implement profile form**

Requirements:

- nested social link editing,
- full-array replacement,
- `If-Match` header,
- field-level errors,
- conflict message.

- [ ] **Step 5: Implement content forms**

Requirements:

- title slug generation,
- manual slug for empty slug,
- status actions,
- featured flag for talks/writing/projects,
- tag/tech ordered lists,
- media picker,
- Markdown preview.

- [ ] **Step 6: Implement media page**

Requirements:

- list media picker items,
- show variants,
- show referenced state,
- disable delete when referenced.

- [ ] **Step 7: Run admin UI tests and build**

Run:

```powershell
cd web
npm test -- --run
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit admin UI**

Run:

```powershell
git add web/src/features web/src/lib web/src/app
git commit -m "feat: add admin content management UI"
```

---

### Task 9: Public UI, SEO, Static Serving, E2E Flow

**Files:**
- Create: `web/src/features/public/HomePage.tsx`
- Create: `web/src/features/public/ProjectDetailPage.tsx`
- Create: `web/src/features/public/WritingDetailPage.tsx`
- Create: `web/src/features/public/TalkDetailPage.tsx`
- Create: `web/src/features/public/PublicListPage.tsx`
- Create: `internal/site/seo.go`
- Create: `internal/site/seo_test.go`
- Modify: `internal/httpserver/routes.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Write SEO/static tests**

Tests:

- homepage meta is escaped,
- detail meta is escaped,
- `/projects`, `/writing`, `/talks`, `/contact` get route-specific meta,
- `/sitemap.xml` excludes drafts, archived, future-dated, preview,
- `/robots.txt` exists,
- `web/dist/assets/*` cache header is immutable,
- HTML cache header is `no-cache`,
- API cache header is `no-store`,
- uploads derivative cache header is immutable,
- CSP contains required directives.

- [ ] **Step 2: Implement SEO injection**

Rules:

- never concatenate raw DB strings into HTML,
- HTML-escape text,
- attribute-escape URLs,
- canonical URLs derived from `PUBLIC_BASE_URL`,
- image URLs from media derivatives.

- [ ] **Step 3: Implement public routes**

Pages:

- home,
- bio,
- talks list,
- talk detail,
- writing list,
- writing detail,
- projects list,
- project detail,
- contact.

- [ ] **Step 4: Implement responsive layout**

Requirements:

- top nav collapses on mobile,
- hero stacks on mobile,
- Experience and Bio stack on mobile,
- cards use stable `16:9` media,
- empty optional modules hidden except profile/contact,
- focus states visible.

- [ ] **Step 5: Implement end-to-end smoke path**

Manual or automated sequence:

```text
login
create project
mark project featured and published
confirm homepage shows project
archive project
confirm homepage no longer shows project
```

- [ ] **Step 6: Run full verification**

Run:

```powershell
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup
cd web
npm test -- --run
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit public site and serving**

Run:

```powershell
git add internal/site internal/httpserver cmd web/src/features/public web/src/app
git commit -m "feat: add public portfolio site and SEO serving"
```

---

## Final Verification Before Release

- [ ] Run backend tests:

```powershell
go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup
```

- [ ] Run frontend tests and build:

```powershell
cd web
npm test -- --run
npm run build
```

- [ ] Run the server locally with production-like env:

```powershell
$env:APP_ORIGIN="http://localhost:8080"
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

- [ ] Verify manually:

```text
http://localhost:8080/
http://localhost:8080/admin/login
http://localhost:8080/sitemap.xml
http://localhost:8080/robots.txt
```

- [ ] Commit final deploy docs:

```powershell
git add README.md docs
git commit -m "docs: add portfolio deployment notes"
```
