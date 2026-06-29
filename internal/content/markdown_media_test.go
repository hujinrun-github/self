package content

import (
	"fmt"
	"strconv"
	"testing"

	"portfolio/internal/i18n"
)

func TestBuildMediaMapDeduplicatesMediaRefsAndReturnsMediaRouteURLs(t *testing.T) {
	repo := newContentRepo(t)
	mediaID := insertMarkdownMediaAsset(t, repo, "markdown-map-cover")

	markdown := fmt.Sprintf("![cover](media://asset/%d/content)\n\n[podcast](media://asset/%d/content)", mediaID, mediaID)
	mediaMap, err := repo.buildMediaMap(t.Context(), markdown)
	if err != nil {
		t.Fatalf("buildMediaMap: %v", err)
	}

	if len(mediaMap) != 1 {
		t.Fatalf("media map size = %d, want 1", len(mediaMap))
	}
	content := mediaMap[strconv.FormatInt(mediaID, 10)]["content"]
	if content.URL != fmt.Sprintf("/media/%d/content", mediaID) {
		t.Fatalf("content URL = %q", content.URL)
	}
	if content.Width == nil || *content.Width == 0 {
		t.Fatalf("expected width in %+v", content)
	}
	if content.Height == nil || *content.Height == 0 {
		t.Fatalf("expected height in %+v", content)
	}
}

func TestPublicWritingByLocaleSlugEnrichesTranslatedMarkdownMedia(t *testing.T) {
	repo := newContentRepo(t)
	mediaID := insertMarkdownMediaAsset(t, repo, "translated-writing-cover")
	writing, err := repo.CreateWriting(t.Context(), WritingInput{
		Title:     "Chinese Writing",
		Excerpt:   "Chinese Summary",
		ContentMD: "Chinese Body",
	})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	if err := repo.SetWritingStatus(t.Context(), writing.ID, StatusPublished, nil); err != nil {
		t.Fatalf("SetWritingStatus: %v", err)
	}

	translatedMarkdown := fmt.Sprintf("![cover](media://asset/%d/content)\n\nTranslated body", mediaID)
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO writing_translations
			(writing_id, locale, translation_status, source_version, title, slug, excerpt, content_md, seo_title, seo_description, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, 'English Writing', 'english-writing', 'English Summary', $2, 'SEO', 'SEO Description', now())
	`, writing.ID, translatedMarkdown); err != nil {
		t.Fatalf("seed writing translation: %v", err)
	}

	item, meta, alternates, err := repo.PublicWritingByLocaleSlug(t.Context(), i18n.LocaleEN, "english-writing")
	if err != nil {
		t.Fatalf("PublicWritingByLocaleSlug: %v", err)
	}

	if item.Title != "English Writing" || item.ContentMD != translatedMarkdown {
		t.Fatalf("localized writing = %+v", item)
	}
	if meta.RequestedLocale != "en" || meta.ResolvedLocale != "en" {
		t.Fatalf("meta = %+v", meta)
	}
	if len(alternates) != 2 {
		t.Fatalf("alternates = %+v", alternates)
	}

	content := item.Media[strconv.FormatInt(mediaID, 10)]["content"]
	if content.URL != fmt.Sprintf("/media/%d/content", mediaID) {
		t.Fatalf("content URL = %q", content.URL)
	}
}

func insertMarkdownMediaAsset(t *testing.T, repo *Repository, keySuffix string) int64 {
	t.Helper()

	var id int64
	err := repo.db.QueryRowContext(t.Context(), `
		INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())
		RETURNING id
	`,
		"cover.png",
		"markdown-media-"+keySuffix,
		"image/png",
		10,
		1600,
		900,
		`{"content":{"path":"/uploads/aa/bb/content.jpg","width":1600,"height":900,"mime_type":"image/jpeg","size_bytes":10}}`,
		"checksum-"+keySuffix,
	).Scan(&id)
	if err != nil {
		t.Fatalf("insertMarkdownMediaAsset: %v", err)
	}
	return id
}
