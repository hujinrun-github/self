package db

import (
	"testing"
	"time"
)

func TestEngagementMigrationPreservesHistoricalLikesAndPublishedComments(t *testing.T) {
	database := openUnmigratedPostgres(t)
	for _, version := range []string{"001_initial", "002_multilingual", "003_writing_import", "004_experience_tech", "005_writing_engagement"} {
		applyMigrationByVersion(t, database, version)
		if _, err := database.Exec(`INSERT INTO schema_migrations(version) VALUES($1)`, version); err != nil {
			t.Fatal(err)
		}
	}
	var id int64
	if err := database.QueryRow(`INSERT INTO writings(title,slug,created_at,updated_at) VALUES('Legacy','legacy',now(),now()) RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO writing_likes(writing_id,like_count) VALUES($1,42)`, id); err != nil {
		t.Fatal(err)
	}
	created := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if _, err := database.Exec(`INSERT INTO writing_comments(writing_id,author_name,author_email,body,created_at) VALUES($1,'Legacy reader','legacy@example.test','Original comment',$2)`, id, created); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(database); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("idempotent migrate: %v", err)
	}
	var likes int
	if err := database.QueryRow(`SELECT like_count FROM writing_likes WHERE writing_id=$1`, id).Scan(&likes); err != nil || likes != 42 {
		t.Fatalf("likes=%d err=%v", likes, err)
	}
	var status, email, body string
	var updated time.Time
	if err := database.QueryRow(`SELECT status,author_email,body,updated_at FROM writing_comments WHERE writing_id=$1`, id).Scan(&status, &email, &body, &updated); err != nil {
		t.Fatal(err)
	}
	if status != "published" || email != "legacy@example.test" || body != "Original comment" || !updated.Equal(created) {
		t.Fatalf("legacy data changed: status=%s body=%s timestamp=%v", status, body, updated)
	}
	if err := database.QueryRow(`INSERT INTO writing_comments(writing_id,author_name,body,created_at) VALUES($1,'New reader','Needs review',now()) RETURNING status`, id).Scan(&status); err != nil || status != "pending" {
		t.Fatalf("new default=%s err=%v", status, err)
	}
	assertTableExists(t, database, "writing_visitor_likes")
	assertTableExists(t, database, "writing_visitors")
}
