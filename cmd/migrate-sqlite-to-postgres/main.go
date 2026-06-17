package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	appdb "portfolio/internal/db"
	"portfolio/internal/storage"

	_ "modernc.org/sqlite"
)

type config struct {
	SQLitePath  string
	PostgresURL string
}

type tableImporter struct {
	name      string
	selectSQL string
	insertSQL string
	buildArgs func(*sourceRow) ([]any, error)
}

var importTables = []string{
	"admins",
	"media_assets",
	"profile",
	"social_links",
	"experiences",
	"talks",
	"writings",
	"tags",
	"writing_tags",
	"projects",
	"techs",
	"project_tech",
	"media_references",
}

var identityTables = []string{
	"admins",
	"media_assets",
	"social_links",
	"experiences",
	"talks",
	"writings",
	"tags",
	"writing_tags",
	"projects",
	"techs",
	"project_tech",
	"media_references",
}

var tableImporters = []tableImporter{
	{
		name:      "admins",
		selectSQL: `SELECT id, email, password_hash, created_at, updated_at FROM admins ORDER BY id`,
		insertSQL: `INSERT INTO admins (id, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("email"),
				row.string("password_hash"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "media_assets",
		selectSQL: `SELECT id, file_name, storage_key, mime_type, size_bytes, width, height, variants_json, checksum_sha256, created_at FROM media_assets ORDER BY id`,
		insertSQL: `INSERT INTO media_assets (id, file_name, storage_key, mime_type, size_bytes, width, height, variants, checksum_sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("file_name"),
				row.string("storage_key"),
				row.string("mime_type"),
				row.int64("size_bytes"),
				row.int32("width"),
				row.int32("height"),
				row.string("variants_json"),
				row.string("checksum_sha256"),
				row.time("created_at"),
			}, row.err()
		},
	},
	{
		name:      "profile",
		selectSQL: `SELECT id, name, headline, summary, bio, avatar_media_id, email, seo_title, seo_description, og_image_media_id, updated_at FROM profile ORDER BY id`,
		insertSQL: `INSERT INTO profile (id, name, headline, summary, bio, avatar_media_id, email, seo_title, seo_description, og_image_media_id, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				headline = EXCLUDED.headline,
				summary = EXCLUDED.summary,
				bio = EXCLUDED.bio,
				avatar_media_id = EXCLUDED.avatar_media_id,
				email = EXCLUDED.email,
				seo_title = EXCLUDED.seo_title,
				seo_description = EXCLUDED.seo_description,
				og_image_media_id = EXCLUDED.og_image_media_id,
				updated_at = EXCLUDED.updated_at`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("name"),
				row.string("headline"),
				row.string("summary"),
				row.string("bio"),
				row.nullableInt64("avatar_media_id"),
				row.string("email"),
				row.string("seo_title"),
				row.string("seo_description"),
				row.nullableInt64("og_image_media_id"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "social_links",
		selectSQL: `SELECT id, profile_id, label, url, icon, sort_order, created_at, updated_at FROM social_links ORDER BY id`,
		insertSQL: `INSERT INTO social_links (id, profile_id, label, url, icon, sort_order, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.int64("profile_id"),
				row.string("label"),
				row.string("url"),
				row.string("icon"),
				row.int32("sort_order"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "experiences",
		selectSQL: `SELECT id, period, title, organization, description, status, sort_order, published_at, created_at, updated_at FROM experiences ORDER BY id`,
		insertSQL: `INSERT INTO experiences (id, period, title, organization, description, status, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("period"),
				row.string("title"),
				row.string("organization"),
				row.string("description"),
				row.string("status"),
				row.int32("sort_order"),
				row.nullableTime("published_at"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "talks",
		selectSQL: `SELECT id, title, slug, summary, cover_media_id, event_name, video_url, duration_minutes, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at FROM talks ORDER BY id`,
		insertSQL: `INSERT INTO talks (id, title, slug, summary, cover_media_id, event_name, video_url, duration_minutes, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("title"),
				row.string("slug"),
				row.string("summary"),
				row.nullableInt64("cover_media_id"),
				row.string("event_name"),
				row.string("video_url"),
				row.nullableInt32("duration_minutes"),
				row.string("seo_title"),
				row.string("seo_description"),
				row.nullableInt64("og_image_media_id"),
				row.string("status"),
				row.bool("featured"),
				row.int32("sort_order"),
				row.nullableTime("published_at"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "writings",
		selectSQL: `SELECT id, title, slug, excerpt, content_md, cover_media_id, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at FROM writings ORDER BY id`,
		insertSQL: `INSERT INTO writings (id, title, slug, excerpt, content_md, cover_media_id, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("title"),
				row.string("slug"),
				row.string("excerpt"),
				row.string("content_md"),
				row.nullableInt64("cover_media_id"),
				row.string("seo_title"),
				row.string("seo_description"),
				row.nullableInt64("og_image_media_id"),
				row.string("status"),
				row.bool("featured"),
				row.int32("sort_order"),
				row.nullableTime("published_at"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "tags",
		selectSQL: `SELECT id, name, slug, created_at, updated_at FROM tags ORDER BY id`,
		insertSQL: `INSERT INTO tags (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("name"),
				row.string("slug"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "writing_tags",
		selectSQL: `SELECT id, writing_id, tag_id, sort_order FROM writing_tags ORDER BY id`,
		insertSQL: `INSERT INTO writing_tags (id, writing_id, tag_id, sort_order) VALUES ($1, $2, $3, $4)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.int64("writing_id"),
				row.int64("tag_id"),
				row.int32("sort_order"),
			}, row.err()
		},
	},
	{
		name:      "projects",
		selectSQL: `SELECT id, title, slug, summary, content_md, cover_media_id, demo_url, repo_url, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at FROM projects ORDER BY id`,
		insertSQL: `INSERT INTO projects (id, title, slug, summary, content_md, cover_media_id, demo_url, repo_url, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("title"),
				row.string("slug"),
				row.string("summary"),
				row.string("content_md"),
				row.nullableInt64("cover_media_id"),
				row.string("demo_url"),
				row.string("repo_url"),
				row.string("seo_title"),
				row.string("seo_description"),
				row.nullableInt64("og_image_media_id"),
				row.string("status"),
				row.bool("featured"),
				row.int32("sort_order"),
				row.nullableTime("published_at"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "techs",
		selectSQL: `SELECT id, name, slug, created_at, updated_at FROM techs ORDER BY id`,
		insertSQL: `INSERT INTO techs (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.string("name"),
				row.string("slug"),
				row.time("created_at"),
				row.time("updated_at"),
			}, row.err()
		},
	},
	{
		name:      "project_tech",
		selectSQL: `SELECT id, project_id, tech_id, sort_order FROM project_tech ORDER BY id`,
		insertSQL: `INSERT INTO project_tech (id, project_id, tech_id, sort_order) VALUES ($1, $2, $3, $4)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.int64("project_id"),
				row.int64("tech_id"),
				row.int32("sort_order"),
			}, row.err()
		},
	},
	{
		name:      "media_references",
		selectSQL: `SELECT id, media_asset_id, resource_type, resource_id, source, created_at FROM media_references ORDER BY id`,
		insertSQL: `INSERT INTO media_references (id, media_asset_id, resource_type, resource_id, source, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		buildArgs: func(row *sourceRow) ([]any, error) {
			return []any{
				row.int64("id"),
				row.int64("media_asset_id"),
				row.string("resource_type"),
				row.int64("resource_id"),
				row.string("source"),
				row.time("created_at"),
			}, row.err()
		},
	},
}

type sourceRow struct {
	values map[string]any
	failed error
}

func main() {
	cfg, err := parseArgs(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
	if err := run(context.Background(), cfg); err != nil {
		log.Fatal(err)
	}
}

func parseArgs(args []string) (config, error) {
	flags := flag.NewFlagSet("migrate-sqlite-to-postgres", flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	var cfg config
	flags.StringVar(&cfg.SQLitePath, "sqlite", "", "source SQLite database path")
	flags.StringVar(&cfg.PostgresURL, "postgres", "", "target PostgreSQL database URL")

	if err := flags.Parse(args); err != nil {
		return config{}, err
	}
	if strings.TrimSpace(cfg.SQLitePath) == "" {
		return config{}, errors.New("--sqlite is required")
	}
	if strings.TrimSpace(cfg.PostgresURL) == "" {
		return config{}, errors.New("--postgres is required")
	}
	return cfg, nil
}

func run(ctx context.Context, cfg config) error {
	sqliteDB, err := sql.Open("sqlite", cfg.SQLitePath)
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	sqliteDB.SetMaxOpenConns(1)
	defer sqliteDB.Close()
	if err := sqliteDB.PingContext(ctx); err != nil {
		return fmt.Errorf("ping sqlite: %w", err)
	}

	postgresDB, err := appdb.Open(cfg.PostgresURL)
	if err != nil {
		return fmt.Errorf("open postgres: %w", err)
	}
	defer postgresDB.Close()

	tx, err := postgresDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin import: %w", err)
	}
	defer tx.Rollback()

	counts := make(map[string]int)
	for _, importer := range tableImporters {
		count, err := importer.importRows(ctx, sqliteDB, tx)
		if err != nil {
			return fmt.Errorf("import %s: %w", importer.name, err)
		}
		counts[importer.name] = count
	}

	if err := resetIdentities(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit import: %w", err)
	}

	for _, table := range importTables {
		log.Printf("imported %s rows=%d", table, counts[table])
	}
	return nil
}

func (t tableImporter) importRows(ctx context.Context, sqliteDB *sql.DB, tx *sql.Tx) (int, error) {
	rows, err := sqliteDB.QueryContext(ctx, t.selectSQL)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return 0, err
	}
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}

	count := 0
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return count, err
		}
		row := sourceRow{values: make(map[string]any, len(columns))}
		for i, column := range columns {
			row.values[column] = cloneSQLiteValue(values[i])
		}
		args, err := t.buildArgs(&row)
		if err != nil {
			return count, err
		}
		if _, err := tx.ExecContext(ctx, t.insertSQL, args...); err != nil {
			return count, err
		}
		count++
	}
	return count, rows.Err()
}

func resetIdentities(ctx context.Context, tx *sql.Tx) error {
	for _, table := range identityTables {
		query := fmt.Sprintf(
			`SELECT setval(pg_get_serial_sequence('%s', 'id'), COALESCE((SELECT MAX(id) FROM %s), 1), true)`,
			table,
			table,
		)
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return fmt.Errorf("reset identity %s: %w", table, err)
		}
	}
	return nil
}

func cloneSQLiteValue(value any) any {
	if bytes, ok := value.([]byte); ok {
		return append([]byte(nil), bytes...)
	}
	return value
}

func (r *sourceRow) recordErr(err error) {
	if r.failed == nil {
		r.failed = err
	}
}

func (r *sourceRow) err() error {
	return r.failed
}

func (r *sourceRow) string(name string) string {
	if r.failed != nil {
		return ""
	}
	value, ok := r.values[name]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		return fmt.Sprint(typed)
	}
}

func (r *sourceRow) int64(name string) int64 {
	if r.failed != nil {
		return 0
	}
	value, err := toInt64(r.values[name])
	if err != nil {
		r.recordErr(fmt.Errorf("%s: %w", name, err))
		return 0
	}
	return value
}

func (r *sourceRow) int32(name string) int32 {
	value := r.int64(name)
	return int32(value)
}

func (r *sourceRow) nullableInt64(name string) any {
	if r.failed != nil {
		return nil
	}
	value, ok := r.values[name]
	if !ok || value == nil {
		return nil
	}
	converted, err := toInt64(value)
	if err != nil {
		r.recordErr(fmt.Errorf("%s: %w", name, err))
		return nil
	}
	return converted
}

func (r *sourceRow) nullableInt32(name string) any {
	value := r.nullableInt64(name)
	if value == nil {
		return nil
	}
	return int32(value.(int64))
}

func (r *sourceRow) bool(name string) bool {
	if r.failed != nil {
		return false
	}
	value, err := toBool(r.values[name])
	if err != nil {
		r.recordErr(fmt.Errorf("%s: %w", name, err))
		return false
	}
	return value
}

func (r *sourceRow) time(name string) time.Time {
	if r.failed != nil {
		return time.Time{}
	}
	value, err := toTime(r.values[name])
	if err != nil {
		r.recordErr(fmt.Errorf("%s: %w", name, err))
		return time.Time{}
	}
	return value
}

func (r *sourceRow) nullableTime(name string) any {
	if r.failed != nil {
		return nil
	}
	value, ok := r.values[name]
	if !ok || value == nil {
		return nil
	}
	converted, err := toTime(value)
	if err != nil {
		r.recordErr(fmt.Errorf("%s: %w", name, err))
		return nil
	}
	return converted
}

func toInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case nil:
		return 0, errors.New("value is NULL")
	case int64:
		return typed, nil
	case int32:
		return int64(typed), nil
	case int:
		return int64(typed), nil
	case float64:
		return int64(typed), nil
	case []byte:
		return toInt64(string(typed))
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, errors.New("value is empty")
		}
		parsed, err := strconv.ParseInt(text, 10, 64)
		if err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("unsupported integer type %T", value)
	}
}

func toBool(value any) (bool, error) {
	switch typed := value.(type) {
	case nil:
		return false, errors.New("value is NULL")
	case bool:
		return typed, nil
	case int64:
		return typed != 0, nil
	case int:
		return typed != 0, nil
	case float64:
		return typed != 0, nil
	case []byte:
		return toBool(string(typed))
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "t", "true", "yes":
			return true, nil
		case "0", "f", "false", "no":
			return false, nil
		default:
			return false, fmt.Errorf("unsupported boolean value %q", typed)
		}
	default:
		return false, fmt.Errorf("unsupported boolean type %T", value)
	}
}

var sqliteTimeLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02 15:04:05.999999999Z07:00",
	"2006-01-02 15:04:05.999999999",
	"2006-01-02 15:04:05Z07:00",
	"2006-01-02 15:04:05",
	"2006-01-02",
}

func toTime(value any) (time.Time, error) {
	switch typed := value.(type) {
	case nil:
		return time.Time{}, errors.New("value is NULL")
	case time.Time:
		return storage.NormalizeTime(typed), nil
	case []byte:
		return toTime(string(typed))
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return time.Time{}, errors.New("value is empty")
		}
		for _, layout := range sqliteTimeLayouts {
			parsed, err := time.Parse(layout, text)
			if err == nil {
				return storage.NormalizeTime(parsed), nil
			}
		}
		return time.Time{}, fmt.Errorf("unsupported timestamp %q", text)
	default:
		return time.Time{}, fmt.Errorf("unsupported timestamp type %T", value)
	}
}
