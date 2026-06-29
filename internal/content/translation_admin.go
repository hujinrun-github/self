package content

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"portfolio/internal/httpserver"
	"portfolio/internal/i18n"
	"portfolio/internal/storage"
	"portfolio/internal/translation"
)

var (
	ErrPreconditionRequired = errors.New("translation precondition is required")
	ErrTranslationStale     = errors.New("translation source is stale")
)

type ProjectTranslationInput struct {
	Title          string `json:"title"`
	Slug           string `json:"slug"`
	Summary        string `json:"summary"`
	ContentMD      string `json:"content_md"`
	SEOTitle       string `json:"seo_title"`
	SEODescription string `json:"seo_description"`
}

type translationSnapshot struct {
	CurrentSourceVersion int64
	ETag                 string
	Exists               bool
	SourceVersion        int64
}

type sqlExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (r *Repository) SaveProjectTranslation(ctx context.Context, projectID int64, locale i18n.Locale, input ProjectTranslationInput, ifMatch string, ifNoneMatch string) error {
	current, err := r.projectTranslationSnapshot(ctx, projectID, locale)
	if err != nil {
		return err
	}
	switch {
	case !current.Exists && ifNoneMatch != "*":
		return ErrPreconditionRequired
	case current.Exists && current.ETag != ifMatch:
		return ErrConflict
	}
	return r.saveProjectTranslation(ctx, projectID, locale, current.CurrentSourceVersion, input)
}

func (r *Repository) MarkProjectTranslationReviewed(ctx context.Context, projectID int64, locale i18n.Locale, ifMatch string) error {
	current, err := r.projectTranslationSnapshot(ctx, projectID, locale)
	if err != nil {
		return err
	}
	if !current.Exists {
		return ErrNotFound
	}
	if current.SourceVersion != current.CurrentSourceVersion {
		return ErrTranslationStale
	}
	if ifMatch == "" {
		return ErrPreconditionRequired
	}
	if current.ETag != ifMatch {
		return ErrConflict
	}

	now := normalizeTime(r.clock())
	_, err = r.db.ExecContext(ctx, `
		UPDATE project_translations
		SET translation_status = 'reviewed', translated_at = $1, updated_at = $1
		WHERE project_id = $2 AND locale = $3
	`, now, projectID, locale)
	return err
}

func (r *Repository) projectTranslationSnapshot(ctx context.Context, projectID int64, locale i18n.Locale) (translationSnapshot, error) {
	var snapshot translationSnapshot
	var sourceVersion sql.NullInt64
	var updatedAt sql.NullTime
	err := r.db.QueryRowContext(ctx, `
		SELECT
			projects.translation_source_version,
			translations.source_version,
			translations.updated_at
		FROM projects
		LEFT JOIN project_translations translations
		  ON translations.project_id = projects.id
		 AND translations.locale = $2
		WHERE projects.id = $1
	`, projectID, locale).Scan(&snapshot.CurrentSourceVersion, &sourceVersion, &updatedAt)
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
	return snapshot, nil
}

func (r *Repository) saveProjectTranslation(ctx context.Context, projectID int64, locale i18n.Locale, sourceVersion int64, input ProjectTranslationInput) error {
	return saveProjectTranslationWithExecer(ctx, r.db, projectID, locale, sourceVersion, input, normalizeTime(r.clock()))
}

func saveProjectTranslationWithExecer(ctx context.Context, execer sqlExecer, projectID int64, locale i18n.Locale, sourceVersion int64, input ProjectTranslationInput, now time.Time) error {
	slug, err := Slugify(chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return err
	}
	_, err = execer.ExecContext(ctx, `
		INSERT INTO project_translations
			(project_id, locale, translation_status, source_version, title, slug, summary, content_md, seo_title, seo_description, translated_at, updated_at)
		VALUES
			($1, $2, 'ai_draft', $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), NULL, $10)
		ON CONFLICT (project_id, locale) DO UPDATE SET
			translation_status = 'ai_draft',
			source_version = EXCLUDED.source_version,
			title = EXCLUDED.title,
			slug = EXCLUDED.slug,
			summary = EXCLUDED.summary,
			content_md = EXCLUDED.content_md,
			seo_title = EXCLUDED.seo_title,
			seo_description = EXCLUDED.seo_description,
			translated_at = NULL,
			updated_at = EXCLUDED.updated_at
	`, projectID, locale, sourceVersion, input.Title, slug, input.Summary, input.ContentMD, input.SEOTitle, input.SEODescription, now)
	if translationSlugUniqueViolation(err, "project_translations") {
		return ErrSlugConflict
	}
	return err
}

func saveProjectTranslationHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
			return
		}
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		var input ProjectTranslationInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid project translation payload", nil)
			return
		}
		err = repo.SaveProjectTranslation(req.Context(), id, locale, input, req.Header.Get("If-Match"), req.Header.Get("If-None-Match"))
		writeTranslationResult(w, err, "Could not save project translation")
	}
}

func reviewProjectTranslationHandler(repo *Repository) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		locale, err := i18n.ParseTranslationLocale(chi.URLParam(req, "locale"))
		if err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Unsupported translation locale", nil)
			return
		}
		id, ok := idParam(w, req)
		if !ok {
			return
		}
		err = repo.MarkProjectTranslationReviewed(req.Context(), id, locale, req.Header.Get("If-Match"))
		writeTranslationResult(w, err, "Could not review project translation")
	}
}

func writeTranslationResult(w http.ResponseWriter, err error, message string) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, http.StatusNotFound, "not_found", "Content not found", nil)
	case errors.Is(err, ErrPreconditionRequired):
		httpserver.WriteError(w, http.StatusPreconditionRequired, "precondition_required", "Translation precondition header is required", nil)
	case errors.Is(err, ErrConflict), errors.Is(err, ErrTranslationStale), errors.Is(err, ErrSlugConflict), errors.Is(err, translation.ErrConflict):
		httpserver.WriteError(w, http.StatusConflict, "conflict", err.Error(), nil)
	case errors.Is(err, ErrEmptySlug), errors.Is(err, ErrReservedSlug), errors.Is(err, ErrSlugTooLong):
		httpserver.WriteError(w, http.StatusBadRequest, "validation_error", err.Error(), nil)
	case errors.Is(err, translation.ErrProviderUnavailable):
		httpserver.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", err.Error(), nil)
	case errors.Is(err, translation.ErrProviderRequestFailed), errors.Is(err, translation.ErrInvalidResponse):
		httpserver.WriteError(w, http.StatusBadGateway, "provider_error", err.Error(), nil)
	default:
		httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", message, nil)
	}
}

func translationETag(updatedAt time.Time) string {
	value := storage.NormalizeTime(updatedAt).Format(time.RFC3339Nano)
	sum := sha256.Sum256([]byte(value))
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}

func translationSlugUniqueViolation(err error, table string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != storage.CodeUniqueViolation {
		return false
	}
	return pgErr.ConstraintName == table+"_locale_slug_key"
}
