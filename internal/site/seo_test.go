package site

import (
	"database/sql"
	"strings"
	"testing"
	"time"

	dbtest "portfolio/internal/testutil/postgres"
)

func TestInjectMetaEscapesTextAndAttributes(t *testing.T) {
	html := InjectMeta(`<html><head><title></title></head><body></body></html>`, PageMeta{
		Title:       `<Ada & Co>`,
		Description: `"quoted" <summary>`,
		Canonical:   `https://example.com/projects?a=<x>&b=1`,
		Image:       `https://example.com/uploads/card.jpg`,
	})
	if strings.Contains(html, `<Ada & Co>`) || strings.Contains(html, `"quoted" <summary>`) {
		t.Fatalf("meta text was not escaped: %s", html)
	}
	if !strings.Contains(html, `&lt;Ada &amp; Co&gt;`) {
		t.Fatalf("escaped title missing: %s", html)
	}
	if !strings.Contains(html, `https://example.com/projects?a=%3Cx%3E&amp;b=1`) {
		t.Fatalf("canonical URL was not attribute escaped: %s", html)
	}
}

func TestInjectMetaIncludesAlternatesAndRobots(t *testing.T) {
	html := InjectMeta(`<html><head><title></title></head><body></body></html>`, PageMeta{
		Title:       `Projects`,
		Description: `Localized project listing`,
		Canonical:   `https://example.com/en/projects`,
		Robots:      `noindex, follow`,
		Alternates: []AlternateMeta{
			{Hreflang: "zh", Href: "https://example.com/zh/projects"},
			{Hreflang: "en", Href: "https://example.com/en/projects"},
		},
	})
	if !strings.Contains(html, `rel="alternate" hreflang="zh" href="https://example.com/zh/projects"`) {
		t.Fatalf("alternate zh missing: %s", html)
	}
	if !strings.Contains(html, `rel="alternate" hreflang="en" href="https://example.com/en/projects"`) {
		t.Fatalf("alternate en missing: %s", html)
	}
	if !strings.Contains(html, `meta name="robots" content="noindex, follow"`) {
		t.Fatalf("robots meta missing: %s", html)
	}
}

func TestRouteMetaDefaults(t *testing.T) {
	cfg := SEOConfig{PublicBaseURL: "https://example.com", SiteName: "Portfolio"}
	cases := map[string]string{
		"/projects": "Projects | Portfolio",
		"/writing":  "Writing | Portfolio",
		"/contact":  "Contact | Portfolio",
	}
	for path, want := range cases {
		t.Run(path, func(t *testing.T) {
			meta := RouteMeta(path, cfg)
			if meta.Title != want {
				t.Fatalf("title = %q, want %q", meta.Title, want)
			}
			if meta.Canonical != "https://example.com"+path {
				t.Fatalf("canonical = %q", meta.Canonical)
			}
		})
	}
}

func TestSitemapExcludesNonPublicContent(t *testing.T) {
	database, _ := dbtest.OpenPostgres(t)
	defer database.Close()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	seedSitemapProject(t, databasePath{db: database}, "live", "published", now.Add(-time.Hour))
	seedSitemapProject(t, databasePath{db: database}, "future", "published", now.Add(time.Hour))
	seedSitemapProject(t, databasePath{db: database}, "draft", "draft", now.Add(-time.Hour))
	seedSitemapProject(t, databasePath{db: database}, "archived", "archived", now.Add(-time.Hour))

	xml, err := GenerateSitemap(t.Context(), database, "https://example.com", now)
	if err != nil {
		t.Fatalf("GenerateSitemap: %v", err)
	}
	text := string(xml)
	if !strings.Contains(text, "https://example.com/zh/projects/live") {
		t.Fatalf("live project missing: %s", text)
	}
	for _, forbidden := range []string{"future", "draft", "archived", "admin/preview", "https://example.com/projects/live"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("sitemap contains %q: %s", forbidden, text)
		}
	}
}

func TestSitemapIncludesLocalizedStaticAndPublishableDetailRoutes(t *testing.T) {
	database, _ := dbtest.OpenPostgres(t)
	defer database.Close()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)

	projectID := seedSitemapProject(t, databasePath{db: database}, "zh-live", "published", now.Add(-time.Hour))
	if _, err := database.Exec(`
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		VALUES
			($1, 'en', 'reviewed', 1, 'Live EN', 'en-live', 'Summary', '', now()),
			($1, 'ja', 'ai_draft', 1, 'Live JA', 'ja-live', 'Summary', '', now())
	`, projectID); err != nil {
		t.Fatalf("seed project translations: %v", err)
	}

	xml, err := GenerateSitemap(t.Context(), database, "https://example.com", now)
	if err != nil {
		t.Fatalf("GenerateSitemap: %v", err)
	}
	text := string(xml)
	for _, expected := range []string{
		"https://example.com/zh",
		"https://example.com/en/projects",
		"https://example.com/ja/writing",
		"https://example.com/zh/projects/zh-live",
		"https://example.com/en/projects/en-live",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("sitemap missing %q: %s", expected, text)
		}
	}
	for _, forbidden := range []string{
		"https://example.com/zh/talks",
		"https://example.com/en/talks",
		"https://example.com/ja/talks",
		"https://example.com/projects/zh-live",
		"https://example.com/ja/projects/ja-live",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("sitemap contains %q: %s", forbidden, text)
		}
	}
}

func TestRobotsTxtExists(t *testing.T) {
	body := RobotsTxt("https://example.com")
	if !strings.Contains(body, "Sitemap: https://example.com/sitemap.xml") {
		t.Fatalf("robots.txt missing sitemap: %s", body)
	}
}

type databasePath struct {
	db interface {
		Exec(query string, args ...any) (sql.Result, error)
		QueryRow(query string, args ...any) *sql.Row
	}
}

func seedSitemapProject(t *testing.T, database databasePath, slug string, status string, publishedAt time.Time) int64 {
	t.Helper()
	var id int64
	err := database.db.QueryRow(`INSERT INTO projects (title, slug, summary, content_md, status, featured, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, '', '', $3, false, 10, $4, $5, $6) RETURNING id`,
		slug, slug, status, publishedAt, publishedAt, publishedAt,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seed project %s: %v", slug, err)
	}
	return id
}
