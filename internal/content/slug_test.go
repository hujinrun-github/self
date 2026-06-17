package content

import (
	"strings"
	"testing"

	dbtest "portfolio/internal/testutil/postgres"
)

func TestSlugifyNormalizesASCIIText(t *testing.T) {
	cases := map[string]string{
		"Hello, World!":     "hello-world",
		"Developer's Notes": "developers-notes",
		"  AI   Workflow  ": "ai-workflow",
	}
	for input, want := range cases {
		t.Run(input, func(t *testing.T) {
			got, err := Slugify(input)
			if err != nil {
				t.Fatalf("Slugify returned error: %v", err)
			}
			if got != want {
				t.Fatalf("Slugify(%q) = %q, want %q", input, got, want)
			}
		})
	}
}

func TestSlugifyRejectsReservedEmptyAndLongSlugs(t *testing.T) {
	if _, err := Slugify("admin"); err == nil {
		t.Fatal("expected reserved slug error")
	}
	if _, err := Slugify("中文"); err == nil {
		t.Fatal("expected empty normalized slug error")
	}
	long := strings.Repeat("a", 81)
	if _, err := Slugify(long); err == nil {
		t.Fatal("expected max length error")
	}
}

func TestDuplicateDraftSlugReceivesSuffix(t *testing.T) {
	repo := newContentRepo(t)
	first, err := repo.CreateProject(t.Context(), ProjectInput{Title: "AI Workflow"})
	if err != nil {
		t.Fatalf("CreateProject first: %v", err)
	}
	second, err := repo.CreateProject(t.Context(), ProjectInput{Title: "AI Workflow"})
	if err != nil {
		t.Fatalf("CreateProject second: %v", err)
	}
	if first.Slug != "ai-workflow" || second.Slug != "ai-workflow-2" {
		t.Fatalf("slugs = %q, %q", first.Slug, second.Slug)
	}
}

func TestPublishedSlugIsImmutable(t *testing.T) {
	repo := newContentRepo(t)
	project, err := repo.CreateProject(t.Context(), ProjectInput{Title: "Original Project"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if err := repo.SetProjectStatus(t.Context(), project.ID, StatusPublished, nil); err != nil {
		t.Fatalf("publish project: %v", err)
	}
	_, err = repo.UpdateProject(t.Context(), project.ID, ProjectInput{Title: "Renamed Project", Slug: "renamed-project"})
	if err == nil {
		t.Fatal("expected immutable slug error")
	}
}

func newContentRepo(t *testing.T) *Repository {
	t.Helper()
	database, _ := dbtest.OpenPostgres(t)
	return NewRepository(database)
}
