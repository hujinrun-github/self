package site

import (
	"path/filepath"
	"strconv"
	"testing"
	"time"

	appdb "portfolio/internal/db"
)

func TestHomeBackfillsFeaturedWithRecentPublishedContent(t *testing.T) {
	database, err := appdb.Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := NewHomeRepository(database, func() time.Time { return now })
	seedHomeRows(t, repo, now)

	home, err := repo.GetHome(t.Context())
	if err != nil {
		t.Fatalf("GetHome: %v", err)
	}
	if len(home.Experiences) != 4 {
		t.Fatalf("experiences = %d", len(home.Experiences))
	}
	if len(home.Talks) != 4 {
		t.Fatalf("talks = %d", len(home.Talks))
	}
	if len(home.Writing) != 5 {
		t.Fatalf("writing = %d", len(home.Writing))
	}
	if len(home.Projects) != 4 {
		t.Fatalf("projects = %d", len(home.Projects))
	}
	if !home.Talks[0].Featured || !home.Writing[0].Featured || !home.Projects[0].Featured {
		t.Fatalf("featured content was not prioritized: %+v %+v %+v", home.Talks[0], home.Writing[0], home.Projects[0])
	}
	seen := map[int64]bool{}
	for _, project := range home.Projects {
		if seen[project.ID] {
			t.Fatalf("duplicate project id %d", project.ID)
		}
		seen[project.ID] = true
	}
}

func TestHomeReturnsEmptyArrays(t *testing.T) {
	database, err := appdb.Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	repo := NewHomeRepository(database, func() time.Time { return time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC) })
	home, err := repo.GetHome(t.Context())
	if err != nil {
		t.Fatalf("GetHome: %v", err)
	}
	if home.Experiences == nil || home.Talks == nil || home.Writing == nil || home.Projects == nil {
		t.Fatalf("expected empty arrays, got %+v", home)
	}
}

func seedHomeRows(t *testing.T, repo *HomeRepository, now time.Time) {
	t.Helper()
	for i := 1; i <= 6; i++ {
		_, err := repo.db.Exec(`INSERT INTO experiences (period, title, organization, description, status, sort_order, published_at, created_at, updated_at) VALUES (?, ?, '', '', 'published', ?, ?, ?, ?)`,
			"2026",
			"Experience",
			i*10,
			now.Add(-time.Duration(i)*time.Hour).Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
		)
		if err != nil {
			t.Fatalf("seed experience: %v", err)
		}
	}
	for i := 1; i <= 6; i++ {
		featured := 0
		if i == 3 {
			featured = 1
		}
		_, err := repo.db.Exec(`INSERT INTO talks (title, slug, summary, status, featured, sort_order, published_at, created_at, updated_at) VALUES (?, ?, '', 'published', ?, ?, ?, ?, ?)`,
			"Talk",
			"talk-"+strconv.Itoa(i),
			featured,
			i*10,
			now.Add(-time.Duration(i)*time.Hour).Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
		)
		if err != nil {
			t.Fatalf("seed talk: %v", err)
		}
	}
	for i := 1; i <= 7; i++ {
		featured := 0
		if i == 4 {
			featured = 1
		}
		_, err := repo.db.Exec(`INSERT INTO writings (title, slug, excerpt, content_md, status, featured, sort_order, published_at, created_at, updated_at) VALUES (?, ?, '', '', 'published', ?, ?, ?, ?, ?)`,
			"Writing",
			"writing-"+strconv.Itoa(i),
			featured,
			i*10,
			now.Add(-time.Duration(i)*time.Hour).Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
		)
		if err != nil {
			t.Fatalf("seed writing: %v", err)
		}
	}
	for i := 1; i <= 6; i++ {
		featured := 0
		if i == 2 {
			featured = 1
		}
		_, err := repo.db.Exec(`INSERT INTO projects (title, slug, summary, content_md, status, featured, sort_order, published_at, created_at, updated_at) VALUES (?, ?, '', '', 'published', ?, ?, ?, ?, ?)`,
			"Project",
			"project-"+strconv.Itoa(i),
			featured,
			i*10,
			now.Add(-time.Duration(i)*time.Hour).Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
			now.Format(time.RFC3339Nano),
		)
		if err != nil {
			t.Fatalf("seed project: %v", err)
		}
	}
	_, err := repo.db.Exec(`INSERT INTO projects (title, slug, summary, content_md, status, featured, sort_order, published_at, created_at, updated_at) VALUES ('Future', 'future', '', '', 'published', 1, 1, ?, ?, ?)`,
		now.Add(24*time.Hour).Format(time.RFC3339Nano),
		now.Format(time.RFC3339Nano),
		now.Format(time.RFC3339Nano),
	)
	if err != nil {
		t.Fatalf("seed future project: %v", err)
	}
}
