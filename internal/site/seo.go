package site

import (
	"context"
	"database/sql"
	"encoding/xml"
	"fmt"
	"html"
	"net/url"
	"path"
	"strings"
	"time"

	"portfolio/internal/storage"
)

type SEOConfig struct {
	PublicBaseURL string
	SiteName      string
	Description   string
}

type PageMeta struct {
	Title       string
	Description string
	Canonical   string
	Image       string
	Robots      string
	Alternates  []AlternateMeta
}

type AlternateMeta struct {
	Href     string
	Hreflang string
}

func InjectMeta(indexHTML string, meta PageMeta) string {
	title := html.EscapeString(meta.Title)
	description := html.EscapeString(meta.Description)
	canonical := html.EscapeString(safeAbsoluteURL(meta.Canonical))
	image := html.EscapeString(safeAbsoluteURL(meta.Image))
	output := strings.Replace(indexHTML, "<title></title>", "<title>"+title+"</title>", 1)
	tags := []string{
		`<meta name="description" content="` + description + `">`,
		`<link rel="canonical" href="` + canonical + `">`,
		`<meta property="og:title" content="` + title + `">`,
		`<meta property="og:description" content="` + description + `">`,
		`<meta property="og:url" content="` + canonical + `">`,
		`<meta name="twitter:card" content="summary_large_image">`,
	}
	if image != "" {
		tags = append(tags, `<meta property="og:image" content="`+image+`">`)
	}
	if robots := html.EscapeString(strings.TrimSpace(meta.Robots)); robots != "" {
		tags = append(tags, `<meta name="robots" content="`+robots+`">`)
	}
	for _, alternate := range meta.Alternates {
		href := html.EscapeString(safeAbsoluteURL(alternate.Href))
		hreflang := html.EscapeString(strings.TrimSpace(alternate.Hreflang))
		if href == "" || hreflang == "" {
			continue
		}
		tags = append(tags, `<link rel="alternate" hreflang="`+hreflang+`" href="`+href+`">`)
	}
	return strings.Replace(output, "</head>", strings.Join(tags, "")+"</head>", 1)
}

func RouteMeta(routePath string, cfg SEOConfig) PageMeta {
	canonicalPath := normalizedPublicPath(routePath)
	_, leaf := splitLocaleRoute(canonicalPath)
	title := cfg.SiteName
	switch leaf {
	case "/projects":
		title = "Projects | " + cfg.SiteName
	case "/writing":
		title = "Writing | " + cfg.SiteName
	case "/contact":
		title = "Contact | " + cfg.SiteName
	case "/bio":
		title = "Bio | " + cfg.SiteName
	}
	return PageMeta{
		Title:       title,
		Description: cfg.Description,
		Canonical:   strings.TrimRight(cfg.PublicBaseURL, "/") + canonicalPath,
		Alternates:  routeAlternates(canonicalPath, cfg.PublicBaseURL),
	}
}

func GenerateSitemap(ctx context.Context, database *sql.DB, publicBaseURL string, now time.Time) ([]byte, error) {
	base := strings.TrimRight(publicBaseURL, "/")
	urls := []sitemapURL{}
	for _, locale := range []string{"zh", "en", "ja"} {
		urls = append(urls,
			sitemapURL{Loc: base + "/" + locale},
			sitemapURL{Loc: base + "/" + locale + "/bio"},
			sitemapURL{Loc: base + "/" + locale + "/writing"},
			sitemapURL{Loc: base + "/" + locale + "/projects"},
			sitemapURL{Loc: base + "/" + locale + "/contact"},
		)
	}
	for _, entry := range []struct {
		table  string
		prefix string
	}{
		{table: "writings", prefix: "/writing/"},
		{table: "projects", prefix: "/projects/"},
	} {
		slugs, err := publicSlugs(ctx, database, entry.table, now)
		if err != nil {
			return nil, err
		}
		for _, slug := range slugs {
			urls = append(urls, sitemapURL{Loc: base + "/zh" + entry.prefix + slug})
		}
		localized, err := localizedPublicSlugs(ctx, database, entry.table, now)
		if err != nil {
			return nil, err
		}
		for _, route := range localized {
			urls = append(urls, sitemapURL{Loc: base + "/" + route.Locale + entry.prefix + route.Slug})
		}
	}
	doc := sitemap{Xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9", URLs: urls}
	body, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), body...), nil
}

func RobotsTxt(publicBaseURL string) string {
	return "User-agent: *\nAllow: /\nSitemap: " + strings.TrimRight(publicBaseURL, "/") + "/sitemap.xml\n"
}

func publicSlugs(ctx context.Context, database *sql.DB, table string, now time.Time) ([]string, error) {
	if !sitemapTableAllowed(table) {
		return nil, fmt.Errorf("unknown sitemap table %s", table)
	}
	rows, err := database.QueryContext(ctx, `SELECT slug FROM `+table+` WHERE status = 'published' AND published_at <= $1 ORDER BY published_at DESC`, storage.NormalizeTime(now))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	slugs := []string{}
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, err
		}
		slugs = append(slugs, slug)
	}
	return slugs, rows.Err()
}

func sitemapTableAllowed(table string) bool {
	switch table {
	case "talks", "writings", "projects":
		return true
	default:
		return false
	}
}

type localizedSitemapRoute struct {
	Locale string
	Slug   string
}

func localizedPublicSlugs(ctx context.Context, database *sql.DB, table string, now time.Time) ([]localizedSitemapRoute, error) {
	if !sitemapTableAllowed(table) {
		return nil, fmt.Errorf("unknown sitemap table %s", table)
	}
	translationTable, sourceColumn, err := sitemapTranslationConfig(table)
	if err != nil {
		return nil, err
	}
	query := fmt.Sprintf(`
		SELECT translation.locale, translation.slug
		FROM %s source
		JOIN %s translation
		  ON translation.%s = source.id
		 AND translation.translation_status = 'reviewed'
		 AND translation.source_version = source.translation_source_version
		WHERE source.status = 'published'
		  AND source.published_at <= $1
		ORDER BY source.published_at DESC
	`, table, translationTable, sourceColumn)
	rows, err := database.QueryContext(ctx, query, storage.NormalizeTime(now))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	routes := []localizedSitemapRoute{}
	for rows.Next() {
		var route localizedSitemapRoute
		if err := rows.Scan(&route.Locale, &route.Slug); err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}
	return routes, rows.Err()
}

func sitemapTranslationConfig(table string) (string, string, error) {
	switch table {
	case "projects":
		return "project_translations", "project_id", nil
	case "writings":
		return "writing_translations", "writing_id", nil
	case "talks":
		return "talk_translations", "talk_id", nil
	default:
		return "", "", fmt.Errorf("unknown sitemap table %s", table)
	}
}

func normalizedPublicPath(value string) string {
	if value == "" || value == "/" {
		return "/zh"
	}
	normalized := path.Clean("/" + strings.TrimPrefix(value, "/"))
	if normalized == "." {
		return "/zh"
	}
	return normalized
}

func splitLocaleRoute(routePath string) (string, string) {
	trimmed := strings.TrimPrefix(routePath, "/")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		return "", ""
	}
	locale := parts[0]
	if locale != "zh" && locale != "en" && locale != "ja" {
		return "", routePath
	}
	if len(parts) == 1 {
		return locale, ""
	}
	return locale, "/" + parts[1]
}

func routeAlternates(routePath string, publicBaseURL string) []AlternateMeta {
	_, leaf := splitLocaleRoute(routePath)
	if !staticLocaleLeafAllowed(leaf) {
		return nil
	}
	base := strings.TrimRight(publicBaseURL, "/")
	alternates := make([]AlternateMeta, 0, 3)
	for _, locale := range []string{"zh", "en", "ja"} {
		target := "/" + locale
		if leaf != "" {
			target += leaf
		}
		alternates = append(alternates, AlternateMeta{
			Href:     base + target,
			Hreflang: locale,
		})
	}
	return alternates
}

func staticLocaleLeafAllowed(leaf string) bool {
	switch leaf {
	case "", "/bio", "/writing", "/projects", "/contact":
		return true
	default:
		return false
	}
}

func safeAbsoluteURL(value string) string {
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	parsed.Path = path.Clean("/" + strings.TrimPrefix(parsed.Path, "/"))
	parsed.RawQuery = parsed.Query().Encode()
	return parsed.String()
}

type sitemap struct {
	XMLName xml.Name     `xml:"urlset"`
	Xmlns   string       `xml:"xmlns,attr"`
	URLs    []sitemapURL `xml:"url"`
}

type sitemapURL struct {
	Loc string `xml:"loc"`
}
