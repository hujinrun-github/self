# Multilingual Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement locale-prefixed public pages, translation persistence, admin translation workflows, and DeepSeek-backed EN/JA draft generation on top of Chinese source content without exposing draft or stale translations publicly.

**Architecture:** Keep the existing Go monolith and React SPA, but add explicit locale helpers, translation tables beside the source tables, locale-aware public read DTOs, and admin translation endpoints with optimistic concurrency. Roll the feature out in shippable slices: public routing shell, database schema, locale-aware reads, admin edit foundation, translation save/review, AI generation, and SEO/sitemap hardening.

**Tech Stack:** Go 1.26.4, PostgreSQL, chi, React 19, React Router 7, Vitest, Testing Library, embedded SQL migrations, DeepSeek HTTP API.

---

## File Structure

- Modify `cmd/server/main.go`: route the SPA shell through the tested `internal/httpserver` top-level dispatcher, wire translation service config, and inject locale-aware SEO metadata into the SPA shell.
- Create `internal/i18n/locale.go`: backend locale constants, public-locale coercion, strict translation-locale parsing, fallback order, and query parsing helpers.
- Create `internal/i18n/locale_test.go`: unit coverage for locale coercion, strict translation-locale parsing, and fallback behavior.
- Create `internal/db/migrations/002_multilingual.sql`: add `translation_source_version` columns plus all translation tables, indexes, and constraints.
- Modify `internal/db/postgres_test.go`: assert multilingual tables, uniqueness constraints, and source-version columns exist after migration.
- Modify `internal/httpserver/routes.go`: own the tested redirect behavior for legacy public paths plus unsupported or not-yet-activated locale prefixes while preserving `/admin`, `/api`, `/uploads`, `/assets`, `/sitemap.xml`, `/robots.txt`, `/favicon.svg`, and `/icons.svg`.
- Modify `internal/httpserver/routes_test.go`: regression coverage for redirect and reserved-prefix handling.
- Create `internal/content/localized.go`: shared localized DTOs, alternates, translation status, and locale-aware row mappers for routable content.
- Create `internal/content/localized_public_test.go`: zh source reads, publishable EN/JA reads, alternates, stale filtering, and 404 coverage for localized slugs.
- Modify `internal/content/public.go`: locale-aware list/detail readers for projects, writing, and talks.
- Modify `internal/content/routes.go`: accept `locale` query parameters on public endpoints and add admin detail, translation save, review, and generate endpoints.
- Modify `internal/content/projects.go`, `internal/content/writing.go`, `internal/content/talks.go`, `internal/content/experience.go`: load/save `translation_source_version`, add detail reads, and expose localized admin DTOs.
- Modify `internal/content/content_test.go`: source-version bump rules, admin detail routes, and translation endpoint conflict coverage.
- Modify `internal/profile/profile.go`: stable-ID social-link persistence, locale-aware public profile reads, localized admin DTOs, translation save/review endpoints, and profile source-version updates.
- Modify `internal/profile/profile_test.go`: stable-ID save semantics, locale fallback, translation ETags, and review conflict coverage.
- Modify `internal/site/home.go`: locale-aware homepage payloads using publishable localized cards plus fallback profile copy rules.
- Modify `internal/site/home_test.go`: homepage locale filtering, stale exclusion, and fallback metadata coverage.
- Modify `internal/site/routes.go`: parse locale query parameters for `/api/site/home`.
- Modify `internal/site/seo.go`: locale-aware route metadata, `<html lang>`, canonical tags, `hreflang`, `noindex`, and localized sitemap generation.
- Modify `internal/site/seo_test.go`: sitemap, canonical, alternate, and fallback-indexing assertions.
- Create `internal/translation/service.go`: provider-agnostic translation service interface plus generation concurrency checks.
- Create `internal/translation/deepseek.go`: DeepSeek request/response adapter, prompt construction, timeout handling, and structured JSON validation.
- Create `internal/translation/service_test.go`: provider-disabled behavior, slug validation, and conflict handling tests.
- Modify `internal/config/config.go` and `internal/config/config_test.go`: optional translation provider env vars and redaction-safe config formatting.
- Create `web/src/features/public/locale.ts`: frontend locale constants, URL builders, query builders, and fixed-copy dictionaries.
- Create `web/src/features/public/PublicRoutes.test.tsx`: route redirect, locale-preserving links, and switcher behavior tests.
- Modify `web/src/app/routes.tsx`: start with a `/zh` canonical public shell plus locale-prefix redirects, then expand to real `/:locale/*` public routes once publishable locale reads are available.
- Modify `web/src/features/public/PublicLayout.tsx`: locale-aware nav links and language switcher shell.
- Modify `web/src/features/public/HomePage.tsx`, `PublicListPage.tsx`, `detail.tsx`, `ProjectDetailPage.tsx`, `TalkDetailPage.tsx`, and `WritingDetailPage.tsx`: locale-aware fetches, copy, alternates, and disabled missing-language targets.
- Modify `web/src/lib/api.ts`: helper for reading response headers like locale ETags and alternates if needed by admin pages.
- Modify `web/src/features/admin/ContentEditPage.tsx`: existing-record edit mode, shared-fields panel, locale tabs, translation save/review/generate actions, and slug-unpublish warning flow.
- Modify `web/src/features/admin/ProfilePage.tsx`: shared profile fields, zh source tab, EN/JA translation tabs, and stable-ID social-link editing.
- Modify `web/src/features/admin/AdminUI.test.tsx`: stale conflict messaging, `If-None-Match` creation, `If-Match` updates, and slug unpublish confirmation coverage.
- Modify `README.md`: document translation env vars, locale-prefixed routes, and required test commands.

## Task 1: Canonical ZH Routing And Redirects

**Files:**
- Create: `web/src/features/public/locale.ts`
- Create: `web/src/features/public/PublicRoutes.test.tsx`
- Modify: `web/src/app/routes.tsx`
- Modify: `web/src/features/public/PublicLayout.tsx`
- Modify: `web/src/features/public/HomePage.tsx`
- Modify: `web/src/features/public/PublicListPage.tsx`
- Modify: `web/src/features/public/detail.tsx`
- Modify: `web/src/features/public/ProjectDetailPage.tsx`
- Modify: `web/src/features/public/TalkDetailPage.tsx`
- Modify: `web/src/features/public/WritingDetailPage.tsx`
- Modify: `internal/httpserver/routes.go`
- Modify: `internal/httpserver/routes_test.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Write the failing routing tests**

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { renderWithApp } from "../../test/render";
import { publicRoutes } from "../../app/routes";

describe("public locale routes", () => {
  it("redirects bare root to /zh", async () => {
    const router = createMemoryRouter(publicRoutes, { initialEntries: ["/"] });
    renderWithApp(<RouterProvider router={router} />);
    await screen.findByRole("link", { name: "Projects" });
    expect(router.state.location.pathname).toBe("/zh");
  });

  it("redirects unsupported or not-yet-activated locale prefixes to /zh equivalents", async () => {
    const router = createMemoryRouter(publicRoutes, { initialEntries: ["/fr/projects"] });
    renderWithApp(<RouterProvider router={router} />);
    await screen.findByRole("link", { name: "Projects" });
    expect(router.state.location.pathname).toBe("/zh/projects");
  });

  it("redirects inactive EN and JA shells back to zh before Task 3", async () => {
    const router = createMemoryRouter(publicRoutes, { initialEntries: ["/en/projects"] });
    renderWithApp(<RouterProvider router={router} />);
    await screen.findByRole("link", { name: "Projects" });
    expect(router.state.location.pathname).toBe("/zh/projects");
  });

  it("keeps zh prefixes in primary navigation before EN and JA are activated", async () => {
    const router = createMemoryRouter(publicRoutes, { initialEntries: ["/zh/projects"] });
    renderWithApp(<RouterProvider router={router} />);
    expect(await screen.findByRole("link", { name: "Bio" })).toHaveAttribute("href", "/zh/bio");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/zh/projects");
  });
});
```

```go
func TestRedirectsLegacyAndInactiveLocalePathsToZh(t *testing.T) {
	router := NewRouter(RouterOptions{ReactFallback: http.HandlerFunc(writeText("spa"))})
	cases := map[string]string{
		"/":                "/zh",
		"/en":              "/zh",
		"/ja":              "/zh",
		"/fr":              "/zh",
		"/projects":        "/zh/projects",
		"/writing/sample":  "/zh/writing/sample",
		"/talks/sample":    "/zh/talks/sample",
		"/bio":             "/zh/bio",
		"/contact":         "/zh/contact",
		"/fr/projects":     "/zh/projects",
		"/en/projects":     "/zh/projects",
		"/ja/writing/demo": "/zh/writing/demo",
	}
	for path, want := range cases {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusPermanentRedirect {
			t.Fatalf("%s status = %d", path, recorder.Code)
		}
		if got := recorder.Header().Get("Location"); got != want {
			t.Fatalf("%s location = %q, want %q", path, got, want)
		}
	}
}
```

Also extend the existing `TestRoutePriorityBeforeSPAFallback` coverage with:

```go
"/admin/profile": "spa",
```

- [ ] **Step 2: Run the routing tests and verify failure**

Run:

```powershell
npm --prefix web test -- src/features/public/PublicRoutes.test.tsx
go test ./internal/httpserver -run "TestRedirectsLegacyAndInactiveLocalePathsToZh|TestRoutePriorityBeforeSPAFallback" -count=1
```

Expected: FAIL because the React router still exposes a generic locale shell, unsupported locale prefixes are not redirected, and the backend router still falls straight through to the SPA shell.

- [ ] **Step 3: Implement the minimal locale shell and redirect helper**

Add `web/src/features/public/locale.ts`:

```ts
export const supportedLocales = ["zh", "en", "ja"] as const;

export type Locale = (typeof supportedLocales)[number];

export function coerceLocale(value: string | undefined): Locale {
  return supportedLocales.includes(value as Locale) ? (value as Locale) : "zh";
}

export function withLocale(locale: Locale, path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalized === "/" ? "" : normalized}`;
}
```

Update `web/src/app/routes.tsx` to export a zh-only public shell plus a locale-prefix redirect gate:

```tsx
function LocalePrefixRedirect() {
  const location = useLocation();
  const { "*": rest = "" } = useParams();
  const suffix = rest ? `/${rest}` : "";
  return <Navigate replace to={`/zh${suffix}${location.search}`} />;
}

export const publicRoutes = [
  { element: <Navigate replace to="/zh" />, path: "/" },
  {
    path: "/zh",
    children: [
      { element: <HomePage />, index: true },
      { element: <PublicListPage resource="talks" />, path: "talks" },
      { element: <TalkDetailPage />, path: "talks/:slug" },
      { element: <PublicListPage resource="writing" />, path: "writing" },
      { element: <WritingDetailPage />, path: "writing/:slug" },
      { element: <PublicListPage resource="projects" />, path: "projects" },
      { element: <ProjectDetailPage />, path: "projects/:slug" },
    ],
  },
  { element: <LocalePrefixRedirect />, path: "/:locale/*" },
];
```

Add the redirect behavior in `internal/httpserver/routes.go` itself so `NewRouter` is the tested implementation path, then have `cmd/server/main.go` use that dispatcher instead of duplicating fallback rules:

```go
func RedirectLegacyOrInactiveLocalePath(path string) (string, bool) {
	for _, reserved := range []string{"/admin", "/api", "/uploads", "/assets", "/favicon.svg", "/icons.svg", "/sitemap.xml", "/robots.txt"} {
		if path == reserved || strings.HasPrefix(path, reserved+"/") {
			return "", false
		}
	}
	switch path {
	case "/":
		return "/zh", true
	case "/bio", "/contact", "/projects", "/writing", "/talks":
		return "/zh" + path, true
	}
	for _, prefix := range []string{"/projects/", "/writing/", "/talks/"} {
		if strings.HasPrefix(path, prefix) {
			return "/zh" + path, true
		}
	}
	if locale, rest, ok := splitLeadingSegment(path); ok && locale != "zh" {
		if rest == "" {
			return "/zh", true
		}
		return "/zh" + rest, true
	}
	return "", false
}

func splitLeadingSegment(path string) (string, string, bool) {
	trimmed := strings.TrimPrefix(path, "/")
	if trimmed == "" {
		return "", "", false
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) == 1 {
		return parts[0], "", true
	}
	return parts[0], "/" + parts[1], true
}
```

- [ ] **Step 4: Run the routing tests and verify they pass**

Run:

```powershell
npm --prefix web test -- src/features/public/PublicRoutes.test.tsx
go test ./internal/httpserver -run "TestRedirectsLegacyAndInactiveLocalePathsToZh|TestRoutePriorityBeforeSPAFallback" -count=1
```

Expected: PASS with `/ -> /zh`, bare legacy public paths redirecting to their `/zh/*` forms, `/fr/*` and temporarily inactive `/en/*` or `/ja/*` paths redirecting to `/zh/*`, and no public EN/JA shell exposed before Task 3.

- [ ] **Step 5: Commit the routing shell**

```powershell
git add web/src/features/public/locale.ts web/src/features/public/PublicRoutes.test.tsx web/src/app/routes.tsx web/src/features/public/PublicLayout.tsx web/src/features/public/HomePage.tsx web/src/features/public/PublicListPage.tsx web/src/features/public/detail.tsx web/src/features/public/ProjectDetailPage.tsx web/src/features/public/TalkDetailPage.tsx web/src/features/public/WritingDetailPage.tsx internal/httpserver/routes.go internal/httpserver/routes_test.go cmd/server/main.go
git commit -m "feat: canonicalize public zh routes"
```

## Task 2: Add Locale Primitives And Multilingual Schema

**Files:**
- Create: `internal/i18n/locale.go`
- Create: `internal/i18n/locale_test.go`
- Create: `internal/db/migrations/002_multilingual.sql`
- Modify: `internal/db/postgres_test.go`

- [ ] **Step 1: Write the failing locale and migration tests**

```go
func TestCoerceLocaleFallsBackToZh(t *testing.T) {
	if got := CoerceLocale("fr"); got != LocaleZH {
		t.Fatalf("locale = %q, want %q", got, LocaleZH)
	}
	if got := CoerceLocale("ja"); got != LocaleJA {
		t.Fatalf("locale = %q, want %q", got, LocaleJA)
	}
}

func TestParseTranslationLocaleRejectsZhAndUnknown(t *testing.T) {
	if _, err := ParseTranslationLocale("zh"); err == nil {
		t.Fatal("expected zh translation locale to be rejected")
	}
	if _, err := ParseTranslationLocale("fr"); err == nil {
		t.Fatal("expected unknown translation locale to be rejected")
	}
	if locale, err := ParseTranslationLocale("en"); err != nil || locale != LocaleEN {
		t.Fatalf("locale=%q err=%v", locale, err)
	}
}

func TestMigrationCreatesTranslationTablesAndConstraints(t *testing.T) {
	database, _ := dbtest.OpenPostgres(t)
	for _, table := range []string{
		"profile_translations",
		"social_link_translations",
		"experience_translations",
		"project_translations",
		"writing_translations",
		"talk_translations",
	} {
		var count int
		err := database.QueryRow(`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = $1`, table).Scan(&count)
		if err != nil || count != 1 {
			t.Fatalf("missing table %s: %v count=%d", table, err, count)
		}
	}
}
```

- [ ] **Step 2: Run the schema tests and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/i18n ./internal/db -run "TestCoerceLocaleFallsBackToZh|TestParseTranslationLocaleRejectsZhAndUnknown|TestMigrationCreatesTranslationTablesAndConstraints" -count=1
```

Expected: FAIL because the locale package does not exist and the schema has no translation tables or `translation_source_version` columns.

- [ ] **Step 3: Implement locale primitives and the migration**

Create `internal/i18n/locale.go`:

```go
package i18n

type Locale string

const (
	LocaleZH Locale = "zh"
	LocaleEN Locale = "en"
	LocaleJA Locale = "ja"
)

func CoerceLocale(value string) Locale {
	switch Locale(value) {
	case LocaleEN, LocaleJA, LocaleZH:
		return Locale(value)
	default:
		return LocaleZH
	}
}

func FallbackOrder(locale Locale) []Locale {
	switch locale {
	case LocaleJA:
		return []Locale{LocaleJA, LocaleEN, LocaleZH}
	case LocaleEN:
		return []Locale{LocaleEN, LocaleZH}
	default:
		return []Locale{LocaleZH}
	}
}

func ParseTranslationLocale(value string) (Locale, error) {
	switch Locale(value) {
	case LocaleEN, LocaleJA:
		return Locale(value), nil
	default:
		return "", fmt.Errorf("unsupported translation locale %q", value)
	}
}
```

Create `internal/db/migrations/002_multilingual.sql` with the full schema addition:

```sql
ALTER TABLE profile ADD COLUMN translation_source_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE social_links ADD COLUMN translation_source_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE experiences ADD COLUMN translation_source_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN translation_source_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE writings ADD COLUMN translation_source_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE talks ADD COLUMN translation_source_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE profile_translations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ja')),
  translation_status TEXT NOT NULL CHECK (translation_status IN ('ai_draft', 'reviewed')),
  source_version BIGINT NOT NULL,
  name TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  bio TEXT NOT NULL,
  seo_title TEXT,
  seo_description TEXT,
  translated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (profile_id, locale)
);

CREATE TABLE project_translations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ja')),
  translation_status TEXT NOT NULL CHECK (translation_status IN ('ai_draft', 'reviewed')),
  source_version BIGINT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL,
  content_md TEXT NOT NULL,
  seo_title TEXT,
  seo_description TEXT,
  translated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (project_id, locale),
  UNIQUE (locale, slug)
);
```

Add the remaining tables in the same migration file:

- `social_link_translations` with `UNIQUE (social_link_id, locale)`
- `experience_translations` with `UNIQUE (experience_id, locale)`
- `project_translations` with `UNIQUE (project_id, locale)` and `UNIQUE (locale, slug)`
- `writing_translations` with `UNIQUE (writing_id, locale)` and `UNIQUE (locale, slug)`
- `talk_translations` with `UNIQUE (talk_id, locale)` and `UNIQUE (locale, slug)`

- [ ] **Step 4: Run the schema tests and verify they pass**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/i18n ./internal/db -run "TestCoerceLocaleFallsBackToZh|TestParseTranslationLocaleRejectsZhAndUnknown|TestMigrationCreatesTranslationTablesAndConstraints" -count=1
```

Expected: PASS with public locale coercion working, strict translation-locale parsing rejecting `zh` and unknown values, and the new multilingual tables visible in the migrated PostgreSQL schema.

- [ ] **Step 5: Commit the multilingual schema**

```powershell
git add internal/i18n/locale.go internal/i18n/locale_test.go internal/db/migrations/002_multilingual.sql internal/db/postgres_test.go
git commit -m "feat: add multilingual schema primitives"
```

## Task 3: Make Public Reads Locale-Aware

**Files:**
- Create: `internal/content/localized.go`
- Create: `internal/content/localized_public_test.go`
- Modify: `internal/content/public.go`
- Modify: `internal/content/routes.go`
- Modify: `internal/profile/profile.go`
- Modify: `internal/profile/profile_test.go`
- Modify: `internal/site/home.go`
- Modify: `internal/site/home_test.go`
- Modify: `internal/site/routes.go`
- Modify: `web/src/app/routes.tsx`
- Modify: `web/src/features/public/PublicRoutes.test.tsx`
- Modify: `web/src/features/public/HomePage.tsx`
- Modify: `web/src/features/public/PublicListPage.tsx`
- Modify: `web/src/features/public/detail.tsx`
- Modify: `web/src/features/public/PublicLayout.tsx`

- [ ] **Step 1: Write the failing locale-aware public read tests**

```go
func TestPublicProjectByLocaleSlugUsesPublishableTranslation(t *testing.T) {
	repo := newContentRepo(t)
	project, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Chinese Source Title", Summary: "Chinese Source Summary"})
	if err := repo.SetProjectStatus(t.Context(), project.ID, StatusPublished, nil); err != nil {
		t.Fatalf("publish source: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, 'English Title', 'english-title', 'English Summary', '', now())
	`, project.ID); err != nil {
		t.Fatalf("seed translation: %v", err)
	}

	item, meta, alternates, err := repo.PublicProjectByLocaleSlug(t.Context(), i18n.LocaleEN, "english-title")
	if err != nil {
		t.Fatalf("PublicProjectByLocaleSlug: %v", err)
	}
	if item.Title != "English Title" || meta.ResolvedLocale != "en" || len(alternates) != 2 {
		t.Fatalf("item=%+v meta=%+v alternates=%+v", item, meta, alternates)
	}
}

func TestPublicProfileFallsBackWhenRequestedLocaleIsMissing(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{Name: "Chinese Name", Headline: "Chinese Headline", Summary: "Chinese Summary", Bio: "Chinese Bio"})
	public, meta, err := repo.GetPublicByLocale(t.Context(), i18n.LocaleJA)
	if err != nil {
		t.Fatalf("GetPublicByLocale: %v", err)
	}
	if public.Name != "Chinese Name" || meta.RequestedLocale != "ja" || meta.ResolvedLocale != "zh" {
		t.Fatalf("public=%+v meta=%+v", public, meta)
	}
}
```

```tsx
// Replace the Task 1 "inactive EN/JA redirect" assertion in this file with a real activation assertion.
it("activates real EN routes only after locale-aware reads are available", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ requested_locale: "en", resolved_locale: "en", items: [] }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const router = createMemoryRouter(publicRoutes, { initialEntries: ["/en/projects"] });
  renderWithApp(<RouterProvider router={router} />);

  await screen.findByText("No published entries yet.");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/site/projects?locale=en",
    expect.objectContaining({ credentials: "include" }),
  );
});
```

- [ ] **Step 2: Run the public-read tests and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/content ./internal/profile ./internal/site -run "TestPublicProjectByLocaleSlugUsesPublishableTranslation|TestPublicProfileFallsBackWhenRequestedLocaleIsMissing" -count=1
npm --prefix web test -- src/features/public/PublicRoutes.test.tsx
```

Expected: FAIL because public routes still read only Chinese source columns, `/en` and `/ja` are not yet activated as real publishable routes, and the frontend does not append locale query parameters to public API calls.

- [ ] **Step 3: Implement locale-aware readers and metadata**

Create `internal/content/localized.go`:

```go
type LocaleMeta struct {
	RequestedLocale string `json:"requested_locale"`
	ResolvedLocale  string `json:"resolved_locale"`
	FallbackFrom    string `json:"fallback_from,omitempty"`
}

type AlternateRoute struct {
	Locale   string `json:"locale"`
	Kind     string `json:"kind"`
	Slug     string `json:"slug"`
	Path     string `json:"path"`
	Reviewed bool   `json:"reviewed"`
}
```

Add a locale-aware detail reader in `internal/content/public.go`:

```go
func (r *Repository) PublicProjectByLocaleSlug(ctx context.Context, locale i18n.Locale, slug string) (LocalizedProject, LocaleMeta, []AlternateRoute, error) {
	if locale == i18n.LocaleZH {
		project, err := r.PublicProjectBySlug(ctx, slug)
		return LocalizedProjectFromSource(project), LocaleMeta{RequestedLocale: "zh", ResolvedLocale: "zh"}, []AlternateRoute{
			{Locale: "zh", Kind: "source", Slug: project.Slug, Path: "/zh/projects/" + project.Slug, Reviewed: true},
		}, err
	}
	return r.publicProjectByTranslationSlug(ctx, locale, slug)
}
```

Extend `internal/content/routes.go` and `internal/site/routes.go` to parse `locale := i18n.CoerceLocale(req.URL.Query().Get("locale"))` and return JSON payloads shaped like:

```json
{
  "requested_locale": "ja",
  "resolved_locale": "en",
  "fallback_from": "ja",
  "items": []
}
```

Extend `internal/profile/profile.go` with `GetPublicByLocale` that walks `i18n.FallbackOrder(locale)` and only treats EN/JA rows as publishable when `translation_status = 'reviewed'` and `source_version = translation_source_version`.

After the backend publishable gating exists, expand `web/src/app/routes.tsx` from the Task 1 zh-only shell to real locale routes:

```tsx
export const publicRoutes = [
  { element: <Navigate replace to="/zh" />, path: "/" },
  {
    path: "/:locale",
    loader: ({ params, request }) => {
      if (!supportedLocales.includes(params.locale as Locale)) {
        const url = new URL(request.url);
        const rest = url.pathname.replace(/^\/[^/]+/, "");
        throw redirect(`/zh${rest || ""}${url.search}`);
      }
      return null;
    },
    children: [
      { element: <HomePage />, index: true },
      { element: <PublicListPage resource="projects" />, path: "projects" },
      { element: <ProjectDetailPage />, path: "projects/:slug" },
      { element: <PublicListPage resource="writing" />, path: "writing" },
      { element: <WritingDetailPage />, path: "writing/:slug" },
      { element: <PublicListPage resource="talks" />, path: "talks" },
      { element: <TalkDetailPage />, path: "talks/:slug" },
    ],
  },
];
```

Update the public pages to append the locale query parameter to backend reads, for example:

```ts
apiFetch(`/api/site/${resource}?locale=${locale}`)
```

- [ ] **Step 4: Run the public-read tests and verify they pass**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/content ./internal/profile ./internal/site -run "TestPublicProjectByLocaleSlugUsesPublishableTranslation|TestPublicProfileFallsBackWhenRequestedLocaleIsMissing" -count=1
npm --prefix web test -- src/features/public/PublicRoutes.test.tsx
```

Expected: PASS with zh source reads preserved, EN/JA routes activated only now that publishable gating exists, alternates emitted for routable detail pages, and locale-aware public fetches using explicit `?locale=` parameters.

- [ ] **Step 5: Commit locale-aware public reads**

```powershell
git add internal/content/localized.go internal/content/localized_public_test.go internal/content/public.go internal/content/routes.go internal/profile/profile.go internal/profile/profile_test.go internal/site/home.go internal/site/home_test.go internal/site/routes.go web/src/app/routes.tsx web/src/features/public/PublicRoutes.test.tsx web/src/features/public/HomePage.tsx web/src/features/public/PublicListPage.tsx web/src/features/public/detail.tsx web/src/features/public/PublicLayout.tsx
git commit -m "feat: activate publishable locale public reads"
```

## Task 4: Add Existing-Record Admin Editing And Stable Social-Link IDs

**Files:**
- Modify: `internal/content/routes.go`
- Modify: `internal/content/projects.go`
- Modify: `internal/content/writing.go`
- Modify: `internal/content/talks.go`
- Modify: `internal/content/experience.go`
- Modify: `internal/content/content_test.go`
- Modify: `internal/profile/profile.go`
- Modify: `internal/profile/profile_test.go`
- Modify: `web/src/app/routes.tsx`
- Modify: `web/src/features/admin/ContentEditPage.tsx`
- Modify: `web/src/features/admin/ProfilePage.tsx`
- Modify: `web/src/features/admin/AdminUI.test.tsx`

- [ ] **Step 1: Write the failing admin detail and stable-ID tests**

```go
func TestAdminProjectDetailLoadsExistingRecord(t *testing.T) {
	repo := newContentRepo(t)
	project, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Existing"})
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/admin/projects/%d", project.ID), nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestSaveAdminPreservesStableSocialLinkIDs(t *testing.T) {
	repo, _ := newProfileTestServer(t)
	seedProfile(t, repo, ProfileInput{
		Name: "Ada",
		SocialLinks: []SocialLinkInput{{Label: "GitHub", URL: "https://github.com/ada", Icon: "github"}},
	})
	admin, etag, _ := repo.GetAdmin(t.Context())
	linkID := admin.SocialLinks[0].ID

	err := repo.SaveAdmin(t.Context(), ProfileInput{
		Name: "Ada",
		SocialLinks: []SocialLinkInput{{ID: linkID, Label: "GitHub", URL: "https://github.com/ada", Icon: "github"}},
	}, etag)
	if err != nil {
		t.Fatalf("SaveAdmin: %v", err)
	}
	after, _, _ := repo.GetAdmin(t.Context())
	if after.SocialLinks[0].ID != linkID {
		t.Fatalf("social link id = %d, want %d", after.SocialLinks[0].ID, linkID)
	}
}
```

```tsx
it("loads an existing project into edit mode", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, title: "Existing", slug: "existing", summary: "" }), { status: 200, headers: { "Content-Type": "application/json" } })));

  const router = createMemoryRouter(
    [{ path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> }],
    { initialEntries: ["/admin/projects/7"] },
  );

  renderWithApp(<RouterProvider router={router} />);
  expect(await screen.findByDisplayValue("Existing")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the admin detail tests and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/content ./internal/profile -run "TestAdminProjectDetailLoadsExistingRecord|TestSaveAdminPreservesStableSocialLinkIDs" -count=1
npm --prefix web test -- src/features/admin/AdminUI.test.tsx
```

Expected: FAIL because only create routes exist for most content types, the frontend has only `/admin/*/new` pages, and profile saves still delete and recreate social-link rows.

- [ ] **Step 3: Implement admin detail reads and stable-ID saves**

Add missing detail routes in `internal/content/routes.go`:

```go
r.Get("/api/admin/projects/{id}", getProjectHandler(repo))
r.Get("/api/admin/writing/{id}", getWritingHandler(repo))
r.Get("/api/admin/talks/{id}", getTalkHandler(repo))
r.Get("/api/admin/experience/{id}", getExperienceHandler(repo))

r.Put("/api/admin/writing/{id}", updateWritingHandler(repo))
r.Put("/api/admin/talks/{id}", updateTalkHandler(repo))
r.Put("/api/admin/experience/{id}", updateExperienceHandler(repo))
```

Extend `SocialLinkInput` in `internal/profile/profile.go` and switch `SaveAdmin` to upsert-by-ID:

```go
type SocialLinkInput struct {
	ID    *int64 `json:"id,omitempty"`
	Label string `json:"label"`
	URL   string `json:"url"`
	Icon  string `json:"icon"`
}
```

```go
if link.ID != nil {
	_, err = tx.ExecContext(ctx, `
		UPDATE social_links
		SET label = $1, url = $2, icon = $3, sort_order = $4, updated_at = $5
		WHERE id = $6 AND profile_id = $7
	`, link.Label, link.URL, link.Icon, (index+1)*10, now, *link.ID, 1)
} else {
	err = tx.QueryRowContext(ctx, `
		INSERT INTO social_links (profile_id, label, url, icon, sort_order, created_at, updated_at, translation_source_version)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
		RETURNING id
	`, 1, link.Label, link.URL, link.Icon, (index+1)*10, now, now).Scan(new(int64))
}
```

- [ ] **Step 4: Run the admin detail tests and verify they pass**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/content ./internal/profile -run "TestAdminProjectDetailLoadsExistingRecord|TestSaveAdminPreservesStableSocialLinkIDs" -count=1
npm --prefix web test -- src/features/admin/AdminUI.test.tsx
```

Expected: PASS with `/api/admin/<resource>/{id}` routes returning existing content, `/admin/<resource>/:id` edit pages loading data, and profile link edits preserving stable IDs across reorder and save cycles.

- [ ] **Step 5: Commit the admin edit foundation**

```powershell
git add internal/content/routes.go internal/content/projects.go internal/content/writing.go internal/content/talks.go internal/content/experience.go internal/content/content_test.go internal/profile/profile.go internal/profile/profile_test.go web/src/app/routes.tsx web/src/features/admin/ContentEditPage.tsx web/src/features/admin/ProfilePage.tsx web/src/features/admin/AdminUI.test.tsx
git commit -m "feat: add admin detail editing foundation"
```

## Task 5: Add Translation Save And Review Endpoints With Optimistic Concurrency

**Files:**
- Create: `internal/content/translation_admin.go`
- Create: `internal/profile/translation_admin.go`
- Modify: `internal/content/routes.go`
- Modify: `internal/profile/profile.go`
- Modify: `internal/content/content_test.go`
- Modify: `internal/profile/profile_test.go`

- [ ] **Step 1: Write the failing translation save/review tests**

```go
func TestSaveProjectTranslationUsesIfNoneMatchForFirstLocaleWrite(t *testing.T) {
	repo := newContentRepo(t)
	project, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Chinese Source Title"})
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/admin/projects/%d/translations/en", project.ID), bytes.NewBufferString(`{"title":"English","slug":"english","summary":"Summary","content_md":""}`))
	req.Header.Set("If-None-Match", "*")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestReviewProjectTranslationRejectsStaleSourceVersion(t *testing.T) {
	repo := newContentRepo(t)
	project, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Chinese Source Title"})
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		VALUES ($1, 'en', 'ai_draft', 1, 'English', 'english', 'Summary', '', now())
	`, project.ID); err != nil {
		t.Fatalf("seed draft: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `UPDATE projects SET translation_source_version = 2 WHERE id = $1`, project.ID); err != nil {
		t.Fatalf("bump source version: %v", err)
	}

	err := repo.MarkProjectTranslationReviewed(t.Context(), project.ID, i18n.LocaleEN, `"draft-etag"`)
	if !errors.Is(err, ErrTranslationStale) {
		t.Fatalf("review err = %v", err)
	}
}

func TestProfileTranslationRouteRejectsUnsupportedLocalePath(t *testing.T) {
	_, handler := newProfileTestServer(t)
	for _, path := range []string{
		"/api/admin/profile/translations/zh",
		"/api/admin/profile/translations/fr",
	} {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, path, bytes.NewBufferString(`{"name":"English Name"}`))
		req.Header.Set("If-None-Match", "*")
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d body=%s", path, recorder.Code, recorder.Body.String())
		}
	}
}
```

- [ ] **Step 2: Run the translation endpoint tests and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/content ./internal/profile -run "TestSaveProjectTranslationUsesIfNoneMatchForFirstLocaleWrite|TestReviewProjectTranslationRejectsStaleSourceVersion|TestProfileTranslationRouteRejectsUnsupportedLocalePath" -count=1
```

Expected: FAIL because translation endpoints, per-locale ETags, strict translation-locale validation, `If-None-Match: *`, and review gating do not exist yet.

- [ ] **Step 3: Implement translation detail, save, and review flows**

Create a translation persistence helper in `internal/content/translation_admin.go`:

```go
func (r *Repository) SaveProjectTranslation(ctx context.Context, projectID int64, locale i18n.Locale, input ProjectTranslationInput, ifMatch string, ifNoneMatch string) error {
	current, err := r.projectTranslationSnapshot(ctx, projectID, locale)
	if err != nil {
		return err
	}
	switch {
	case !current.Exists && ifNoneMatch != "*":
		return ErrPreconditionRequired
	case current.Exists && current.ETag != ifMatch:
		return ErrConflict
	}
	return r.saveProjectTranslation(ctx, projectID, locale, input)
}
```

Register routes in `internal/content/routes.go`:

```go
r.Put("/api/admin/projects/{id}/translations/{locale}", saveProjectTranslationHandler(repo))
r.Post("/api/admin/projects/{id}/translations/{locale}/review", reviewProjectTranslationHandler(repo))
```

The content handlers must also parse translation locales strictly:

```go
func saveProjectTranslationHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
			return
		}
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input ProjectTranslationInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid project translation payload", nil)
			return
		}
		err = repo.SaveProjectTranslation(req.Context(), id, locale, input, req.Header.Get("If-Match"), req.Header.Get("If-None-Match"))
		writeTranslationResult(w, err)
	}
}
```

Implement the profile handlers explicitly in `internal/profile/profile.go`:

```go
r.Put("/api/admin/profile/translations/{locale}", func(w http.ResponseWriter, req *http.Request) {
	locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
	if err != nil {
		httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
		return
	}
	var input ProfileTranslationInput
	if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
		httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid profile translation payload", nil)
		return
	}
	err := repo.SaveTranslation(req.Context(), locale, input, req.Header.Get("If-Match"), req.Header.Get("If-None-Match"))
	writeProfileTranslationResult(w, err)
})

r.Post("/api/admin/profile/translations/{locale}/review", func(w http.ResponseWriter, req *http.Request) {
	locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
	if err != nil {
		httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
		return
	}
	err := repo.MarkTranslationReviewed(req.Context(), locale, req.Header.Get("If-Match"))
	writeProfileTranslationResult(w, err)
})
```

Keep `content_md: ""` valid in these tests and handlers for project and writing translations. In this plan, empty localized long-body Markdown is an intentional authored value, not a validation error.

- [ ] **Step 4: Run the translation endpoint tests and verify they pass**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/content ./internal/profile -run "TestSaveProjectTranslationUsesIfNoneMatchForFirstLocaleWrite|TestReviewProjectTranslationRejectsStaleSourceVersion|TestProfileTranslationRouteRejectsUnsupportedLocalePath" -count=1
```

Expected: PASS with first-time locale creates requiring `If-None-Match: *`, updates requiring `If-Match`, stale source versions blocked at review time, `zh` and unknown translation path locales rejected with `400`, and per-locale ETags returned from admin detail reads.

- [ ] **Step 5: Commit translation save/review support**

```powershell
git add internal/content/translation_admin.go internal/profile/translation_admin.go internal/content/routes.go internal/profile/profile.go internal/content/content_test.go internal/profile/profile_test.go
git commit -m "feat: add translation save and review endpoints"
```

## Task 6: Add DeepSeek Translation Generation

**Files:**
- Create: `internal/translation/service.go`
- Create: `internal/translation/deepseek.go`
- Create: `internal/translation/service_test.go`
- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`
- Modify: `cmd/server/main.go`
- Modify: `internal/content/routes.go`
- Modify: `internal/profile/profile.go`

- [ ] **Step 1: Write the failing provider and generation-conflict tests**

```go
func TestGenerateReturnsConfigurationErrorWhenProviderDisabled(t *testing.T) {
	service := NewService(Config{})
	_, err := service.GenerateProject(t.Context(), ProjectTranslationSource{
		Title:   "Chinese Source Title",
		Summary: "Chinese Source Summary",
	}, i18n.LocaleEN)
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("GenerateProject err = %v", err)
	}
}

func TestGenerateProjectAbortsWhenLocaleRowChangesMidFlight(t *testing.T) {
	service := NewService(Config{
		Provider: "deepseek",
		Client: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return jsonResponse(`{"title":"English","slug":"english","summary":"Summary","content_md":""}`), nil
		}),
	})
	start := TranslationSnapshot{LocaleETag: `"before"`, SourceVersion: 3}
	end := TranslationSnapshot{LocaleETag: `"after"`, SourceVersion: 3}
	err := checkGenerationSnapshot(start, end)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("checkGenerationSnapshot err = %v", err)
	}
}
```

- [ ] **Step 2: Run the provider tests and verify failure**

Run:

```powershell
go test ./internal/translation ./internal/config -run "TestGenerateReturnsConfigurationErrorWhenProviderDisabled|TestGenerateProjectAbortsWhenLocaleRowChangesMidFlight" -count=1
```

Expected: FAIL because the translation service package and optional translation env vars do not exist yet.

- [ ] **Step 3: Implement the translation service and wire generate endpoints**

Add optional config fields in `internal/config/config.go`:

```go
type Config struct {
	TranslationProvider       string
	TranslationAPIKey         string
	TranslationBaseURL        string
	TranslationModel          string
	TranslationTimeoutSeconds int
}
```

Create `internal/translation/service.go`:

```go
type Config struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
	Timeout  time.Duration
	Client   *http.Client
}

type Service struct {
	cfg Config
}

func NewService(cfg Config) *Service {
	return &Service{cfg: cfg}
}
```

Wire `POST /api/admin/<resource>/{id}/translations/{locale}/generate` in `cmd/server/main.go` and the admin route packages with an explicit conflict check:

```go
func (h *TranslationHandlers) GenerateProjectTranslation(ctx context.Context, projectID int64, locale i18n.Locale) error {
	start, err := h.repo.ProjectTranslationSnapshot(ctx, projectID, locale)
	if err != nil {
		return err
	}
	source, err := h.repo.ProjectTranslationSource(ctx, projectID)
	if err != nil {
		return err
	}
	generated, err := h.service.GenerateProject(ctx, source, locale)
	if err != nil {
		return err
	}
	end, err := h.repo.ProjectTranslationSnapshot(ctx, projectID, locale)
	if err != nil {
		return err
	}
	if err := checkGenerationSnapshot(start, end); err != nil {
		return err
	}
	return h.repo.SaveGeneratedProjectTranslation(ctx, projectID, locale, generated)
}
```

Generation validation must preserve an empty `content_md` string when the provider intentionally returns no long body for a project or writing translation. Empty localized Markdown is valid in this plan; `NULL` is the only missing-body signal.

- [ ] **Step 4: Run the provider tests and verify they pass**

Run:

```powershell
go test ./internal/translation ./internal/config -run "TestGenerateReturnsConfigurationErrorWhenProviderDisabled|TestGenerateProjectAbortsWhenLocaleRowChangesMidFlight" -count=1
```

Expected: PASS with provider-disabled behavior returning a controlled error, DeepSeek prompt/response validation active, and generation conflicts detected before writes.

- [ ] **Step 5: Commit DeepSeek generation support**

```powershell
git add internal/translation/service.go internal/translation/deepseek.go internal/translation/service_test.go internal/config/config.go internal/config/config_test.go cmd/server/main.go internal/content/routes.go internal/profile/profile.go
git commit -m "feat: add deepseek translation generation"
```

## Task 7: Build The Admin Multilingual UI

**Files:**
- Modify: `web/src/features/admin/ContentEditPage.tsx`
- Modify: `web/src/features/admin/ProfilePage.tsx`
- Modify: `web/src/features/admin/AdminUI.test.tsx`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Write the failing admin translation UI tests**

```tsx
it("creates the first locale translation with If-None-Match star", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      id: 7,
      source: { title: "Chinese Source Title", slug: "zh-slug" },
      translations: { en: { exists: false, etag: null, translation_status: "empty" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);

  const router = createMemoryRouter(
    [{ path: "/admin/projects/:id", element: <ContentEditPage resource="projects" /> }],
    { initialEntries: ["/admin/projects/7"] },
  );

  renderWithApp(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByRole("tab", { name: "EN" }));
  await userEvent.type(screen.getByLabelText("Title"), "English");
  await userEvent.click(screen.getByRole("button", { name: /save translation/i }));

  const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
  expect(new Headers(init.headers).get("If-None-Match")).toBe("*");
});

it("warns before unpublishing a locale to edit slug", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 7,
    source: { title: "Chinese Source Title", slug: "zh-slug" },
    translations: { en: { exists: true, etag: "\"abc\"", translation_status: "reviewed", stale: false, slug: "english" } },
  }), { status: 200, headers: { "Content-Type": "application/json" } })));

  renderWithApp(<MemoryRouter><ContentEditPage resource="projects" /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: /unpublish locale to edit slug/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the admin UI tests and verify failure**

Run:

```powershell
npm --prefix web test -- src/features/admin/AdminUI.test.tsx
```

Expected: FAIL because admin pages still render a single-language create form and do not perform per-locale save, review, or unpublish actions.

- [ ] **Step 3: Implement locale tabs, translation actions, and warning flows**

Add locale-state shape to `ContentEditPage.tsx`:

```ts
type TranslationState = {
  exists: boolean;
  etag: string | null;
  stale: boolean;
  translation_status: "empty" | "ai_draft" | "reviewed";
  title: string;
  slug: string;
  summary: string;
  content_md: string;
};
```

Implement locale-aware save logic:

```ts
async function saveTranslation(locale: "en" | "ja", draft: TranslationState) {
  const headers: Record<string, string> = {};
  if (draft.exists && draft.etag) {
    headers["If-Match"] = draft.etag;
  } else {
    headers["If-None-Match"] = "*";
  }
  await apiFetch(`/api/admin/${typedResource}/${id}/translations/${locale}`, {
    body: JSON.stringify(draft),
    headers,
    method: "PUT",
  });
}
```

Add a guarded slug edit flow:

```ts
if (translation.translation_status === "reviewed") {
  setMessage("Unpublish locale to edit slug before changing the public URL.");
  return;
}
```

- [ ] **Step 4: Run the admin UI tests and verify they pass**

Run:

```powershell
npm --prefix web test -- src/features/admin/AdminUI.test.tsx
```

Expected: PASS with locale tabs, per-locale ETag handling, first-save `If-None-Match: *`, review actions, stale conflict messaging, and the explicit unpublish-before-slug-edit warning.

- [ ] **Step 5: Commit the admin multilingual UI**

```powershell
git add web/src/features/admin/ContentEditPage.tsx web/src/features/admin/ProfilePage.tsx web/src/features/admin/AdminUI.test.tsx web/src/lib/api.ts
git commit -m "feat: add admin multilingual editing ui"
```

## Task 8: Add Locale-Aware SEO, Sitemap, And Public Switchers

**Files:**
- Modify: `internal/site/seo.go`
- Modify: `internal/site/seo_test.go`
- Modify: `cmd/server/main.go`
- Modify: `web/src/features/public/PublicLayout.tsx`
- Modify: `web/src/features/public/HomePage.tsx`
- Modify: `web/src/features/public/PublicListPage.tsx`
- Modify: `web/src/features/public/detail.tsx`
- Modify: `web/src/features/public/PublicRoutes.test.tsx`
- Modify: `README.md`

- [ ] **Step 1: Write the failing SEO and switcher tests**

```go
func TestGenerateSitemapOnlyIncludesPublishableLocaleURLs(t *testing.T) {
	database, _ := dbtest.OpenPostgres(t)
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	seedSitemapProject(t, databasePath{db: database}, "zh-slug", "published", now.Add(-time.Hour))
	_, err := database.Exec(`
		UPDATE projects SET translation_source_version = 1 WHERE slug = 'zh-slug';
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		SELECT id, 'en', 'reviewed', 1, 'English', 'english', 'Summary', '', now()
		FROM projects WHERE slug = 'zh-slug'
	`)
	if err != nil {
		t.Fatalf("seed english translation: %v", err)
	}
	xml, err := GenerateSitemap(t.Context(), database, "https://example.com", now)
	if err != nil {
		t.Fatalf("GenerateSitemap: %v", err)
	}
	text := string(xml)
	if !strings.Contains(text, "https://example.com/en/projects/english") {
		t.Fatalf("missing publishable english url: %s", text)
	}
	if strings.Contains(text, "https://example.com/ja/projects") {
		t.Fatalf("unexpected japanese locale url: %s", text)
	}
}
```

```tsx
it("disables unavailable locale alternates on detail pages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    requested_locale: "en",
    resolved_locale: "en",
    item: { title: "English", summary: "Summary", content_md: "" },
    alternates: [
      { locale: "zh", kind: "source", slug: "zh-slug", path: "/zh/projects/zh-slug", reviewed: true },
      { locale: "en", kind: "translation", slug: "english", path: "/en/projects/english", reviewed: true }
    ]
  }), { status: 200, headers: { "Content-Type": "application/json" } })));

  renderWithApp(<MemoryRouter initialEntries={["/en/projects/english"]}><ProjectDetailPage /></MemoryRouter>);
  expect(await screen.findByRole("link", { name: "ZH" })).toHaveAttribute("href", "/zh/projects/zh-slug");
  expect(screen.getByRole("button", { name: "JA" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the SEO and switcher tests and verify failure**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/site -run "TestGenerateSitemapOnlyIncludesPublishableLocaleURLs" -count=1
npm --prefix web test -- src/features/public/PublicRoutes.test.tsx
```

Expected: FAIL because sitemap output is still monolingual, no `hreflang` or `noindex` logic exists, and detail pages do not render locale alternates or disabled missing-language targets.

- [ ] **Step 3: Implement locale-aware SEO, sitemap, and switchers**

Extend `internal/site/seo.go`:

```go
type AlternateMeta struct {
	HrefLang string
	Href     string
}

type PageMeta struct {
	Title       string
	Description string
	Canonical   string
	Image       string
	HTMLLang    string
	Robots      string
	Alternates  []AlternateMeta
}
```

Update `InjectMeta` to write `<html lang>`, canonical, `hreflang`, and optional robots tags:

```go
output := strings.Replace(indexHTML, `<html>`, `<html lang="`+meta.HTMLLang+`">`, 1)
if meta.Robots != "" {
	tags = append(tags, `<meta name="robots" content="`+html.EscapeString(meta.Robots)+`">`)
}
for _, alternate := range meta.Alternates {
	tags = append(tags, `<link rel="alternate" hreflang="`+html.EscapeString(alternate.HrefLang)+`" href="`+html.EscapeString(alternate.Href)+`">`)
}
```

Render the public language switcher in `web/src/features/public/PublicLayout.tsx` using the alternates returned by locale-aware detail APIs and the same-page locale paths for static pages.

- [ ] **Step 4: Run the SEO and switcher tests and verify they pass**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./internal/site -run "TestGenerateSitemapOnlyIncludesPublishableLocaleURLs" -count=1
npm --prefix web test -- src/features/public/PublicRoutes.test.tsx
```

Expected: PASS with zh source URLs and publishable EN/JA URLs appearing in sitemap output, fallback pages marked `noindex,follow`, and public detail switchers only enabling locales that have real alternates.

- [ ] **Step 5: Commit SEO and switcher hardening**

```powershell
git add internal/site/seo.go internal/site/seo_test.go cmd/server/main.go web/src/features/public/PublicLayout.tsx web/src/features/public/HomePage.tsx web/src/features/public/PublicListPage.tsx web/src/features/public/detail.tsx web/src/features/public/PublicRoutes.test.tsx README.md
git commit -m "feat: add multilingual seo and switchers"
```

## Task 9: Run Full Regression Before Merge

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the final verification checklist to README**

```md
## Multilingual Verification

Backend:
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./...

Frontend:
npm --prefix web test
```

- [ ] **Step 2: Run the full backend regression suite**

Run:

```powershell
$env:TEST_DATABASE_URL="postgres://postgres:12345@192.168.1.20:19588/postgres?sslmode=disable"
go test ./...
```

Expected: PASS with multilingual schema, locale reads, admin translation endpoints, DeepSeek generation guards, and sitemap coverage all green.

- [ ] **Step 3: Run the full frontend regression suite**

Run:

```powershell
npm --prefix web test
```

Expected: PASS with locale routes, public switchers, and admin translation flows covered.

- [ ] **Step 4: Build the frontend bundle and verify production shell wiring**

Run:

```powershell
npm --prefix web run build
go test ./internal/httpserver ./internal/site -count=1
```

Expected: PASS with a fresh `web/dist` build and the locale-aware SPA shell still serving production metadata correctly.

- [ ] **Step 5: Commit the verification pass**

```powershell
git add README.md
git commit -m "docs: record multilingual verification workflow"
```
