package profile

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"portfolio/internal/i18n"
	"portfolio/internal/storage"
)

var ErrTranslationStale = errors.New("translation source is stale")

type ProfileTranslationInput struct {
	Name           string                       `json:"name"`
	Headline       string                       `json:"headline"`
	Summary        string                       `json:"summary"`
	Bio            string                       `json:"bio"`
	SEOTitle       string                       `json:"seo_title"`
	SEODescription string                       `json:"seo_description"`
	SocialLinks    []SocialLinkTranslationInput `json:"social_links"`
}

type translationSnapshot struct {
	CurrentSourceVersion int64
	ETag                 string
	Exists               bool
	HasStaleSocialLinks  bool
	SourceVersion        int64
}

type sqlExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

type sqlQueryer interface {
	sqlExecer
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type SocialLinkTranslationInput struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
}

func (r *Repository) SaveTranslation(ctx context.Context, locale i18n.Locale, input ProfileTranslationInput, ifMatch string, ifNoneMatch string) error {
	current, err := r.profileTranslationSnapshot(ctx, locale)
	if err != nil {
		return err
	}
	switch {
	case !current.Exists && ifNoneMatch != "*":
		return ErrPreconditionRequired
	case current.Exists && current.ETag != ifMatch:
		return ErrConflict
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := saveTranslationWithExecer(ctx, tx, locale, current.CurrentSourceVersion, input, storage.NormalizeTime(r.clock())); err != nil {
		return err
	}
	return tx.Commit()
}

func saveTranslationWithExecer(ctx context.Context, execer sqlExecer, locale i18n.Locale, sourceVersion int64, input ProfileTranslationInput, now time.Time) error {
	_, err := execer.ExecContext(ctx, `
		INSERT INTO profile_translations
			(profile_id, locale, translation_status, source_version, name, headline, summary, bio, seo_title, seo_description, translated_at, updated_at)
		VALUES
			($1, $2, 'ai_draft', $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), NULL, $10)
		ON CONFLICT (profile_id, locale) DO UPDATE SET
			translation_status = 'ai_draft',
			source_version = EXCLUDED.source_version,
			name = EXCLUDED.name,
			headline = EXCLUDED.headline,
			summary = EXCLUDED.summary,
			bio = EXCLUDED.bio,
			seo_title = EXCLUDED.seo_title,
			seo_description = EXCLUDED.seo_description,
			translated_at = NULL,
			updated_at = EXCLUDED.updated_at
	`, int64(1), locale, sourceVersion, input.Name, input.Headline, input.Summary, input.Bio, input.SEOTitle, input.SEODescription, now)
	if err != nil {
		return err
	}
	return saveSocialLinkTranslationsWithExecer(ctx, execer, locale, input.SocialLinks, now)
}

func (r *Repository) MarkTranslationReviewed(ctx context.Context, locale i18n.Locale, ifMatch string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, err := profileTranslationSnapshotTx(ctx, tx, locale)
	if err != nil {
		return err
	}
	if !current.Exists {
		return ErrNotFound
	}
	if current.SourceVersion != current.CurrentSourceVersion || current.HasStaleSocialLinks {
		return ErrTranslationStale
	}
	if ifMatch == "" {
		return ErrPreconditionRequired
	}
	if current.ETag != ifMatch {
		return ErrConflict
	}

	now := storage.NormalizeTime(r.clock())
	if _, err = tx.ExecContext(ctx, `
		UPDATE profile_translations
		SET translation_status = 'reviewed', translated_at = $1, updated_at = $1
		WHERE profile_id = $2 AND locale = $3
	`, now, int64(1), locale); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `
		UPDATE social_link_translations
		SET translation_status = 'reviewed', translated_at = $1, updated_at = $1
		WHERE locale = $2
		  AND social_link_id IN (
			SELECT id FROM social_links WHERE profile_id = $3
		  )
	`, now, locale, int64(1)); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) profileTranslationSnapshot(ctx context.Context, locale i18n.Locale) (translationSnapshot, error) {
	return profileTranslationSnapshotWithQueryer(ctx, r.db, locale, false)
}

func profileTranslationSnapshotTx(ctx context.Context, tx *sql.Tx, locale i18n.Locale) (translationSnapshot, error) {
	return profileTranslationSnapshotWithQueryer(ctx, tx, locale, true)
}

func profileTranslationSnapshotWithQueryer(ctx context.Context, queryer sqlQueryer, locale i18n.Locale, lockSource bool) (translationSnapshot, error) {
	var (
		snapshot      translationSnapshot
		sourceVersion sql.NullInt64
		updatedAt     sql.NullTime
	)
	lockClause := ""
	if lockSource {
		lockClause = " FOR UPDATE OF source"
	}
	err := queryer.QueryRowContext(ctx, `
		SELECT
			source.translation_source_version,
			translations.source_version,
			translations.updated_at
		FROM profile source
		LEFT JOIN profile_translations translations
		  ON translations.profile_id = source.id
		 AND translations.locale = $2
		WHERE source.id = $1
	`+lockClause, int64(1), locale).Scan(&snapshot.CurrentSourceVersion, &sourceVersion, &updatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return translationSnapshot{}, ErrNotFound
		}
		return translationSnapshot{}, err
	}
	if sourceVersion.Valid && updatedAt.Valid {
		snapshot.Exists = true
		snapshot.SourceVersion = sourceVersion.Int64
		snapshot.ETag = translationETag(updatedAt.Time)
	}
	rows, err := queryer.QueryContext(ctx, `
		SELECT translations.source_version, links.translation_source_version
		FROM social_link_translations translations
		JOIN social_links links ON links.id = translations.social_link_id
		WHERE links.profile_id = $1
		  AND translations.locale = $2
	`, int64(1), locale)
	if err != nil {
		return translationSnapshot{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var translatedVersion int64
		var currentVersion int64
		if err := rows.Scan(&translatedVersion, &currentVersion); err != nil {
			return translationSnapshot{}, err
		}
		if translatedVersion != currentVersion {
			snapshot.HasStaleSocialLinks = true
		}
	}
	if err := rows.Err(); err != nil {
		return translationSnapshot{}, err
	}
	return snapshot, nil
}

func translationETag(updatedAt time.Time) string {
	value := storage.NormalizeTime(updatedAt).Format(time.RFC3339Nano)
	sum := sha256.Sum256([]byte(value))
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}

func saveSocialLinkTranslationsWithExecer(ctx context.Context, execer sqlExecer, locale i18n.Locale, input []SocialLinkTranslationInput, now time.Time) error {
	keepIDs := make([]int64, 0, len(input))
	for _, link := range input {
		label := strings.TrimSpace(link.Label)
		if label == "" {
			continue
		}
		result, err := execer.ExecContext(ctx, `
			INSERT INTO social_link_translations
				(social_link_id, locale, translation_status, source_version, label, translated_at, updated_at)
			SELECT
				links.id,
				$2,
				'ai_draft',
				links.translation_source_version,
				$3,
				NULL,
				$4
			FROM social_links links
			WHERE links.id = $1
			  AND links.profile_id = $5
			ON CONFLICT (social_link_id, locale) DO UPDATE SET
				translation_status = 'ai_draft',
				source_version = EXCLUDED.source_version,
				label = EXCLUDED.label,
				translated_at = NULL,
				updated_at = EXCLUDED.updated_at
		`, link.ID, locale, label, now, int64(1))
		if err != nil {
			return err
		}
		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rowsAffected == 0 {
			return ErrConflict
		}
		keepIDs = append(keepIDs, link.ID)
	}

	return deleteMissingSocialLinkTranslationsWithExecer(ctx, execer, locale, keepIDs)
}

func deleteMissingSocialLinkTranslationsWithExecer(ctx context.Context, execer sqlExecer, locale i18n.Locale, keepIDs []int64) error {
	query := `
		DELETE FROM social_link_translations
		WHERE locale = $1
		  AND social_link_id IN (
			SELECT id FROM social_links WHERE profile_id = $2
		  )
	`
	args := []any{locale, int64(1)}
	if len(keepIDs) > 0 {
		query += " AND social_link_id NOT IN ("
		for index, linkID := range keepIDs {
			if index > 0 {
				query += ", "
			}
			query += fmt.Sprintf("$%d", len(args)+1)
			args = append(args, linkID)
		}
		query += ")"
	}
	_, err := execer.ExecContext(ctx, query, args...)
	return err
}
