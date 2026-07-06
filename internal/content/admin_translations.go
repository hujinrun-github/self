package content

import (
	"context"
	"database/sql"

	"portfolio/internal/i18n"
)

type ProjectTranslationAdminDTO struct {
	ContentMD         string  `json:"content_md"`
	ETag              *string `json:"etag"`
	Exists            bool    `json:"exists"`
	SEODescription    string  `json:"seo_description"`
	SEOTitle          string  `json:"seo_title"`
	Slug              string  `json:"slug"`
	SourceVersion     int64   `json:"source_version"`
	Stale             bool    `json:"stale"`
	Summary           string  `json:"summary"`
	Title             string  `json:"title"`
	TranslationStatus string  `json:"translation_status"`
}

type ProjectAdminDTO struct {
	Project
	Translations map[string]ProjectTranslationAdminDTO `json:"translations"`
}

type WritingTranslationAdminDTO struct {
	ContentMD         string  `json:"content_md"`
	ETag              *string `json:"etag"`
	Exists            bool    `json:"exists"`
	Excerpt           string  `json:"excerpt"`
	SEODescription    string  `json:"seo_description"`
	SEOTitle          string  `json:"seo_title"`
	Slug              string  `json:"slug"`
	SourceVersion     int64   `json:"source_version"`
	Stale             bool    `json:"stale"`
	Title             string  `json:"title"`
	TranslationStatus string  `json:"translation_status"`
}

type WritingAdminDTO struct {
	Writing
	Translations map[string]WritingTranslationAdminDTO `json:"translations"`
}

type TalkTranslationAdminDTO struct {
	ETag              *string `json:"etag"`
	EventName         string  `json:"event_name"`
	Exists            bool    `json:"exists"`
	SEODescription    string  `json:"seo_description"`
	SEOTitle          string  `json:"seo_title"`
	Slug              string  `json:"slug"`
	SourceVersion     int64   `json:"source_version"`
	Stale             bool    `json:"stale"`
	Summary           string  `json:"summary"`
	Title             string  `json:"title"`
	TranslationStatus string  `json:"translation_status"`
}

type TalkAdminDTO struct {
	Talk
	Translations map[string]TalkTranslationAdminDTO `json:"translations"`
}

type ExperienceTranslationAdminDTO struct {
	Description       string  `json:"description"`
	ETag              *string `json:"etag"`
	Exists            bool    `json:"exists"`
	Organization      string  `json:"organization"`
	Period            string  `json:"period"`
	SourceVersion     int64   `json:"source_version"`
	Stale             bool    `json:"stale"`
	Title             string  `json:"title"`
	TranslationStatus string  `json:"translation_status"`
}

type ExperienceAdminDTO struct {
	Experience
	Translations map[string]ExperienceTranslationAdminDTO `json:"translations"`
}

func (r *Repository) GetProjectAdmin(ctx context.Context, id int64) (ProjectAdminDTO, error) {
	project, err := r.GetProject(ctx, id)
	if err != nil {
		return ProjectAdminDTO{}, err
	}

	var currentSourceVersion int64
	if err := r.db.QueryRowContext(ctx, `SELECT translation_source_version FROM projects WHERE id = $1`, id).Scan(&currentSourceVersion); err != nil {
		if err == sql.ErrNoRows {
			return ProjectAdminDTO{}, ErrNotFound
		}
		return ProjectAdminDTO{}, err
	}

	return ProjectAdminDTO{
		Project:      project,
		Translations: r.projectAdminTranslations(ctx, id, currentSourceVersion),
	}, nil
}

func (r *Repository) projectAdminTranslations(ctx context.Context, projectID int64, currentSourceVersion int64) map[string]ProjectTranslationAdminDTO {
	translations := map[string]ProjectTranslationAdminDTO{
		string(i18n.LocaleEN): emptyProjectTranslationAdmin(currentSourceVersion),
		string(i18n.LocaleJA): emptyProjectTranslationAdmin(currentSourceVersion),
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT locale, translation_status, source_version, title, slug, summary, content_md, seo_title, seo_description, updated_at
		FROM project_translations
		WHERE project_id = $1
	`, projectID)
	if err != nil {
		return translations
	}
	defer rows.Close()

	for rows.Next() {
		var (
			locale         string
			state          ProjectTranslationAdminDTO
			seoTitle       sql.NullString
			seoDescription sql.NullString
			updatedAt      sql.NullTime
		)
		if err := rows.Scan(
			&locale,
			&state.TranslationStatus,
			&state.SourceVersion,
			&state.Title,
			&state.Slug,
			&state.Summary,
			&state.ContentMD,
			&seoTitle,
			&seoDescription,
			&updatedAt,
		); err != nil {
			continue
		}
		state.Exists = true
		state.Stale = state.SourceVersion != currentSourceVersion
		if seoTitle.Valid {
			state.SEOTitle = seoTitle.String
		}
		if seoDescription.Valid {
			state.SEODescription = seoDescription.String
		}
		if updatedAt.Valid {
			etag := translationETag(updatedAt.Time)
			state.ETag = &etag
		}
		translations[locale] = state
	}
	return translations
}

func emptyProjectTranslationAdmin(currentSourceVersion int64) ProjectTranslationAdminDTO {
	return ProjectTranslationAdminDTO{
		Exists:            false,
		SourceVersion:     currentSourceVersion,
		Stale:             false,
		TranslationStatus: "empty",
	}
}

func (r *Repository) GetWritingAdmin(ctx context.Context, id int64) (WritingAdminDTO, error) {
	writing, err := r.GetWriting(ctx, id)
	if err != nil {
		return WritingAdminDTO{}, err
	}
	var currentSourceVersion int64
	if err := r.db.QueryRowContext(ctx, `SELECT translation_source_version FROM writings WHERE id = $1`, id).Scan(&currentSourceVersion); err != nil {
		if err == sql.ErrNoRows {
			return WritingAdminDTO{}, ErrNotFound
		}
		return WritingAdminDTO{}, err
	}
	return WritingAdminDTO{
		Writing:      writing,
		Translations: r.writingAdminTranslations(ctx, id, currentSourceVersion),
	}, nil
}

func (r *Repository) writingAdminTranslations(ctx context.Context, writingID int64, currentSourceVersion int64) map[string]WritingTranslationAdminDTO {
	translations := map[string]WritingTranslationAdminDTO{
		string(i18n.LocaleEN): emptyWritingTranslationAdmin(currentSourceVersion),
		string(i18n.LocaleJA): emptyWritingTranslationAdmin(currentSourceVersion),
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT locale, translation_status, source_version, title, slug, excerpt, content_md, seo_title, seo_description, updated_at
		FROM writing_translations
		WHERE writing_id = $1
	`, writingID)
	if err != nil {
		return translations
	}
	defer rows.Close()

	for rows.Next() {
		var (
			locale         string
			state          WritingTranslationAdminDTO
			seoTitle       sql.NullString
			seoDescription sql.NullString
			updatedAt      sql.NullTime
		)
		if err := rows.Scan(
			&locale,
			&state.TranslationStatus,
			&state.SourceVersion,
			&state.Title,
			&state.Slug,
			&state.Excerpt,
			&state.ContentMD,
			&seoTitle,
			&seoDescription,
			&updatedAt,
		); err != nil {
			continue
		}
		state.Exists = true
		state.Stale = state.SourceVersion != currentSourceVersion
		if seoTitle.Valid {
			state.SEOTitle = seoTitle.String
		}
		if seoDescription.Valid {
			state.SEODescription = seoDescription.String
		}
		if updatedAt.Valid {
			etag := translationETag(updatedAt.Time)
			state.ETag = &etag
		}
		translations[locale] = state
	}
	return translations
}

func emptyWritingTranslationAdmin(currentSourceVersion int64) WritingTranslationAdminDTO {
	return WritingTranslationAdminDTO{
		Exists:            false,
		SourceVersion:     currentSourceVersion,
		Stale:             false,
		TranslationStatus: "empty",
	}
}

func (r *Repository) GetTalkAdmin(ctx context.Context, id int64) (TalkAdminDTO, error) {
	talk, err := r.GetTalk(ctx, id)
	if err != nil {
		return TalkAdminDTO{}, err
	}
	var currentSourceVersion int64
	if err := r.db.QueryRowContext(ctx, `SELECT translation_source_version FROM talks WHERE id = $1`, id).Scan(&currentSourceVersion); err != nil {
		if err == sql.ErrNoRows {
			return TalkAdminDTO{}, ErrNotFound
		}
		return TalkAdminDTO{}, err
	}
	return TalkAdminDTO{
		Talk:         talk,
		Translations: r.talkAdminTranslations(ctx, id, currentSourceVersion),
	}, nil
}

func (r *Repository) talkAdminTranslations(ctx context.Context, talkID int64, currentSourceVersion int64) map[string]TalkTranslationAdminDTO {
	translations := map[string]TalkTranslationAdminDTO{
		string(i18n.LocaleEN): emptyTalkTranslationAdmin(currentSourceVersion),
		string(i18n.LocaleJA): emptyTalkTranslationAdmin(currentSourceVersion),
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT locale, translation_status, source_version, title, slug, summary, event_name, seo_title, seo_description, updated_at
		FROM talk_translations
		WHERE talk_id = $1
	`, talkID)
	if err != nil {
		return translations
	}
	defer rows.Close()

	for rows.Next() {
		var (
			locale         string
			state          TalkTranslationAdminDTO
			seoTitle       sql.NullString
			seoDescription sql.NullString
			updatedAt      sql.NullTime
		)
		if err := rows.Scan(
			&locale,
			&state.TranslationStatus,
			&state.SourceVersion,
			&state.Title,
			&state.Slug,
			&state.Summary,
			&state.EventName,
			&seoTitle,
			&seoDescription,
			&updatedAt,
		); err != nil {
			continue
		}
		state.Exists = true
		state.Stale = state.SourceVersion != currentSourceVersion
		if seoTitle.Valid {
			state.SEOTitle = seoTitle.String
		}
		if seoDescription.Valid {
			state.SEODescription = seoDescription.String
		}
		if updatedAt.Valid {
			etag := translationETag(updatedAt.Time)
			state.ETag = &etag
		}
		translations[locale] = state
	}
	return translations
}

func emptyTalkTranslationAdmin(currentSourceVersion int64) TalkTranslationAdminDTO {
	return TalkTranslationAdminDTO{
		Exists:            false,
		SourceVersion:     currentSourceVersion,
		Stale:             false,
		TranslationStatus: "empty",
	}
}

func (r *Repository) GetExperienceAdmin(ctx context.Context, id int64) (ExperienceAdminDTO, error) {
	experience, err := r.GetExperience(ctx, id)
	if err != nil {
		return ExperienceAdminDTO{}, err
	}
	var currentSourceVersion int64
	if err := r.db.QueryRowContext(ctx, `SELECT translation_source_version FROM experiences WHERE id = $1`, id).Scan(&currentSourceVersion); err != nil {
		if err == sql.ErrNoRows {
			return ExperienceAdminDTO{}, ErrNotFound
		}
		return ExperienceAdminDTO{}, err
	}
	return ExperienceAdminDTO{
		Experience:   experience,
		Translations: r.experienceAdminTranslations(ctx, id, currentSourceVersion),
	}, nil
}

func (r *Repository) experienceAdminTranslations(ctx context.Context, experienceID int64, currentSourceVersion int64) map[string]ExperienceTranslationAdminDTO {
	translations := map[string]ExperienceTranslationAdminDTO{
		string(i18n.LocaleEN): emptyExperienceTranslationAdmin(currentSourceVersion),
		string(i18n.LocaleJA): emptyExperienceTranslationAdmin(currentSourceVersion),
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT locale, translation_status, source_version, period, title, organization, description, updated_at
		FROM experience_translations
		WHERE experience_id = $1
	`, experienceID)
	if err != nil {
		return translations
	}
	defer rows.Close()

	for rows.Next() {
		var (
			locale    string
			state     ExperienceTranslationAdminDTO
			updatedAt sql.NullTime
		)
		if err := rows.Scan(
			&locale,
			&state.TranslationStatus,
			&state.SourceVersion,
			&state.Period,
			&state.Title,
			&state.Organization,
			&state.Description,
			&updatedAt,
		); err != nil {
			continue
		}
		state.Exists = true
		state.Stale = state.SourceVersion != currentSourceVersion
		if updatedAt.Valid {
			etag := translationETag(updatedAt.Time)
			state.ETag = &etag
		}
		translations[locale] = state
	}
	return translations
}

func emptyExperienceTranslationAdmin(currentSourceVersion int64) ExperienceTranslationAdminDTO {
	return ExperienceTranslationAdminDTO{
		Exists:            false,
		SourceVersion:     currentSourceVersion,
		Stale:             false,
		TranslationStatus: "empty",
	}
}
