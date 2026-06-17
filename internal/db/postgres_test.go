package db

import "testing"

func TestPostgresMigrationCreatesProfileSingleton(t *testing.T) {
	database, _ := openTestPostgres(t)

	var profileID int64
	if err := database.QueryRow(`SELECT id FROM profile`).Scan(&profileID); err != nil {
		t.Fatalf("query profile singleton: %v", err)
	}
	if profileID != 1 {
		t.Fatalf("profile id = %d, want 1", profileID)
	}
}

func TestMigrateIsIdempotent(t *testing.T) {
	database, _ := openTestPostgres(t)

	if err := Migrate(database); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = $1`, "001_initial").Scan(&count); err != nil {
		t.Fatalf("count migrations: %v", err)
	}
	if count != 1 {
		t.Fatalf("migration count = %d, want 1", count)
	}
}

func TestPostgresSchemaInvariants(t *testing.T) {
	database, _ := openTestPostgres(t)

	if _, err := database.Exec(`INSERT INTO profile (id, updated_at) VALUES ($1, now())`, 2); err == nil {
		t.Fatal("expected profile singleton check to reject id 2")
	}

	if _, err := database.Exec(`INSERT INTO projects (title, slug, status, featured, sort_order, created_at, updated_at) VALUES ($1, $2, 'published', false, 10, now(), now())`, "No Date", "no-date"); err == nil {
		t.Fatal("expected published project without published_at to fail")
	}

	_, err := database.Exec(`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())`, "a.png", "same-key", "image/png", 10, 1, 1, `{}`, "sum-1")
	if err != nil {
		t.Fatalf("insert media asset: %v", err)
	}

	if _, err := database.Exec(`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())`, "b.png", "same-key", "image/png", 10, 1, 1, `{}`, "sum-2"); err == nil {
		t.Fatal("expected duplicate storage_key to fail")
	}
}
