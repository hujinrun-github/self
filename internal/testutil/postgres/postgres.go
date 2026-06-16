package postgres

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	appdb "portfolio/internal/db"
)

func OpenPostgres(t *testing.T) (*sql.DB, string) {
	t.Helper()

	rawURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if rawURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	schema := uniqueSchema(t)
	admin, err := sql.Open("pgx", rawURL)
	if err != nil {
		t.Fatalf("open postgres admin connection: %v", err)
	}
	admin.SetMaxOpenConns(1)
	admin.SetMaxIdleConns(1)
	admin.SetConnMaxLifetime(time.Minute)
	t.Cleanup(func() {
		if err := admin.Close(); err != nil {
			t.Errorf("close postgres admin connection: %v", err)
		}
	})

	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatalf("create schema %s: %v", schema, err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(`DROP SCHEMA IF EXISTS ` + schema + ` CASCADE`); err != nil {
			t.Errorf("drop schema %s: %v", schema, err)
		}
	})

	database, err := appdb.Open(urlWithSearchPath(t, rawURL, schema))
	if err != nil {
		t.Fatalf("open schema-scoped postgres connection: %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close schema-scoped postgres connection: %v", err)
		}
	})

	return database, schema
}

func uniqueSchema(t *testing.T) string {
	t.Helper()

	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		t.Fatalf("generate schema suffix: %v", err)
	}
	return "test_" + hex.EncodeToString(suffix[:])
}

func urlWithSearchPath(t *testing.T, rawURL, schema string) string {
	t.Helper()

	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}

	query := parsed.Query()
	query.Set("options", fmt.Sprintf("-c search_path=%s,public -c timezone=UTC", schema))
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
