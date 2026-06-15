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
