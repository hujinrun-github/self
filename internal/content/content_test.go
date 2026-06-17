package content

import (
	"errors"
	"testing"
	"time"
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

func TestConcurrentProjectCreateAllocatesUniqueSlugAndSortOrder(t *testing.T) {
	repo := newContentRepo(t)
	errs := make(chan error, 2)
	projects := make(chan Project, 2)
	for i := 0; i < 2; i++ {
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
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("CreateProject concurrent: %v", err)
		}
	}
	first := <-projects
	second := <-projects
	if first.Slug == second.Slug {
		t.Fatalf("duplicate slug: first=%+v second=%+v", first, second)
	}
	if first.SortOrder == second.SortOrder {
		t.Fatalf("duplicate sort_order: first=%+v second=%+v", first, second)
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

func TestWritingRejectsRawUploadsMarkdownReference(t *testing.T) {
	repo := newContentRepo(t)
	_, err := repo.CreateWriting(t.Context(), WritingInput{
		Title:     "Unsafe Markdown",
		ContentMD: "![x](/uploads/a/b/card.jpg)",
	})
	if !errors.Is(err, ErrUnsafeMarkdownMedia) {
		t.Fatalf("CreateWriting err = %v, want ErrUnsafeMarkdownMedia", err)
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
