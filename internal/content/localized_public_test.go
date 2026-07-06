package content

import (
	"testing"

	"portfolio/internal/i18n"
)

func TestPublicProjectByLocaleSlugUsesPublishableTranslation(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{
		Title:     "Chinese Source Title",
		Summary:   "Chinese Source Summary",
		ContentMD: "Chinese Source Body",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if err := repo.SetProjectStatus(t.Context(), project.ID, StatusPublished, nil); err != nil {
		t.Fatalf("publish source: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, 'English Title', 'english-title', 'English Summary', 'English Body', now())
	`, project.ID); err != nil {
		t.Fatalf("seed translation: %v", err)
	}

	item, meta, alternates, err := repo.PublicProjectByLocaleSlug(t.Context(), i18n.LocaleEN, "english-title")
	if err != nil {
		t.Fatalf("PublicProjectByLocaleSlug: %v", err)
	}
	if item.Title != "English Title" || item.Slug != "english-title" {
		t.Fatalf("localized item = %+v", item)
	}
	if meta.RequestedLocale != "en" || meta.ResolvedLocale != "en" {
		t.Fatalf("meta = %+v", meta)
	}
	if len(alternates) != 2 || alternates[0].Locale != "zh" || alternates[1].Locale != "en" {
		t.Fatalf("alternates = %+v", alternates)
	}
}

func TestPublicProjectsByLocaleOnlyReturnsReviewedCurrentTranslations(t *testing.T) {
	repo := newContentRepo(t)

	current, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Current", ContentMD: "Current"})
	if err != nil {
		t.Fatalf("CreateProject current: %v", err)
	}
	stale, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Stale", ContentMD: "Stale"})
	if err != nil {
		t.Fatalf("CreateProject stale: %v", err)
	}
	draft, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Draft", ContentMD: "Draft"})
	if err != nil {
		t.Fatalf("CreateProject draft: %v", err)
	}

	for _, project := range []Project{current, stale, draft} {
		if err := repo.SetProjectStatus(t.Context(), project.ID, StatusPublished, nil); err != nil {
			t.Fatalf("publish project %d: %v", project.ID, err)
		}
	}

	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		VALUES
			($1, 'en', 'reviewed', 1, 'Current EN', 'current-en', 'Current Summary', '', now()),
			($2, 'en', 'reviewed', 1, 'Stale EN', 'stale-en', 'Stale Summary', '', now()),
			($3, 'en', 'ai_draft', 1, 'Draft EN', 'draft-en', 'Draft Summary', '', now())
	`, current.ID, stale.ID, draft.ID); err != nil {
		t.Fatalf("seed translations: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `UPDATE projects SET translation_source_version = 2 WHERE id = $1`, stale.ID); err != nil {
		t.Fatalf("mark stale source version: %v", err)
	}

	items, meta, err := repo.PublicProjectsByLocale(t.Context(), i18n.LocaleEN, 10)
	if err != nil {
		t.Fatalf("PublicProjectsByLocale: %v", err)
	}
	if meta.RequestedLocale != "en" || meta.ResolvedLocale != "en" {
		t.Fatalf("meta = %+v", meta)
	}
	if len(items) != 1 || items[0].Title != "Current EN" || items[0].Slug != "current-en" {
		t.Fatalf("items = %+v", items)
	}
}
