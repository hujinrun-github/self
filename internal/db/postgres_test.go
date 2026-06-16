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
