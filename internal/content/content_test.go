package content

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/i18n"
	"portfolio/internal/translation"
)

func TestProjectCreateDefaultsToDraftAndPublishSetsPublishedAt(t *testing.T) {
	repo := newContentRepo(t)
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo.clock = func() time.Time { return now }

	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Launch Pad"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if project.Status != StatusDraft {
		t.Fatalf("status = %s", project.Status)
	}
	if project.PublishedAt != nil {
		t.Fatalf("new draft published_at = %v", project.PublishedAt)
	}

	if err := repo.SetProjectStatus(t.Context(), project.ID, StatusPublished, nil); err != nil {
		t.Fatalf("SetProjectStatus: %v", err)
	}
	project, err = repo.GetProject(t.Context(), project.ID)
	if err != nil {
		t.Fatalf("GetProject: %v", err)
	}
	if project.PublishedAt == nil || !project.PublishedAt.Equal(now) {
		t.Fatalf("published_at = %v, want %v", project.PublishedAt, now)
	}
}

func TestPublicProjectsExcludeFuturePublishedAndArchived(t *testing.T) {
	repo := newContentRepo(t)
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo.clock = func() time.Time { return now }

	published, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Published"})
	if err := repo.SetProjectStatus(t.Context(), published.ID, StatusPublished, nil); err != nil {
		t.Fatalf("publish current: %v", err)
	}
	future, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Future"})
	futureTime := now.Add(24 * time.Hour)
	if err := repo.SetProjectStatus(t.Context(), future.ID, StatusPublished, &futureTime); err != nil {
		t.Fatalf("publish future: %v", err)
	}
	archived, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Archived"})
	if err := repo.SetProjectStatus(t.Context(), archived.ID, StatusPublished, nil); err != nil {
		t.Fatalf("publish archived: %v", err)
	}
	if err := repo.SetProjectStatus(t.Context(), archived.ID, StatusArchived, nil); err != nil {
		t.Fatalf("archive: %v", err)
	}

	public, err := repo.PublicProjects(t.Context(), 10)
	if err != nil {
		t.Fatalf("PublicProjects: %v", err)
	}
	if len(public) != 1 || public[0].ID != published.ID {
		t.Fatalf("public projects = %+v", public)
	}
}

func TestHardDeleteOnlyAllowsNeverPublishedDrafts(t *testing.T) {
	repo := newContentRepo(t)
	draft, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Draft"})
	if err := repo.DeleteProject(t.Context(), draft.ID); err != nil {
		t.Fatalf("delete never-published draft: %v", err)
	}

	published, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Published"})
	if err := repo.SetProjectStatus(t.Context(), published.ID, StatusPublished, nil); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if err := repo.SetProjectStatus(t.Context(), published.ID, StatusArchived, nil); err != nil {
		t.Fatalf("archive: %v", err)
	}
	if err := repo.DeleteProject(t.Context(), published.ID); !errors.Is(err, ErrDeleteBlocked) {
		t.Fatalf("delete archived err = %v", err)
	}
}

func TestReorderRequiresAllResourceIDsAndNormalizesSortOrder(t *testing.T) {
	repo := newContentRepo(t)
	first, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "First"})
	second, _ := repo.CreateProject(t.Context(), ProjectInput{Title: "Second"})

	if err := repo.ReorderProjects(t.Context(), []int64{second.ID}); !errors.Is(err, ErrInvalidReorder) {
		t.Fatalf("partial reorder err = %v", err)
	}
	if err := repo.ReorderProjects(t.Context(), []int64{second.ID, first.ID}); err != nil {
		t.Fatalf("ReorderProjects: %v", err)
	}
	second, _ = repo.GetProject(t.Context(), second.ID)
	first, _ = repo.GetProject(t.Context(), first.ID)
	if second.SortOrder != 10 || first.SortOrder != 20 {
		t.Fatalf("sort orders = second:%d first:%d", second.SortOrder, first.SortOrder)
	}
}

func TestListProjectsReturnsAdminEntries(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Admin Listing"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	items, err := repo.ListProjects(t.Context(), 12)
	if err != nil {
		t.Fatalf("ListProjects: %v", err)
	}
	if len(items) != 1 || items[0].ID != project.ID {
		t.Fatalf("projects = %+v", items)
	}
}

func TestWritingTagsAndProjectTechsAutoUpsertTerms(t *testing.T) {
	repo := newContentRepo(t)
	writing, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Go Notes", Tags: []string{"Go", "SQLite"}})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	if len(writing.Tags) != 2 || writing.Tags[0].Slug != "go" || writing.Tags[1].Slug != "sqlite" {
		t.Fatalf("writing tags = %+v", writing.Tags)
	}

	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Go Project", Techs: []string{"Go", "React"}})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if len(project.Techs) != 2 || project.Techs[0].Slug != "go" || project.Techs[1].Slug != "react" {
		t.Fatalf("project techs = %+v", project.Techs)
	}
}

func TestWritingTagsAndProjectTechsDedupeDuplicateInputs(t *testing.T) {
	repo := newContentRepo(t)
	writing, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Duplicate Tags", Tags: []string{"Go", "Go", "React"}})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	if len(writing.Tags) != 2 || writing.Tags[0].Slug != "go" || writing.Tags[0].SortOrder != 10 || writing.Tags[1].Slug != "react" || writing.Tags[1].SortOrder != 20 {
		t.Fatalf("writing tags = %+v", writing.Tags)
	}

	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Duplicate Techs", Techs: []string{"Go", "Go", "React"}})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if len(project.Techs) != 2 || project.Techs[0].Slug != "go" || project.Techs[0].SortOrder != 10 || project.Techs[1].Slug != "react" || project.Techs[1].SortOrder != 20 {
		t.Fatalf("project techs = %+v", project.Techs)
	}
}

func TestConcurrentProjectCreateAllocatesUniqueSlugAndSortOrder(t *testing.T) {
	repo := newContentRepo(t)
	const createCount = 12
	errs := make(chan error, createCount)
	projects := make(chan Project, createCount)
	for i := 0; i < createCount; i++ {
		go func() {
			project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Same Title"})
			if err != nil {
				errs <- err
				return
			}
			projects <- project
			errs <- nil
		}()
	}
	for i := 0; i < createCount; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("CreateProject concurrent: %v", err)
		}
	}
	slugs := map[string]bool{}
	sortOrders := map[int]bool{}
	for i := 0; i < createCount; i++ {
		project := <-projects
		if slugs[project.Slug] {
			t.Fatalf("duplicate slug %q in project %+v", project.Slug, project)
		}
		slugs[project.Slug] = true
		if sortOrders[project.SortOrder] {
			t.Fatalf("duplicate sort_order %d in project %+v", project.SortOrder, project)
		}
		sortOrders[project.SortOrder] = true
	}
}

func TestProjectTranslationSourceVersionTracksTranslatableChangesOnly(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{
		Title:     "Chinese Project",
		Summary:   "Summary",
		ContentMD: "Body",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if version := contentTranslationSourceVersion(t, repo, "projects", project.ID); version != 1 {
		t.Fatalf("initial version = %d", version)
	}

	if _, err := repo.UpdateProject(t.Context(), project.ID, ProjectInput{
		Title:     "Chinese Project",
		Summary:   "Summary",
		ContentMD: "Body",
		DemoURL:   "https://example.com/demo",
		Featured:  true,
	}); err != nil {
		t.Fatalf("UpdateProject shared fields: %v", err)
	}
	if version := contentTranslationSourceVersion(t, repo, "projects", project.ID); version != 1 {
		t.Fatalf("shared-field version = %d, want 1", version)
	}

	if _, err := repo.UpdateProject(t.Context(), project.ID, ProjectInput{
		Title:     "Chinese Project",
		Summary:   "Updated Summary",
		ContentMD: "Body",
		DemoURL:   "https://example.com/demo",
		Featured:  true,
	}); err != nil {
		t.Fatalf("UpdateProject translatable fields: %v", err)
	}
	if version := contentTranslationSourceVersion(t, repo, "projects", project.ID); version != 2 {
		t.Fatalf("translatable-field version = %d, want 2", version)
	}
}

func TestWritingTalkExperienceTranslationSourceVersionBumpsOnTranslatableChanges(t *testing.T) {
	repo := newContentRepo(t)

	writing, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Chinese Writing", Excerpt: "Excerpt", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	if _, err := repo.UpdateWriting(t.Context(), writing.ID, WritingInput{Title: "Chinese Writing", Excerpt: "Updated Excerpt", ContentMD: "Body"}); err != nil {
		t.Fatalf("UpdateWriting: %v", err)
	}
	if version := contentTranslationSourceVersion(t, repo, "writings", writing.ID); version != 2 {
		t.Fatalf("writing version = %d, want 2", version)
	}

	talk, err := repo.CreateTalk(t.Context(), TalkInput{Title: "Chinese Talk", Summary: "Summary", EventName: "Event"})
	if err != nil {
		t.Fatalf("CreateTalk: %v", err)
	}
	if _, err := repo.UpdateTalk(t.Context(), talk.ID, TalkInput{Title: "Chinese Talk", Summary: "Updated Summary", EventName: "Event"}); err != nil {
		t.Fatalf("UpdateTalk: %v", err)
	}
	if version := contentTranslationSourceVersion(t, repo, "talks", talk.ID); version != 2 {
		t.Fatalf("talk version = %d, want 2", version)
	}

	experience, err := repo.CreateExperience(t.Context(), ExperienceInput{
		Title:        "Chinese Experience",
		Organization: "Org",
		Description:  "Description",
		Period:       "2024",
	})
	if err != nil {
		t.Fatalf("CreateExperience: %v", err)
	}
	if _, err := repo.UpdateExperience(t.Context(), experience.ID, ExperienceInput{
		Title:        "Chinese Experience",
		Organization: "Org",
		Description:  "Updated Description",
		Period:       "2024",
	}); err != nil {
		t.Fatalf("UpdateExperience: %v", err)
	}
	if version := contentTranslationSourceVersion(t, repo, "experiences", experience.ID); version != 2 {
		t.Fatalf("experience version = %d, want 2", version)
	}
}

func TestAdminDetailLoadsExistingRecord(t *testing.T) {
	repo := newContentRepo(t)
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Existing Project", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	writing, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Existing Writing", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	talk, err := repo.CreateTalk(t.Context(), TalkInput{Title: "Existing Talk"})
	if err != nil {
		t.Fatalf("CreateTalk: %v", err)
	}
	experience, err := repo.CreateExperience(t.Context(), ExperienceInput{Title: "Existing Experience"})
	if err != nil {
		t.Fatalf("CreateExperience: %v", err)
	}

	cases := []struct {
		name string
		path string
		want string
	}{
		{name: "project", path: fmt.Sprintf("/api/admin/projects/%d", project.ID), want: "Existing Project"},
		{name: "writing", path: fmt.Sprintf("/api/admin/writing/%d", writing.ID), want: "Existing Writing"},
		{name: "talk", path: fmt.Sprintf("/api/admin/talks/%d", talk.ID), want: "Existing Talk"},
		{name: "experience", path: fmt.Sprintf("/api/admin/experience/%d", experience.ID), want: "Existing Experience"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
			}
			if !bytes.Contains(recorder.Body.Bytes(), []byte(tc.want)) {
				t.Fatalf("body = %s, want title %q", recorder.Body.String(), tc.want)
			}
		})
	}
}

func TestAdminUpdateRoutesPersistExistingContent(t *testing.T) {
	repo := newContentRepo(t)
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	writing, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Before Writing", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	talk, err := repo.CreateTalk(t.Context(), TalkInput{Title: "Before Talk"})
	if err != nil {
		t.Fatalf("CreateTalk: %v", err)
	}
	experience, err := repo.CreateExperience(t.Context(), ExperienceInput{Title: "Before Experience"})
	if err != nil {
		t.Fatalf("CreateExperience: %v", err)
	}

	cases := []struct {
		name       string
		path       string
		payload    string
		verifyPath string
		want       string
	}{
		{
			name:       "writing",
			path:       fmt.Sprintf("/api/admin/writing/%d", writing.ID),
			payload:    `{"title":"After Writing","slug":"after-writing","excerpt":"Updated","content_md":"Updated body","tags":["Go"]}`,
			verifyPath: fmt.Sprintf("/api/admin/writing/%d", writing.ID),
			want:       "After Writing",
		},
		{
			name:       "talk",
			path:       fmt.Sprintf("/api/admin/talks/%d", talk.ID),
			payload:    `{"title":"After Talk","slug":"after-talk","summary":"Updated","event_name":"Conf","video_url":"https://example.com"}`,
			verifyPath: fmt.Sprintf("/api/admin/talks/%d", talk.ID),
			want:       "After Talk",
		},
		{
			name:       "experience",
			path:       fmt.Sprintf("/api/admin/experience/%d", experience.ID),
			payload:    `{"title":"After Experience","organization":"Org","description":"Updated","period":"2026"}`,
			verifyPath: fmt.Sprintf("/api/admin/experience/%d", experience.ID),
			want:       "After Experience",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, tc.path, bytes.NewBufferString(tc.payload)))
			if recorder.Code != http.StatusOK {
				t.Fatalf("update status = %d body=%s", recorder.Code, recorder.Body.String())
			}

			recorder = httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.verifyPath, nil))
			if recorder.Code != http.StatusOK {
				t.Fatalf("verify status = %d body=%s", recorder.Code, recorder.Body.String())
			}
			if !bytes.Contains(recorder.Body.Bytes(), []byte(tc.want)) {
				t.Fatalf("body = %s, want title %q", recorder.Body.String(), tc.want)
			}
		})
	}
}

func TestHardDeleteDraftProjectClearsMediaReferences(t *testing.T) {
	repo := newContentRepo(t)
	mediaID := insertContentMediaAsset(t, repo)
	project, err := repo.CreateProject(t.Context(), ProjectInput{
		Title:        "Referenced Draft",
		CoverMediaID: &mediaID,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `INSERT INTO media_references (media_asset_id, resource_type, resource_id, source, created_at) VALUES ($1, $2, $3, $4, now())`, mediaID, "project", project.ID, "cover"); err != nil {
		t.Fatalf("insert media reference: %v", err)
	}
	if err := repo.DeleteProject(t.Context(), project.ID); err != nil {
		t.Fatalf("DeleteProject: %v", err)
	}
	var count int
	if err := repo.db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM media_references WHERE resource_type = $1 AND resource_id = $2`, "project", project.ID).Scan(&count); err != nil {
		t.Fatalf("count media references: %v", err)
	}
	if count != 0 {
		t.Fatalf("media reference count = %d, want 0", count)
	}
}

func TestSaveProjectTranslationUsesIfNoneMatchForFirstLocaleWrite(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Chinese Source Title", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	req := httptest.NewRequest(
		http.MethodPut,
		fmt.Sprintf("/api/admin/projects/%d/translations/en", project.ID),
		bytes.NewBufferString(`{"title":"English","slug":"english","summary":"Summary","content_md":""}`),
	)
	req.Header.Set("If-None-Match", "*")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestReviewProjectTranslationRejectsStaleSourceVersion(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Chinese Source Title", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
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

	err = repo.MarkProjectTranslationReviewed(t.Context(), project.ID, i18n.LocaleEN, `"draft-etag"`)
	if !errors.Is(err, ErrTranslationStale) {
		t.Fatalf("review err = %v", err)
	}
}

func TestGenerateProjectTranslationRouteSavesDraft(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{
		Title:     "Chinese Source Title",
		Summary:   "Chinese Source Summary",
		ContentMD: "Chinese body",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	generator := &stubProjectTranslationGenerator{
		generated: translation.GeneratedProjectTranslation{
			Title:          "English Title",
			Slug:           "english-title",
			Summary:        "English Summary",
			ContentMD:      "",
			SEOTitle:       "English SEO",
			SEODescription: "English SEO Description",
		},
	}

	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo, generator)

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/admin/projects/%d/translations/en/generate", project.ID), nil)
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	if generator.locale != i18n.LocaleEN {
		t.Fatalf("generator locale = %s", generator.locale)
	}
	if generator.source.Title != "Chinese Source Title" || generator.source.SourceSlug != project.Slug {
		t.Fatalf("generator source = %+v", generator.source)
	}

	var (
		title             string
		slug              string
		summary           string
		contentMD         string
		translationStatus string
	)
	err = repo.db.QueryRowContext(t.Context(), `
		SELECT title, slug, summary, content_md, translation_status
		FROM project_translations
		WHERE project_id = $1 AND locale = 'en'
	`, project.ID).Scan(&title, &slug, &summary, &contentMD, &translationStatus)
	if err != nil {
		t.Fatalf("load generated translation: %v", err)
	}
	if title != "English Title" || slug != "english-title" || summary != "English Summary" {
		t.Fatalf("generated translation = title:%q slug:%q summary:%q", title, slug, summary)
	}
	if contentMD != "" {
		t.Fatalf("content_md = %q, want empty string", contentMD)
	}
	if translationStatus != "ai_draft" {
		t.Fatalf("translation_status = %q", translationStatus)
	}
}

func TestSaveGeneratedProjectTranslationRejectsChangedLocaleRow(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Chinese Source Title", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	start, _, err := repo.LoadProjectTranslationGeneration(t.Context(), project.ID, i18n.LocaleEN)
	if err != nil {
		t.Fatalf("LoadProjectTranslationGeneration: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		VALUES ($1, 'en', 'ai_draft', 1, 'Existing', 'existing', 'Summary', '', now())
	`, project.ID); err != nil {
		t.Fatalf("seed translation: %v", err)
	}

	err = repo.SaveGeneratedProjectTranslation(t.Context(), project.ID, i18n.LocaleEN, start, translation.GeneratedProjectTranslation{
		Title:     "English Title",
		Slug:      "english-title",
		Summary:   "English Summary",
		ContentMD: "",
	})
	if !errors.Is(err, translation.ErrConflict) {
		t.Fatalf("SaveGeneratedProjectTranslation err = %v", err)
	}
}

func TestProjectAdminDetailIncludesTranslationState(t *testing.T) {
	repo := newContentRepo(t)
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	project, err := repo.CreateProject(t.Context(), ProjectInput{
		Title:     "Chinese Source Title",
		Summary:   "Chinese Source Summary",
		ContentMD: "Body",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, 'English Title', 'english-title', 'English Summary', '', now())
	`, project.ID); err != nil {
		t.Fatalf("seed translation: %v", err)
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/admin/projects/%d", project.ID), nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	translations, ok := body["translations"].(map[string]any)
	if !ok {
		t.Fatalf("translations = %#v", body["translations"])
	}
	en, ok := translations["en"].(map[string]any)
	if !ok {
		t.Fatalf("translations.en = %#v", translations["en"])
	}
	if en["exists"] != true || en["translation_status"] != "reviewed" {
		t.Fatalf("translations.en = %#v", en)
	}
	if _, ok := en["etag"].(string); !ok {
		t.Fatalf("translations.en.etag = %#v", en["etag"])
	}
	ja, ok := translations["ja"].(map[string]any)
	if !ok {
		t.Fatalf("translations.ja = %#v", translations["ja"])
	}
	if ja["exists"] != false || ja["translation_status"] != "empty" {
		t.Fatalf("translations.ja = %#v", ja)
	}
}

func TestSaveWritingTranslationUsesIfNoneMatchForFirstLocaleWrite(t *testing.T) {
	repo := newContentRepo(t)
	writing, err := repo.CreateWriting(t.Context(), WritingInput{Title: "Chinese Writing", ContentMD: "Body"})
	if err != nil {
		t.Fatalf("CreateWriting: %v", err)
	}
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	req := httptest.NewRequest(
		http.MethodPut,
		fmt.Sprintf("/api/admin/writing/%d/translations/en", writing.ID),
		bytes.NewBufferString(`{"title":"English Writing","slug":"english-writing","excerpt":"Summary","content_md":"","seo_title":"SEO","seo_description":"SEO Description"}`),
	)
	req.Header.Set("If-None-Match", "*")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestGenerateTalkTranslationRouteSavesDraft(t *testing.T) {
	repo := newContentRepo(t)
	talk, err := repo.CreateTalk(t.Context(), TalkInput{
		Title:     "Chinese Talk",
		Summary:   "Chinese Summary",
		EventName: "Chinese Event",
	})
	if err != nil {
		t.Fatalf("CreateTalk: %v", err)
	}
	generator := &stubContentTranslationGenerator{
		talk: translation.GeneratedTalkTranslation{
			Title:          "English Talk",
			Slug:           "english-talk",
			Summary:        "English Summary",
			EventName:      "English Event",
			SEOTitle:       "SEO",
			SEODescription: "SEO Description",
		},
	}
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo, generator)

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/admin/talks/%d/translations/en/generate", talk.ID), nil)
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var title, slug, summary, eventName, status string
	err = repo.db.QueryRowContext(t.Context(), `
		SELECT title, slug, summary, event_name, translation_status
		FROM talk_translations
		WHERE talk_id = $1 AND locale = 'en'
	`, talk.ID).Scan(&title, &slug, &summary, &eventName, &status)
	if err != nil {
		t.Fatalf("load generated translation: %v", err)
	}
	if title != "English Talk" || slug != "english-talk" || summary != "English Summary" || eventName != "English Event" {
		t.Fatalf("generated translation = title:%q slug:%q summary:%q event:%q", title, slug, summary, eventName)
	}
	if status != "ai_draft" {
		t.Fatalf("translation_status = %q", status)
	}
}

func TestExperienceAdminDetailIncludesTranslationState(t *testing.T) {
	repo := newContentRepo(t)
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	experience, err := repo.CreateExperience(t.Context(), ExperienceInput{
		Title:        "Chinese Experience",
		Organization: "Chinese Org",
		Description:  "Chinese Description",
		Period:       "2024",
	})
	if err != nil {
		t.Fatalf("CreateExperience: %v", err)
	}
	if _, err := repo.db.ExecContext(t.Context(), `
		INSERT INTO experience_translations
			(experience_id, locale, translation_status, source_version, period, title, organization, description, updated_at)
		VALUES ($1, 'en', 'reviewed', 1, '2024', 'English Experience', 'English Org', 'English Description', now())
	`, experience.ID); err != nil {
		t.Fatalf("seed translation: %v", err)
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/admin/experience/%d", experience.ID), nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	translations, ok := body["translations"].(map[string]any)
	if !ok {
		t.Fatalf("translations = %#v", body["translations"])
	}
	en, ok := translations["en"].(map[string]any)
	if !ok {
		t.Fatalf("translations.en = %#v", translations["en"])
	}
	if en["exists"] != true || en["translation_status"] != "reviewed" {
		t.Fatalf("translations.en = %#v", en)
	}
}

func TestWritingRejectsRawUploadsMarkdownReference(t *testing.T) {
	repo := newContentRepo(t)
	cases := map[string]string{
		"inline":      "![x](/uploads/a/b/card.jpg)",
		"inlineSpace": "![x]( /uploads/a.png)",
		"htmlDouble":  `<img src="/uploads/a.png">`,
		"htmlSingle":  `<img alt="x" src='/uploads/a.png'>`,
		"reference":   "![x][cover]\n\n[cover]: /uploads/a.png",
	}
	for name, contentMD := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := repo.CreateWriting(t.Context(), WritingInput{
				Title:     "Unsafe Markdown " + name,
				ContentMD: contentMD,
			})
			if !errors.Is(err, ErrUnsafeMarkdownMedia) {
				t.Fatalf("CreateWriting err = %v, want ErrUnsafeMarkdownMedia", err)
			}
		})
	}
}

func TestCreateWritingRouteMapsUnsafeMarkdownToValidationError(t *testing.T) {
	repo := newContentRepo(t)
	router := chi.NewRouter()
	RegisterAdminRoutes(router, repo)

	body := bytes.NewBufferString(`{"title":"Unsafe","content_md":"<img src=\"/uploads/a.png\">"}`)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/admin/writing", body))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
	var response struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error.Code != "validation_error" {
		t.Fatalf("error code = %q, want validation_error", response.Error.Code)
	}
}

func insertContentMediaAsset(t *testing.T, repo *Repository) int64 {
	t.Helper()
	var id int64
	err := repo.db.QueryRowContext(t.Context(), `INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now()) RETURNING id`,
		"cover.png",
		"content-test-cover-"+time.Now().Format("150405.000000000"),
		"image/png",
		10,
		1,
		1,
		`{}`,
		"content-test-checksum-"+time.Now().Format("150405.000000000"),
	).Scan(&id)
	if err != nil {
		t.Fatalf("insert media asset: %v", err)
	}
	return id
}

func contentTranslationSourceVersion(t *testing.T, repo *Repository, table string, id int64) int64 {
	t.Helper()
	var version int64
	query := fmt.Sprintf(`SELECT translation_source_version FROM %s WHERE id = $1`, table)
	if err := repo.db.QueryRowContext(t.Context(), query, id).Scan(&version); err != nil {
		t.Fatalf("load translation_source_version from %s: %v", table, err)
	}
	return version
}

type stubProjectTranslationGenerator struct {
	generated translation.GeneratedProjectTranslation
	err       error
	source    translation.ProjectTranslationSource
	locale    i18n.Locale
}

func (g *stubProjectTranslationGenerator) GenerateProject(_ context.Context, source translation.ProjectTranslationSource, locale i18n.Locale) (translation.GeneratedProjectTranslation, error) {
	g.source = source
	g.locale = locale
	if g.err != nil {
		return translation.GeneratedProjectTranslation{}, g.err
	}
	return g.generated, nil
}

func (g *stubProjectTranslationGenerator) GenerateWriting(_ context.Context, _ translation.WritingTranslationSource, _ i18n.Locale) (translation.GeneratedWritingTranslation, error) {
	return translation.GeneratedWritingTranslation{}, g.err
}

func (g *stubProjectTranslationGenerator) GenerateTalk(_ context.Context, _ translation.TalkTranslationSource, _ i18n.Locale) (translation.GeneratedTalkTranslation, error) {
	return translation.GeneratedTalkTranslation{}, g.err
}

func (g *stubProjectTranslationGenerator) GenerateExperience(_ context.Context, _ translation.ExperienceTranslationSource, _ i18n.Locale) (translation.GeneratedExperienceTranslation, error) {
	return translation.GeneratedExperienceTranslation{}, g.err
}

type stubContentTranslationGenerator struct {
	stubProjectTranslationGenerator
	writing          translation.GeneratedWritingTranslation
	writingSource    translation.WritingTranslationSource
	writingLocale    i18n.Locale
	talk             translation.GeneratedTalkTranslation
	talkSource       translation.TalkTranslationSource
	talkLocale       i18n.Locale
	experience       translation.GeneratedExperienceTranslation
	experienceSource translation.ExperienceTranslationSource
	experienceLocale i18n.Locale
}

func (g *stubContentTranslationGenerator) GenerateWriting(_ context.Context, source translation.WritingTranslationSource, locale i18n.Locale) (translation.GeneratedWritingTranslation, error) {
	g.writingSource = source
	g.writingLocale = locale
	return g.writing, nil
}

func (g *stubContentTranslationGenerator) GenerateTalk(_ context.Context, source translation.TalkTranslationSource, locale i18n.Locale) (translation.GeneratedTalkTranslation, error) {
	g.talkSource = source
	g.talkLocale = locale
	return g.talk, nil
}

func (g *stubContentTranslationGenerator) GenerateExperience(_ context.Context, source translation.ExperienceTranslationSource, locale i18n.Locale) (translation.GeneratedExperienceTranslation, error) {
	g.experienceSource = source
	g.experienceLocale = locale
	return g.experience, nil
}
