package content

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
	"portfolio/internal/i18n"
	"portfolio/internal/translation"
)

func (r *Repository) LoadProjectTranslationGeneration(ctx context.Context, projectID int64, locale i18n.Locale) (translation.TranslationSnapshot, translation.ProjectTranslationSource, error) {
	var (
		snapshot      translation.TranslationSnapshot
		source        translation.ProjectTranslationSource
		translationTS sql.NullTime
	)
	err := r.db.QueryRowContext(ctx, `
		SELECT
			projects.translation_source_version,
			translations.updated_at,
			projects.title,
			projects.slug,
			projects.summary,
			projects.content_md,
			projects.seo_title,
			projects.seo_description
		FROM projects
		LEFT JOIN project_translations translations
		  ON translations.project_id = projects.id
		 AND translations.locale = $2
		WHERE projects.id = $1
	`, projectID, locale).Scan(
		&snapshot.SourceVersion,
		&translationTS,
		&source.Title,
		&source.SourceSlug,
		&source.Summary,
		&source.ContentMD,
		&source.SEOTitle,
		&source.SEODescription,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return translation.TranslationSnapshot{}, translation.ProjectTranslationSource{}, ErrNotFound
		}
		return translation.TranslationSnapshot{}, translation.ProjectTranslationSource{}, err
	}
	if translationTS.Valid {
		snapshot.LocaleETag = translationETag(translationTS.Time)
	}
	return snapshot, source, nil
}

func (r *Repository) SaveGeneratedProjectTranslation(ctx context.Context, projectID int64, locale i18n.Locale, expected translation.TranslationSnapshot, generated translation.GeneratedProjectTranslation) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, err := projectTranslationSnapshotTx(ctx, tx, projectID, locale)
	if err != nil {
		return err
	}
	if current.CurrentSourceVersion != expected.SourceVersion || current.ETag != expected.LocaleETag {
		return translation.ErrConflict
	}

	now := normalizeTime(r.clock())
	err = saveProjectTranslationWithExecer(ctx, tx, projectID, locale, current.CurrentSourceVersion, ProjectTranslationInput{
		Title:          generated.Title,
		Slug:           generated.Slug,
		Summary:        generated.Summary,
		ContentMD:      generated.ContentMD,
		SEOTitle:       generated.SEOTitle,
		SEODescription: generated.SEODescription,
	}, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func projectTranslationSnapshotTx(ctx context.Context, tx *sql.Tx, projectID int64, locale i18n.Locale) (translationSnapshot, error) {
	var snapshot translationSnapshot
	var sourceVersion sql.NullInt64
	var updatedAt sql.NullTime
	err := tx.QueryRowContext(ctx, `
		SELECT
			source.translation_source_version,
			translations.source_version,
			translations.updated_at
		FROM projects source
		LEFT JOIN project_translations translations
		  ON translations.project_id = source.id
		 AND translations.locale = $2
		WHERE source.id = $1
		FOR UPDATE OF source
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

func generateProjectTranslationHandler(repo *Repository, generator ContentTranslationGenerator) http.HandlerFunc {
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

		start, source, err := repo.LoadProjectTranslationGeneration(req.Context(), id, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate project translation")
			return
		}

		generated, err := generator.GenerateProject(req.Context(), source, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate project translation")
			return
		}

		err = repo.SaveGeneratedProjectTranslation(req.Context(), id, locale, start, generated)
		writeTranslationResult(w, err, "Could not generate project translation")
	}
}
