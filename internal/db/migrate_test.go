package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenRunsInitialMigration(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer database.Close()

	var profileID int
	if err := database.QueryRow(`SELECT id FROM profile`).Scan(&profileID); err != nil {
		t.Fatalf("query profile singleton: %v", err)
	}
	if profileID != 1 {
		t.Fatalf("profile id = %d", profileID)
	}

	if _, err := database.Exec(`INSERT INTO profile (id, name, headline, summary, bio, email, updated_at) VALUES (2, '', '', '', '', '', CURRENT_TIMESTAMP)`); err == nil {
		t.Fatal("expected profile singleton check to reject id 2")
	}

	requireIndex(t, database, "experiences", "idx_experiences_public_order")
	requireIndex(t, database, "talks", "idx_talks_public_order")
	requireIndex(t, database, "talks", "idx_talks_featured_order")
	requireIndex(t, database, "writings", "idx_writings_public_order")
	requireIndex(t, database, "writings", "idx_writings_featured_order")
	requireIndex(t, database, "projects", "idx_projects_public_order")
	requireIndex(t, database, "projects", "idx_projects_featured_order")
	requireIndex(t, database, "writing_tags", "idx_writing_tags_tag_id")
	requireIndex(t, database, "project_tech", "idx_project_tech_tech_id")
	requireIndex(t, database, "social_links", "idx_social_links_profile_sort")
	requireIndex(t, database, "media_references", "idx_media_references_asset_id")
	requireIndex(t, database, "sessions", "idx_sessions_admin_expires")

	var foreignKeys int
	if err := database.QueryRow(`PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		t.Fatalf("PRAGMA foreign_keys: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("foreign_keys = %d", foreignKeys)
	}
}

func TestInitialMigrationEnforcesUniqueSessionAndMediaKeys(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "portfolio.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer database.Close()

	_, err = database.Exec(`INSERT INTO admins (email, password_hash, created_at, updated_at) VALUES ('admin@example.com', 'hash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
	if err != nil {
		t.Fatalf("insert admin: %v", err)
	}

	_, err = database.Exec(`INSERT INTO sessions (admin_id, session_token_hash, csrf_token_hash, created_at, last_seen_at, expires_at) VALUES (1, 'same-session-hash', 'csrf-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO sessions (admin_id, session_token_hash, csrf_token_hash, created_at, last_seen_at, expires_at) VALUES (1, 'same-session-hash', 'csrf-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err == nil {
		t.Fatal("expected duplicate session_token_hash to fail")
	}

	_, err = database.Exec(`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants_json, checksum_sha256, created_at) VALUES ('a.png', 'same-key', 'image/png', 10, 1, 1, '{}', 'sum-1', CURRENT_TIMESTAMP)`)
	if err != nil {
		t.Fatalf("insert media asset: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO media_assets (file_name, storage_key, mime_type, size_bytes, width, height, variants_json, checksum_sha256, created_at) VALUES ('b.png', 'same-key', 'image/png', 10, 1, 1, '{}', 'sum-2', CURRENT_TIMESTAMP)`); err == nil {
		t.Fatal("expected duplicate storage_key to fail")
	}
}

func requireIndex(t *testing.T, db *sql.DB, table string, name string) {
	t.Helper()
	rows, err := db.Query(`PRAGMA index_list(` + table + `)`)
	if err != nil {
		t.Fatalf("index_list(%s): %v", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var seq int
		var idxName string
		var unique int
		var origin string
		var partial int
		if err := rows.Scan(&seq, &idxName, &unique, &origin, &partial); err != nil {
			t.Fatalf("scan index: %v", err)
		}
		if idxName == name {
			return
		}
	}
	t.Fatalf("missing index %s on %s", name, table)
}
