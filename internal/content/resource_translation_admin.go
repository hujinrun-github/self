package content

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
	"portfolio/internal/i18n"
	"portfolio/internal/translation"
)

type ContentTranslationGenerator interface {
	GenerateProject(ctx context.Context, source translation.ProjectTranslationSource, locale i18n.Locale) (translation.GeneratedProjectTranslation, error)
	GenerateWriting(ctx context.Context, source translation.WritingTranslationSource, locale i18n.Locale) (translation.GeneratedWritingTranslation, error)
	GenerateTalk(ctx context.Context, source translation.TalkTranslationSource, locale i18n.Locale) (translation.GeneratedTalkTranslation, error)
	GenerateExperience(ctx context.Context, source translation.ExperienceTranslationSource, locale i18n.Locale) (translation.GeneratedExperienceTranslation, error)
}

type WritingTranslationInput struct {
	Title          string `json:"title"`
	Slug           string `json:"slug"`
	Excerpt        string `json:"excerpt"`
	ContentMD      string `json:"content_md"`
	SEOTitle       string `json:"seo_title"`
	SEODescription string `json:"seo_description"`
}

type TalkTranslationInput struct {
	Title          string `json:"title"`
	Slug           string `json:"slug"`
	Summary        string `json:"summary"`
	EventName      string `json:"event_name"`
	SEOTitle       string `json:"seo_title"`
	SEODescription string `json:"seo_description"`
}

type ExperienceTranslationInput struct {
	Period       string `json:"period"`
	Title        string `json:"title"`
	Organization string `json:"organization"`
	Description  string `json:"description"`
}

type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func translationSnapshotForResource(ctx context.Context, runner queryRower, sourceTable string, translationTable string, sourceColumn string, id int64, locale i18n.Locale, forUpdate bool) (translationSnapshot, error) {
	var snapshot translationSnapshot
	var sourceVersion sql.NullInt64
	var updatedAt sql.NullTime
	query := fmt.Sprintf(`
		SELECT
			source.translation_source_version,
			translation.source_version,
			translation.updated_at
		FROM %s source
		LEFT JOIN %s translation
		  ON translation.%s = source.id
		 AND translation.locale = $2
		WHERE source.id = $1
	`, sourceTable, translationTable, sourceColumn)
	if forUpdate {
		query += "\n\t\tFOR UPDATE OF source"
	}
	err := runner.QueryRowContext(ctx, query, id, locale).Scan(&snapshot.CurrentSourceVersion, &sourceVersion, &updatedAt)
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

func markResourceTranslationReviewed(ctx context.Context, db *sql.DB, sourceTable string, translationTable string, sourceColumn string, id int64, locale i18n.Locale, ifMatch string, clock func() time.Time) error {
	current, err := translationSnapshotForResource(ctx, db, sourceTable, translationTable, sourceColumn, id, locale, false)
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

	now := normalizeTime(clock())
	query := fmt.Sprintf(`
		UPDATE %s
		SET translation_status = 'reviewed', translated_at = $1, updated_at = $1
		WHERE %s = $2 AND locale = $3
	`, translationTable, sourceColumn)
	_, err = db.ExecContext(ctx, query, now, id, locale)
	return err
}

func (r *Repository) SaveWritingTranslation(ctx context.Context, writingID int64, locale i18n.Locale, input WritingTranslationInput, ifMatch string, ifNoneMatch string) error {
	current, err := r.writingTranslationSnapshot(ctx, writingID, locale)
	if err != nil {
		return err
	}
	switch {
	case !current.Exists && ifNoneMatch != "*":
		return ErrPreconditionRequired
	case current.Exists && current.ETag != ifMatch:
		return ErrConflict
	}
	return r.saveWritingTranslation(ctx, writingID, locale, current.CurrentSourceVersion, input)
}

func (r *Repository) MarkWritingTranslationReviewed(ctx context.Context, writingID int64, locale i18n.Locale, ifMatch string) error {
	return markResourceTranslationReviewed(ctx, r.db, "writings", "writing_translations", "writing_id", writingID, locale, ifMatch, r.clock)
}

func (r *Repository) writingTranslationSnapshot(ctx context.Context, writingID int64, locale i18n.Locale) (translationSnapshot, error) {
	return translationSnapshotForResource(ctx, r.db, "writings", "writing_translations", "writing_id", writingID, locale, false)
}

func writingTranslationSnapshotTx(ctx context.Context, tx *sql.Tx, writingID int64, locale i18n.Locale) (translationSnapshot, error) {
	return translationSnapshotForResource(ctx, tx, "writings", "writing_translations", "writing_id", writingID, locale, true)
}

func (r *Repository) saveWritingTranslation(ctx context.Context, writingID int64, locale i18n.Locale, sourceVersion int64, input WritingTranslationInput) error {
	return saveWritingTranslationWithExecer(ctx, r.db, writingID, locale, sourceVersion, input, normalizeTime(r.clock()))
}

func saveWritingTranslationWithExecer(ctx context.Context, execer sqlExecer, writingID int64, locale i18n.Locale, sourceVersion int64, input WritingTranslationInput, now time.Time) error {
	slug, err := Slugify(chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return err
	}
	_, err = execer.ExecContext(ctx, `
		INSERT INTO writing_translations
			(writing_id, locale, translation_status, source_version, title, slug, excerpt, content_md, seo_title, seo_description, translated_at, updated_at)
		VALUES
			($1, $2, 'ai_draft', $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), NULL, $10)
		ON CONFLICT (writing_id, locale) DO UPDATE SET
			translation_status = 'ai_draft',
			source_version = EXCLUDED.source_version,
			title = EXCLUDED.title,
			slug = EXCLUDED.slug,
			excerpt = EXCLUDED.excerpt,
			content_md = EXCLUDED.content_md,
			seo_title = EXCLUDED.seo_title,
			seo_description = EXCLUDED.seo_description,
			translated_at = NULL,
			updated_at = EXCLUDED.updated_at
	`, writingID, locale, sourceVersion, input.Title, slug, input.Excerpt, input.ContentMD, input.SEOTitle, input.SEODescription, now)
	if translationSlugUniqueViolation(err, "writing_translations") {
		return ErrSlugConflict
	}
	return err
}

func saveWritingTranslationHandler(repo *Repository) http.HandlerFunc {
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
		var input WritingTranslationInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid writing translation payload", nil)
			return
		}
		err = repo.SaveWritingTranslation(req.Context(), id, locale, input, req.Header.Get("If-Match"), req.Header.Get("If-None-Match"))
		writeTranslationResult(w, err, "Could not save writing translation")
	}
}

func reviewWritingTranslationHandler(repo *Repository) http.HandlerFunc {
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
		err = repo.MarkWritingTranslationReviewed(req.Context(), id, locale, req.Header.Get("If-Match"))
		writeTranslationResult(w, err, "Could not review writing translation")
	}
}

func (r *Repository) LoadWritingTranslationGeneration(ctx context.Context, writingID int64, locale i18n.Locale) (translation.TranslationSnapshot, translation.WritingTranslationSource, error) {
	var (
		snapshot      translation.TranslationSnapshot
		source        translation.WritingTranslationSource
		translationTS sql.NullTime
	)
	err := r.db.QueryRowContext(ctx, `
		SELECT
			writings.translation_source_version,
			translations.updated_at,
			writings.title,
			writings.slug,
			writings.excerpt,
			writings.content_md,
			writings.seo_title,
			writings.seo_description
		FROM writings
		LEFT JOIN writing_translations translations
		  ON translations.writing_id = writings.id
		 AND translations.locale = $2
		WHERE writings.id = $1
	`, writingID, locale).Scan(
		&snapshot.SourceVersion,
		&translationTS,
		&source.Title,
		&source.SourceSlug,
		&source.Excerpt,
		&source.ContentMD,
		&source.SEOTitle,
		&source.SEODescription,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return translation.TranslationSnapshot{}, translation.WritingTranslationSource{}, ErrNotFound
		}
		return translation.TranslationSnapshot{}, translation.WritingTranslationSource{}, err
	}
	if translationTS.Valid {
		snapshot.LocaleETag = translationETag(translationTS.Time)
	}
	return snapshot, source, nil
}

func (r *Repository) SaveGeneratedWritingTranslation(ctx context.Context, writingID int64, locale i18n.Locale, expected translation.TranslationSnapshot, generated translation.GeneratedWritingTranslation) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, err := writingTranslationSnapshotTx(ctx, tx, writingID, locale)
	if err != nil {
		return err
	}
	if current.CurrentSourceVersion != expected.SourceVersion || current.ETag != expected.LocaleETag {
		return translation.ErrConflict
	}

	now := normalizeTime(r.clock())
	err = saveWritingTranslationWithExecer(ctx, tx, writingID, locale, current.CurrentSourceVersion, WritingTranslationInput{
		Title:          generated.Title,
		Slug:           generated.Slug,
		Excerpt:        generated.Excerpt,
		ContentMD:      generated.ContentMD,
		SEOTitle:       generated.SEOTitle,
		SEODescription: generated.SEODescription,
	}, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func generateWritingTranslationHandler(repo *Repository, generator ContentTranslationGenerator) http.HandlerFunc {
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
		start, source, err := repo.LoadWritingTranslationGeneration(req.Context(), id, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate writing translation")
			return
		}
		generated, err := generator.GenerateWriting(req.Context(), source, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate writing translation")
			return
		}
		err = repo.SaveGeneratedWritingTranslation(req.Context(), id, locale, start, generated)
		writeTranslationResult(w, err, "Could not generate writing translation")
	}
}

func (r *Repository) SaveTalkTranslation(ctx context.Context, talkID int64, locale i18n.Locale, input TalkTranslationInput, ifMatch string, ifNoneMatch string) error {
	current, err := r.talkTranslationSnapshot(ctx, talkID, locale)
	if err != nil {
		return err
	}
	switch {
	case !current.Exists && ifNoneMatch != "*":
		return ErrPreconditionRequired
	case current.Exists && current.ETag != ifMatch:
		return ErrConflict
	}
	return r.saveTalkTranslation(ctx, talkID, locale, current.CurrentSourceVersion, input)
}

func (r *Repository) MarkTalkTranslationReviewed(ctx context.Context, talkID int64, locale i18n.Locale, ifMatch string) error {
	return markResourceTranslationReviewed(ctx, r.db, "talks", "talk_translations", "talk_id", talkID, locale, ifMatch, r.clock)
}

func (r *Repository) talkTranslationSnapshot(ctx context.Context, talkID int64, locale i18n.Locale) (translationSnapshot, error) {
	return translationSnapshotForResource(ctx, r.db, "talks", "talk_translations", "talk_id", talkID, locale, false)
}

func talkTranslationSnapshotTx(ctx context.Context, tx *sql.Tx, talkID int64, locale i18n.Locale) (translationSnapshot, error) {
	return translationSnapshotForResource(ctx, tx, "talks", "talk_translations", "talk_id", talkID, locale, true)
}

func (r *Repository) saveTalkTranslation(ctx context.Context, talkID int64, locale i18n.Locale, sourceVersion int64, input TalkTranslationInput) error {
	return saveTalkTranslationWithExecer(ctx, r.db, talkID, locale, sourceVersion, input, normalizeTime(r.clock()))
}

func saveTalkTranslationWithExecer(ctx context.Context, execer sqlExecer, talkID int64, locale i18n.Locale, sourceVersion int64, input TalkTranslationInput, now time.Time) error {
	slug, err := Slugify(chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return err
	}
	_, err = execer.ExecContext(ctx, `
		INSERT INTO talk_translations
			(talk_id, locale, translation_status, source_version, title, slug, summary, event_name, seo_title, seo_description, translated_at, updated_at)
		VALUES
			($1, $2, 'ai_draft', $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), NULL, $10)
		ON CONFLICT (talk_id, locale) DO UPDATE SET
			translation_status = 'ai_draft',
			source_version = EXCLUDED.source_version,
			title = EXCLUDED.title,
			slug = EXCLUDED.slug,
			summary = EXCLUDED.summary,
			event_name = EXCLUDED.event_name,
			seo_title = EXCLUDED.seo_title,
			seo_description = EXCLUDED.seo_description,
			translated_at = NULL,
			updated_at = EXCLUDED.updated_at
	`, talkID, locale, sourceVersion, input.Title, slug, input.Summary, input.EventName, input.SEOTitle, input.SEODescription, now)
	if translationSlugUniqueViolation(err, "talk_translations") {
		return ErrSlugConflict
	}
	return err
}

func saveTalkTranslationHandler(repo *Repository) http.HandlerFunc {
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
		var input TalkTranslationInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid talk translation payload", nil)
			return
		}
		err = repo.SaveTalkTranslation(req.Context(), id, locale, input, req.Header.Get("If-Match"), req.Header.Get("If-None-Match"))
		writeTranslationResult(w, err, "Could not save talk translation")
	}
}

func reviewTalkTranslationHandler(repo *Repository) http.HandlerFunc {
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
		err = repo.MarkTalkTranslationReviewed(req.Context(), id, locale, req.Header.Get("If-Match"))
		writeTranslationResult(w, err, "Could not review talk translation")
	}
}

func (r *Repository) LoadTalkTranslationGeneration(ctx context.Context, talkID int64, locale i18n.Locale) (translation.TranslationSnapshot, translation.TalkTranslationSource, error) {
	var (
		snapshot      translation.TranslationSnapshot
		source        translation.TalkTranslationSource
		translationTS sql.NullTime
	)
	err := r.db.QueryRowContext(ctx, `
		SELECT
			talks.translation_source_version,
			translations.updated_at,
			talks.title,
			talks.slug,
			talks.summary,
			talks.event_name,
			talks.seo_title,
			talks.seo_description
		FROM talks
		LEFT JOIN talk_translations translations
		  ON translations.talk_id = talks.id
		 AND translations.locale = $2
		WHERE talks.id = $1
	`, talkID, locale).Scan(
		&snapshot.SourceVersion,
		&translationTS,
		&source.Title,
		&source.SourceSlug,
		&source.Summary,
		&source.EventName,
		&source.SEOTitle,
		&source.SEODescription,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return translation.TranslationSnapshot{}, translation.TalkTranslationSource{}, ErrNotFound
		}
		return translation.TranslationSnapshot{}, translation.TalkTranslationSource{}, err
	}
	if translationTS.Valid {
		snapshot.LocaleETag = translationETag(translationTS.Time)
	}
	return snapshot, source, nil
}

func (r *Repository) SaveGeneratedTalkTranslation(ctx context.Context, talkID int64, locale i18n.Locale, expected translation.TranslationSnapshot, generated translation.GeneratedTalkTranslation) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, err := talkTranslationSnapshotTx(ctx, tx, talkID, locale)
	if err != nil {
		return err
	}
	if current.CurrentSourceVersion != expected.SourceVersion || current.ETag != expected.LocaleETag {
		return translation.ErrConflict
	}

	now := normalizeTime(r.clock())
	err = saveTalkTranslationWithExecer(ctx, tx, talkID, locale, current.CurrentSourceVersion, TalkTranslationInput{
		Title:          generated.Title,
		Slug:           generated.Slug,
		Summary:        generated.Summary,
		EventName:      generated.EventName,
		SEOTitle:       generated.SEOTitle,
		SEODescription: generated.SEODescription,
	}, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func generateTalkTranslationHandler(repo *Repository, generator ContentTranslationGenerator) http.HandlerFunc {
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
		start, source, err := repo.LoadTalkTranslationGeneration(req.Context(), id, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate talk translation")
			return
		}
		generated, err := generator.GenerateTalk(req.Context(), source, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate talk translation")
			return
		}
		err = repo.SaveGeneratedTalkTranslation(req.Context(), id, locale, start, generated)
		writeTranslationResult(w, err, "Could not generate talk translation")
	}
}

func (r *Repository) SaveExperienceTranslation(ctx context.Context, experienceID int64, locale i18n.Locale, input ExperienceTranslationInput, ifMatch string, ifNoneMatch string) error {
	current, err := r.experienceTranslationSnapshot(ctx, experienceID, locale)
	if err != nil {
		return err
	}
	switch {
	case !current.Exists && ifNoneMatch != "*":
		return ErrPreconditionRequired
	case current.Exists && current.ETag != ifMatch:
		return ErrConflict
	}
	return r.saveExperienceTranslation(ctx, experienceID, locale, current.CurrentSourceVersion, input)
}

func (r *Repository) MarkExperienceTranslationReviewed(ctx context.Context, experienceID int64, locale i18n.Locale, ifMatch string) error {
	return markResourceTranslationReviewed(ctx, r.db, "experiences", "experience_translations", "experience_id", experienceID, locale, ifMatch, r.clock)
}

func (r *Repository) experienceTranslationSnapshot(ctx context.Context, experienceID int64, locale i18n.Locale) (translationSnapshot, error) {
	return translationSnapshotForResource(ctx, r.db, "experiences", "experience_translations", "experience_id", experienceID, locale, false)
}

func experienceTranslationSnapshotTx(ctx context.Context, tx *sql.Tx, experienceID int64, locale i18n.Locale) (translationSnapshot, error) {
	return translationSnapshotForResource(ctx, tx, "experiences", "experience_translations", "experience_id", experienceID, locale, true)
}

func (r *Repository) saveExperienceTranslation(ctx context.Context, experienceID int64, locale i18n.Locale, sourceVersion int64, input ExperienceTranslationInput) error {
	return saveExperienceTranslationWithExecer(ctx, r.db, experienceID, locale, sourceVersion, input, normalizeTime(r.clock()))
}

func saveExperienceTranslationWithExecer(ctx context.Context, execer sqlExecer, experienceID int64, locale i18n.Locale, sourceVersion int64, input ExperienceTranslationInput, now time.Time) error {
	_, err := execer.ExecContext(ctx, `
		INSERT INTO experience_translations
			(experience_id, locale, translation_status, source_version, period, title, organization, description, translated_at, updated_at)
		VALUES
			($1, $2, 'ai_draft', $3, $4, $5, $6, $7, NULL, $8)
		ON CONFLICT (experience_id, locale) DO UPDATE SET
			translation_status = 'ai_draft',
			source_version = EXCLUDED.source_version,
			period = EXCLUDED.period,
			title = EXCLUDED.title,
			organization = EXCLUDED.organization,
			description = EXCLUDED.description,
			translated_at = NULL,
			updated_at = EXCLUDED.updated_at
	`, experienceID, locale, sourceVersion, input.Period, input.Title, input.Organization, input.Description, now)
	return err
}

func saveExperienceTranslationHandler(repo *Repository) http.HandlerFunc {
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
		var input ExperienceTranslationInput
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			httpserver.WriteError(w, http.StatusBadRequest, "validation_error", "Invalid experience translation payload", nil)
			return
		}
		err = repo.SaveExperienceTranslation(req.Context(), id, locale, input, req.Header.Get("If-Match"), req.Header.Get("If-None-Match"))
		writeTranslationResult(w, err, "Could not save experience translation")
	}
}

func reviewExperienceTranslationHandler(repo *Repository) http.HandlerFunc {
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
		err = repo.MarkExperienceTranslationReviewed(req.Context(), id, locale, req.Header.Get("If-Match"))
		writeTranslationResult(w, err, "Could not review experience translation")
	}
}

func (r *Repository) LoadExperienceTranslationGeneration(ctx context.Context, experienceID int64, locale i18n.Locale) (translation.TranslationSnapshot, translation.ExperienceTranslationSource, error) {
	var (
		snapshot      translation.TranslationSnapshot
		source        translation.ExperienceTranslationSource
		translationTS sql.NullTime
	)
	err := r.db.QueryRowContext(ctx, `
		SELECT
			experiences.translation_source_version,
			translations.updated_at,
			experiences.period,
			experiences.title,
			experiences.organization,
			experiences.description
		FROM experiences
		LEFT JOIN experience_translations translations
		  ON translations.experience_id = experiences.id
		 AND translations.locale = $2
		WHERE experiences.id = $1
	`, experienceID, locale).Scan(
		&snapshot.SourceVersion,
		&translationTS,
		&source.Period,
		&source.Title,
		&source.Organization,
		&source.Description,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return translation.TranslationSnapshot{}, translation.ExperienceTranslationSource{}, ErrNotFound
		}
		return translation.TranslationSnapshot{}, translation.ExperienceTranslationSource{}, err
	}
	if translationTS.Valid {
		snapshot.LocaleETag = translationETag(translationTS.Time)
	}
	return snapshot, source, nil
}

func (r *Repository) SaveGeneratedExperienceTranslation(ctx context.Context, experienceID int64, locale i18n.Locale, expected translation.TranslationSnapshot, generated translation.GeneratedExperienceTranslation) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	current, err := experienceTranslationSnapshotTx(ctx, tx, experienceID, locale)
	if err != nil {
		return err
	}
	if current.CurrentSourceVersion != expected.SourceVersion || current.ETag != expected.LocaleETag {
		return translation.ErrConflict
	}

	now := normalizeTime(r.clock())
	err = saveExperienceTranslationWithExecer(ctx, tx, experienceID, locale, current.CurrentSourceVersion, ExperienceTranslationInput{
		Period:       generated.Period,
		Title:        generated.Title,
		Organization: generated.Organization,
		Description:  generated.Description,
	}, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func generateExperienceTranslationHandler(repo *Repository, generator ContentTranslationGenerator) http.HandlerFunc {
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
		start, source, err := repo.LoadExperienceTranslationGeneration(req.Context(), id, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate experience translation")
			return
		}
		generated, err := generator.GenerateExperience(req.Context(), source, locale)
		if err != nil {
			writeTranslationResult(w, err, "Could not generate experience translation")
			return
		}
		err = repo.SaveGeneratedExperienceTranslation(req.Context(), id, locale, start, generated)
		writeTranslationResult(w, err, "Could not generate experience translation")
	}
}
