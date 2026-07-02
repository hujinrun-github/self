package db

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPingDoesNotCreateSchemaMigrations(t *testing.T) {
	databaseURL := openFreshPostgresDatabaseURL(t)

	if err := Ping(context.Background(), databaseURL); err != nil {
		t.Fatalf("Ping returned error: %v", err)
	}

	if tableExists(t, databaseURL, "schema_migrations") {
		t.Fatal("Ping should not create schema_migrations")
	}
}

func openFreshPostgresDatabaseURL(t *testing.T) string {
	t.Helper()

	rawURL := testDatabaseURL(t)
	schema := uniqueSchema(t)

	admin, err := sql.Open("pgx", rawURL)
	if err != nil {
		t.Fatalf("open postgres admin connection: %v", err)
	}
	admin.SetMaxOpenConns(1)
	admin.SetMaxIdleConns(1)
	t.Cleanup(func() {
		if _, err := admin.Exec(`DROP SCHEMA IF EXISTS ` + schema + ` CASCADE`); err != nil {
			t.Errorf("drop schema %s: %v", schema, err)
		}
		if err := admin.Close(); err != nil {
			t.Errorf("close postgres admin connection: %v", err)
		}
	})

	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatalf("create schema %s: %v", schema, err)
	}

	return urlWithSearchPath(t, rawURL, schema)
}

func tableExists(t *testing.T, databaseURL string, table string) bool {
	t.Helper()

	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open postgres connection: %v", err)
	}
	defer func() {
		if err := database.Close(); err != nil {
			t.Errorf("close postgres connection: %v", err)
		}
	}()

	var count int
	if err := database.QueryRow(`
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = current_schema()
  AND table_name = $1
`, table).Scan(&count); err != nil {
		t.Fatalf("count table %s: %v", table, err)
	}

	return count == 1
}
