package db

import (
	"database/sql"
	"testing"
)

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

func TestMigrationCreatesTranslationTablesAndConstraints(t *testing.T) {
	database, _ := openTestPostgres(t)

	for _, table := range []string{
		"profile_translations",
		"social_link_translations",
		"experience_translations",
		"project_translations",
		"writing_translations",
		"talk_translations",
	} {
		assertTableExists(t, database, table)
	}

	for _, table := range []string{
		"profile",
		"social_links",
		"experiences",
		"projects",
		"writings",
		"talks",
	} {
		assertColumnExists(t, database, table, "translation_source_version")
	}

	constraints := map[string][]string{
		"profile_translations":     {"UNIQUE (profile_id, locale)"},
		"social_link_translations": {"UNIQUE (social_link_id, locale)"},
		"experience_translations":  {"UNIQUE (experience_id, locale)"},
		"project_translations":     {"UNIQUE (project_id, locale)", "UNIQUE (locale, slug)"},
		"writing_translations":     {"UNIQUE (writing_id, locale)", "UNIQUE (locale, slug)"},
		"talk_translations":        {"UNIQUE (talk_id, locale)", "UNIQUE (locale, slug)"},
	}

	for table, defs := range constraints {
		for _, def := range defs {
			assertUniqueConstraintExists(t, database, table, def)
		}
	}
}

func TestPostgresMigrationCreatesWritingImportSchema(t *testing.T) {
	database := openUnmigratedPostgres(t)
	applyMigrationByVersion(t, database, "001_initial")
	applyMigrationByVersion(t, database, "002_multilingual")

	assertCheckConstraintDefinition(t, database, "media_assets", "media_assets_width_check", "CHECK ((width > 0))")
	assertCheckConstraintDefinition(t, database, "media_assets", "media_assets_height_check", "CHECK ((height > 0))")

	if _, err := database.Exec(`
ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_width_nullable_future_check CHECK ((width > 0) OR width IS NULL),
  ADD CONSTRAINT media_assets_height_nullable_future_check CHECK ((height > 0) OR height IS NULL)
`); err != nil {
		t.Fatalf("add future-compatible dimension checks: %v", err)
	}

	applyMigrationByVersion(t, database, "003_writing_import")

	for _, column := range []string{"storage_backend", "lifecycle_state", "media_kind"} {
		assertColumnExists(t, database, "media_assets", column)
	}

	for _, column := range []string{"width", "height"} {
		var nullable bool
		if err := database.QueryRow(`
SELECT is_nullable = 'YES'
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name = 'media_assets'
  AND column_name = $1
`, column).Scan(&nullable); err != nil {
			t.Fatalf("query nullable column media_assets.%s: %v", column, err)
		}
		if !nullable {
			t.Fatalf("media_assets.%s should be nullable after migration", column)
		}
	}

	assertCheckConstraintMissing(t, database, "media_assets", "media_assets_width_check")
	assertCheckConstraintMissing(t, database, "media_assets", "media_assets_height_check")
	assertCheckConstraintExists(t, database, "media_assets", "media_assets_kind_dimensions_check")
	assertCheckConstraintExists(t, database, "media_assets", "media_assets_width_nullable_future_check")
	assertCheckConstraintExists(t, database, "media_assets", "media_assets_height_nullable_future_check")
	assertCheckConstraintExists(t, database, "media_assets", "media_assets_size_bytes_check")

	if _, err := database.Exec(`
INSERT INTO media_assets (
	file_name,
	storage_key,
	mime_type,
	size_bytes,
	width,
	height,
	variants,
	checksum_sha256,
	created_at,
	storage_backend,
	lifecycle_state,
	media_kind
) VALUES ($1, $2, $3, $4, NULL, NULL, $5::jsonb, $6, now(), 'minio', 'pending_import', 'audio')
`, "draft-audio.mp3", "draft-audio", "audio/mpeg", 3, `{}`, "sum-audio-1"); err != nil {
		t.Fatalf("insert pending audio media asset: %v", err)
	}

	if _, err := database.Exec(`
INSERT INTO media_assets (
	file_name,
	storage_key,
	mime_type,
	size_bytes,
	width,
	height,
	variants,
	checksum_sha256,
	created_at,
	storage_backend,
	lifecycle_state,
	media_kind
) VALUES ($1, $2, $3, $4, NULL, NULL, $5::jsonb, $6, now(), 'local', 'active', 'image')
`, "broken-image.png", "broken-image", "image/png", 3, `{}`, "sum-image-1"); err == nil {
		t.Fatal("expected image media asset without dimensions to fail")
	}

	for _, table := range []string{"writing_import_sessions", "writing_import_session_assets"} {
		assertTableExists(t, database, table)
	}

	assertIndexExists(t, database, "writing_import_sessions_expires_at_idx")
	assertIndexExists(t, database, "writing_import_sessions_admin_session_id_idx")
	assertIndexExists(t, database, "writing_import_session_assets_session_id_idx")
	assertIndexExists(t, database, "writing_import_session_assets_media_asset_id_idx")
}

func assertTableExists(t *testing.T, database *sql.DB, table string) {
	t.Helper()

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`, table).Scan(&count); err != nil {
		t.Fatalf("count table %s: %v", table, err)
	}
	if count != 1 {
		t.Fatalf("missing table %s", table)
	}
}

func assertColumnExists(t *testing.T, database *sql.DB, table string, column string) {
	t.Helper()

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`, table, column).Scan(&count); err != nil {
		t.Fatalf("count column %s.%s: %v", table, column, err)
	}
	if count != 1 {
		t.Fatalf("missing column %s.%s", table, column)
	}
}

func assertUniqueConstraintExists(t *testing.T, database *sql.DB, table string, definition string) {
	t.Helper()

	var count int
	if err := database.QueryRow(`
		SELECT COUNT(*)
		FROM pg_constraint constraints
		JOIN pg_class relation ON relation.oid = constraints.conrelid
		JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
		WHERE namespace.nspname = current_schema()
		  AND relation.relname = $1
		  AND constraints.contype = 'u'
		  AND pg_get_constraintdef(constraints.oid) = $2
	`, table, definition).Scan(&count); err != nil {
		t.Fatalf("count unique constraint %s on %s: %v", definition, table, err)
	}
	if count != 1 {
		t.Fatalf("missing unique constraint %s on %s", definition, table)
	}
}

func assertCheckConstraintExists(t *testing.T, database *sql.DB, table string, name string) {
	t.Helper()

	var count int
	if err := database.QueryRow(`
		SELECT COUNT(*)
		FROM pg_constraint constraints
		JOIN pg_class relation ON relation.oid = constraints.conrelid
		JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
		WHERE namespace.nspname = current_schema()
		  AND relation.relname = $1
		  AND constraints.contype = 'c'
		  AND constraints.conname = $2
	`, table, name).Scan(&count); err != nil {
		t.Fatalf("count check constraint %s on %s: %v", name, table, err)
	}
	if count != 1 {
		t.Fatalf("missing check constraint %s on %s", name, table)
	}
}

func assertCheckConstraintMissing(t *testing.T, database *sql.DB, table string, name string) {
	t.Helper()

	var count int
	if err := database.QueryRow(`
		SELECT COUNT(*)
		FROM pg_constraint constraints
		JOIN pg_class relation ON relation.oid = constraints.conrelid
		JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
		WHERE namespace.nspname = current_schema()
		  AND relation.relname = $1
		  AND constraints.contype = 'c'
		  AND constraints.conname = $2
	`, table, name).Scan(&count); err != nil {
		t.Fatalf("count missing check constraint %s on %s: %v", name, table, err)
	}
	if count != 0 {
		t.Fatalf("expected check constraint %s on %s to be removed", name, table)
	}
}

func assertCheckConstraintDefinition(t *testing.T, database *sql.DB, table string, name string, definition string) {
	t.Helper()

	var count int
	if err := database.QueryRow(`
		SELECT COUNT(*)
		FROM pg_constraint constraints
		JOIN pg_class relation ON relation.oid = constraints.conrelid
		JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
		WHERE namespace.nspname = current_schema()
		  AND relation.relname = $1
		  AND constraints.contype = 'c'
		  AND constraints.conname = $2
		  AND pg_get_constraintdef(constraints.oid) = $3
	`, table, name, definition).Scan(&count); err != nil {
		t.Fatalf("count check constraint %s on %s with definition %s: %v", name, table, definition, err)
	}
	if count != 1 {
		t.Fatalf("missing check constraint %s on %s with definition %s", name, table, definition)
	}
}

func assertIndexExists(t *testing.T, database *sql.DB, name string) {
	t.Helper()

	var count int
	if err := database.QueryRow(`
		SELECT COUNT(*)
		FROM pg_indexes
		WHERE schemaname = current_schema()
		  AND indexname = $1
	`, name).Scan(&count); err != nil {
		t.Fatalf("count index %s: %v", name, err)
	}
	if count != 1 {
		t.Fatalf("missing index %s", name)
	}
}

func openUnmigratedPostgres(t *testing.T) *sql.DB {
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

	database, err := sql.Open("pgx", urlWithSearchPath(t, rawURL, schema))
	if err != nil {
		t.Fatalf("open schema-scoped postgres connection: %v", err)
	}
	database.SetMaxOpenConns(2)
	database.SetMaxIdleConns(1)
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("close schema-scoped postgres connection: %v", err)
		}
	})

	return database
}

func applyMigrationByVersion(t *testing.T, database *sql.DB, version string) {
	t.Helper()

	sqlBytes, err := migrationFiles.ReadFile("migrations/" + version + ".sql")
	if err != nil {
		t.Fatalf("read migration %s: %v", version, err)
	}
	statements, err := splitSQLStatements(string(sqlBytes))
	if err != nil {
		t.Fatalf("split migration %s: %v", version, err)
	}
	for _, statement := range statements {
		if _, err := database.Exec(statement); err != nil {
			t.Fatalf("apply migration %s: %v", version, err)
		}
	}
}
