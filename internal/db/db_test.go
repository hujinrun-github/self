package db

import (
	"strings"
	"testing"
)

func TestOpenMigratesFreshSchemaOnStartup(t *testing.T) {
	databaseURL := openFreshPostgresDatabaseURL(t)

	database, err := Open(databaseURL)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})

	if !tableExists(t, databaseURL, "schema_migrations") {
		t.Fatal("Open should create schema_migrations")
	}
}

func TestOpenRedactsDatabaseURLDetailsFromErrors(t *testing.T) {
	_, err := Open("postgres://postgres:secret@localhost:5432/portfolio?sslmode=not-a-mode")
	if err == nil {
		t.Fatal("expected invalid database URL error")
	}

	got := err.Error()
	for _, leaked := range []string{"secret", "sslmode", "disable"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("Open leaked database URL detail %q in error: %s", leaked, got)
		}
	}
}
