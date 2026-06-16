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
