package site

import (
	"context"
	"database/sql"
	"encoding/xml"
	"html"
	"net/url"
	"path"
	"strings"
	"time"
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
	return strings.Replace(output, "</head>", strings.Join(tags, "")+"</head>", 1)
}

func RouteMeta(routePath string, cfg SEOConfig) PageMeta {
	title := cfg.SiteName
	switch routePath {
	case "/projects":
		title = "Projects | " + cfg.SiteName
	case "/writing":
		title = "Writing | " + cfg.SiteName
	case "/talks":
		title = "Talks | " + cfg.SiteName
	case "/contact":
		title = "Contact | " + cfg.SiteName
	case "/bio":
		title = "Bio | " + cfg.SiteName
	}
	return PageMeta{
		Title:       title,
		Description: cfg.Description,
		Canonical:   strings.TrimRight(cfg.PublicBaseURL, "/") + routePath,
	}
}

func GenerateSitemap(ctx context.Context, database *sql.DB, publicBaseURL string, now time.Time) ([]byte, error) {
	base := strings.TrimRight(publicBaseURL, "/")
	urls := []sitemapURL{
		{Loc: base + "/"},
		{Loc: base + "/bio"},
		{Loc: base + "/talks"},
		{Loc: base + "/writing"},
		{Loc: base + "/projects"},
		{Loc: base + "/contact"},
	}
	for _, entry := range []struct {
		table  string
		prefix string
	}{
		{table: "talks", prefix: "/talks/"},
		{table: "writings", prefix: "/writing/"},
		{table: "projects", prefix: "/projects/"},
	} {
		slugs, err := publicSlugs(ctx, database, entry.table, now)
		if err != nil {
			return nil, err
		}
		for _, slug := range slugs {
			urls = append(urls, sitemapURL{Loc: base + entry.prefix + slug})
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
	rows, err := database.QueryContext(ctx, `SELECT slug FROM `+table+` WHERE status = 'published' AND published_at <= ? ORDER BY published_at DESC`, now.UTC().Format(time.RFC3339Nano))
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
