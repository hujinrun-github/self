package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"strings"
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

func TestPingPreservesUnderlyingContextError(t *testing.T) {
	databaseURL := openFreshPostgresDatabaseURL(t)
	database, err := openDatabase(databaseURL)
	if err != nil {
		t.Fatalf("openDatabase: %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close database: %v", err)
		}
	})

	if err := pingDatabase(context.Background(), database); err != nil {
		t.Fatalf("warm pingDatabase: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err = pingDatabase(ctx, database)
	if err == nil {
		t.Fatal("expected pingDatabase to fail with canceled context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("pingDatabase error = %v, want wrapped context.Canceled", err)
	}
	if !strings.Contains(err.Error(), "ping postgres:") {
		t.Fatalf("pingDatabase error = %q, want ping prefix", err.Error())
	}
}

func TestPingRedactsOrdinaryConnectionFailures(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}

	databaseURL := fmt.Sprintf("postgres://appuser:secret@%s/portfolio?sslmode=disable", addr)

	err = Ping(context.Background(), databaseURL)
	if err == nil {
		t.Fatal("expected Ping to fail against a closed port")
	}
	if got := err.Error(); got != "ping postgres: connection failed" {
		t.Fatalf("Ping error = %q, want %q", got, "ping postgres: connection failed")
	}
	for _, leaked := range []string{"appuser", "secret", "portfolio", "127.0.0.1", addr} {
		if strings.Contains(err.Error(), leaked) {
			t.Fatalf("Ping leaked connection detail %q in error: %s", leaked, err)
		}
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
