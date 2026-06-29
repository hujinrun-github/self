package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"portfolio/internal/i18n"
)

func (r *Repository) PublicProjectBySlug(ctx context.Context, slug string) (Project, error) {
	var id int64
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM projects WHERE slug = $1 AND status = $2 AND published_at <= $3`, slug, StatusPublished, normalizeTime(r.clock())).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Project{}, ErrNotFound
		}
		return Project{}, err
	}
	return r.GetProject(ctx, id)
}

func (r *Repository) PublicWriting(ctx context.Context, limit int) ([]Writing, error) {
	ids, err := r.publicIDs(ctx, "writings", limit)
	if err != nil {
		return nil, err
	}
	items := make([]Writing, 0, len(ids))
	for _, id := range ids {
		item, err := r.GetWriting(ctx, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) PublicProjectsByLocale(ctx context.Context, locale i18n.Locale, limit int) ([]Project, LocaleMeta, error) {
	if locale == i18n.LocaleZH {
		items, err := r.PublicProjects(ctx, limit)
		return items, LocaleMetaFor(locale, i18n.LocaleZH), err
	}
	ids, err := r.publicTranslatedIDs(ctx, "projects", locale, limit)
	if err != nil {
		return nil, LocaleMeta{}, err
	}
	items := make([]Project, 0, len(ids))
	for _, id := range ids {
		project, err := r.GetProject(ctx, id)
		if err != nil {
			return nil, LocaleMeta{}, err
		}
		translation, err := r.getProjectTranslation(ctx, id, locale)
		if err != nil {
			return nil, LocaleMeta{}, err
		}
		items = append(items, localizeProject(project, translation))
	}
	return items, LocaleMetaFor(locale, locale), nil
}

func (r *Repository) PublicProjectByLocaleSlug(ctx context.Context, locale i18n.Locale, slug string) (Project, LocaleMeta, []AlternateRoute, error) {
	if locale == i18n.LocaleZH {
		project, err := r.PublicProjectBySlug(ctx, slug)
		if err != nil {
			return Project{}, LocaleMeta{}, nil, err
		}
		alternates, err := r.routableAlternates(ctx, "projects", project.ID, project.Slug, "projects")
		if err != nil {
			return Project{}, LocaleMeta{}, nil, err
		}
		return project, LocaleMetaFor(locale, i18n.LocaleZH), alternates, nil
	}

	id, err := r.publicTranslatedIDBySlug(ctx, "projects", locale, slug)
	if err != nil {
		return Project{}, LocaleMeta{}, nil, err
	}
	project, err := r.GetProject(ctx, id)
	if err != nil {
		return Project{}, LocaleMeta{}, nil, err
	}
	translation, err := r.getProjectTranslation(ctx, id, locale)
	if err != nil {
		return Project{}, LocaleMeta{}, nil, err
	}
	alternates, err := r.routableAlternates(ctx, "projects", project.ID, project.Slug, "projects")
	if err != nil {
		return Project{}, LocaleMeta{}, nil, err
	}
	return localizeProject(project, translation), LocaleMetaFor(locale, locale), alternates, nil
}

func (r *Repository) PublicWritingBySlug(ctx context.Context, slug string) (Writing, error) {
	var id int64
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM writings WHERE slug = $1 AND status = $2 AND published_at <= $3`, slug, StatusPublished, normalizeTime(r.clock())).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Writing{}, ErrNotFound
		}
		return Writing{}, err
	}
	return r.GetWriting(ctx, id)
}

func (r *Repository) PublicWritingByLocale(ctx context.Context, locale i18n.Locale, limit int) ([]Writing, LocaleMeta, error) {
	if locale == i18n.LocaleZH {
		items, err := r.PublicWriting(ctx, limit)
		return items, LocaleMetaFor(locale, i18n.LocaleZH), err
	}
	ids, err := r.publicTranslatedIDs(ctx, "writings", locale, limit)
	if err != nil {
		return nil, LocaleMeta{}, err
	}
	items := make([]Writing, 0, len(ids))
	for _, id := range ids {
		writing, err := r.GetWriting(ctx, id)
		if err != nil {
			return nil, LocaleMeta{}, err
		}
		translation, err := r.getWritingTranslation(ctx, id, locale)
		if err != nil {
			return nil, LocaleMeta{}, err
		}
		items = append(items, localizeWriting(writing, translation))
	}
	return items, LocaleMetaFor(locale, locale), nil
}

func (r *Repository) PublicWritingByLocaleSlug(ctx context.Context, locale i18n.Locale, slug string) (Writing, LocaleMeta, []AlternateRoute, error) {
	var (
		writing    Writing
		meta       LocaleMeta
		alternates []AlternateRoute
		err        error
	)
	if locale == i18n.LocaleZH {
		writing, err = r.PublicWritingBySlug(ctx, slug)
		if err != nil {
			return Writing{}, LocaleMeta{}, nil, err
		}
		alternates, err = r.routableAlternates(ctx, "writings", writing.ID, writing.Slug, "writing")
		if err != nil {
			return Writing{}, LocaleMeta{}, nil, err
		}
		meta = LocaleMetaFor(locale, i18n.LocaleZH)
	} else {
		var id int64
		id, err = r.publicTranslatedIDBySlug(ctx, "writings", locale, slug)
		if err != nil {
			return Writing{}, LocaleMeta{}, nil, err
		}
		writing, err = r.GetWriting(ctx, id)
		if err != nil {
			return Writing{}, LocaleMeta{}, nil, err
		}
		translation, err := r.getWritingTranslation(ctx, id, locale)
		if err != nil {
			return Writing{}, LocaleMeta{}, nil, err
		}
		alternates, err = r.routableAlternates(ctx, "writings", writing.ID, writing.Slug, "writing")
		if err != nil {
			return Writing{}, LocaleMeta{}, nil, err
		}
		writing = localizeWriting(writing, translation)
		meta = LocaleMetaFor(locale, locale)
	}

	writing.Media, err = r.buildMediaMap(ctx, writing.ContentMD)
	if err != nil {
		return Writing{}, LocaleMeta{}, nil, err
	}
	return writing, meta, alternates, nil
}

func (r *Repository) PublicTalks(ctx context.Context, limit int) ([]Talk, error) {
	ids, err := r.publicIDs(ctx, "talks", limit)
	if err != nil {
		return nil, err
	}
	items := make([]Talk, 0, len(ids))
	for _, id := range ids {
		item, err := r.GetTalk(ctx, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) PublicTalkBySlug(ctx context.Context, slug string) (Talk, error) {
	var id int64
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM talks WHERE slug = $1 AND status = $2 AND published_at <= $3`, slug, StatusPublished, normalizeTime(r.clock())).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Talk{}, ErrNotFound
		}
		return Talk{}, err
	}
	return r.GetTalk(ctx, id)
}

func (r *Repository) PublicTalksByLocale(ctx context.Context, locale i18n.Locale, limit int) ([]Talk, LocaleMeta, error) {
	if locale == i18n.LocaleZH {
		items, err := r.PublicTalks(ctx, limit)
		return items, LocaleMetaFor(locale, i18n.LocaleZH), err
	}
	ids, err := r.publicTranslatedIDs(ctx, "talks", locale, limit)
	if err != nil {
		return nil, LocaleMeta{}, err
	}
	items := make([]Talk, 0, len(ids))
	for _, id := range ids {
		talk, err := r.GetTalk(ctx, id)
		if err != nil {
			return nil, LocaleMeta{}, err
		}
		translation, err := r.getTalkTranslation(ctx, id, locale)
		if err != nil {
			return nil, LocaleMeta{}, err
		}
		items = append(items, localizeTalk(talk, translation))
	}
	return items, LocaleMetaFor(locale, locale), nil
}

func (r *Repository) PublicTalkByLocaleSlug(ctx context.Context, locale i18n.Locale, slug string) (Talk, LocaleMeta, []AlternateRoute, error) {
	if locale == i18n.LocaleZH {
		talk, err := r.PublicTalkBySlug(ctx, slug)
		if err != nil {
			return Talk{}, LocaleMeta{}, nil, err
		}
		alternates, err := r.routableAlternates(ctx, "talks", talk.ID, talk.Slug, "talks")
		if err != nil {
			return Talk{}, LocaleMeta{}, nil, err
		}
		return talk, LocaleMetaFor(locale, i18n.LocaleZH), alternates, nil
	}

	id, err := r.publicTranslatedIDBySlug(ctx, "talks", locale, slug)
	if err != nil {
		return Talk{}, LocaleMeta{}, nil, err
	}
	talk, err := r.GetTalk(ctx, id)
	if err != nil {
		return Talk{}, LocaleMeta{}, nil, err
	}
	translation, err := r.getTalkTranslation(ctx, id, locale)
	if err != nil {
		return Talk{}, LocaleMeta{}, nil, err
	}
	alternates, err := r.routableAlternates(ctx, "talks", talk.ID, talk.Slug, "talks")
	if err != nil {
		return Talk{}, LocaleMeta{}, nil, err
	}
	return localizeTalk(talk, translation), LocaleMetaFor(locale, locale), alternates, nil
}

func (r *Repository) publicIDs(ctx context.Context, table string, limit int) ([]int64, error) {
	if !publicTableAllowed(table) {
		return nil, fmt.Errorf("unknown public table %s", table)
	}
	if limit <= 0 {
		limit = 12
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM `+table+` WHERE status = $1 AND published_at <= $2 ORDER BY published_at DESC, sort_order ASC LIMIT $3`, StatusPublished, normalizeTime(r.clock()), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func publicTableAllowed(table string) bool {
	switch table {
	case "writings", "talks":
		return true
	default:
		return false
	}
}

type projectTranslation struct {
	Title     string
	Slug      string
	Summary   string
	ContentMD string
}

type writingTranslation struct {
	Title     string
	Slug      string
	Excerpt   string
	ContentMD string
}

type talkTranslation struct {
	Title     string
	Slug      string
	Summary   string
	EventName string
}

func (r *Repository) publicTranslatedIDs(ctx context.Context, sourceTable string, locale i18n.Locale, limit int) ([]int64, error) {
	if !localizedRoutableTableAllowed(sourceTable) {
		return nil, fmt.Errorf("unknown localized table %s", sourceTable)
	}
	if limit <= 0 {
		limit = 12
	}
	translationTable := translationTableFor(sourceTable)
	sourceColumn := translationSourceColumn(sourceTable)
	query := fmt.Sprintf(`
		SELECT source.id
		FROM %s source
		JOIN %s translation
		  ON translation.%s = source.id
		 AND translation.locale = $1
		 AND translation.translation_status = 'reviewed'
		 AND translation.source_version = source.translation_source_version
		WHERE source.status = $2
		  AND source.published_at <= $3
		ORDER BY source.published_at DESC, source.sort_order ASC
		LIMIT $4
	`, sourceTable, translationTable, sourceColumn)
	rows, err := r.db.QueryContext(ctx, query, locale, StatusPublished, normalizeTime(r.clock()), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *Repository) publicTranslatedIDBySlug(ctx context.Context, sourceTable string, locale i18n.Locale, slug string) (int64, error) {
	if !localizedRoutableTableAllowed(sourceTable) {
		return 0, fmt.Errorf("unknown localized table %s", sourceTable)
	}
	translationTable := translationTableFor(sourceTable)
	sourceColumn := translationSourceColumn(sourceTable)
	query := fmt.Sprintf(`
		SELECT source.id
		FROM %s source
		JOIN %s translation
		  ON translation.%s = source.id
		 AND translation.locale = $1
		 AND translation.translation_status = 'reviewed'
		 AND translation.source_version = source.translation_source_version
		WHERE source.status = $2
		  AND source.published_at <= $3
		  AND translation.slug = $4
	`, sourceTable, translationTable, sourceColumn)
	var id int64
	if err := r.db.QueryRowContext(ctx, query, locale, StatusPublished, normalizeTime(r.clock()), slug).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return id, nil
}

func (r *Repository) getProjectTranslation(ctx context.Context, projectID int64, locale i18n.Locale) (projectTranslation, error) {
	var translation projectTranslation
	err := r.db.QueryRowContext(ctx, `
		SELECT title, slug, summary, content_md
		FROM project_translations
		WHERE project_id = $1
		  AND locale = $2
		  AND translation_status = 'reviewed'
		  AND source_version = (SELECT translation_source_version FROM projects WHERE id = $1)
	`, projectID, locale).Scan(&translation.Title, &translation.Slug, &translation.Summary, &translation.ContentMD)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return projectTranslation{}, ErrNotFound
		}
		return projectTranslation{}, err
	}
	return translation, nil
}

func (r *Repository) getWritingTranslation(ctx context.Context, writingID int64, locale i18n.Locale) (writingTranslation, error) {
	var translation writingTranslation
	err := r.db.QueryRowContext(ctx, `
		SELECT title, slug, excerpt, content_md
		FROM writing_translations
		WHERE writing_id = $1
		  AND locale = $2
		  AND translation_status = 'reviewed'
		  AND source_version = (SELECT translation_source_version FROM writings WHERE id = $1)
	`, writingID, locale).Scan(&translation.Title, &translation.Slug, &translation.Excerpt, &translation.ContentMD)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return writingTranslation{}, ErrNotFound
		}
		return writingTranslation{}, err
	}
	return translation, nil
}

func (r *Repository) getTalkTranslation(ctx context.Context, talkID int64, locale i18n.Locale) (talkTranslation, error) {
	var translation talkTranslation
	err := r.db.QueryRowContext(ctx, `
		SELECT title, slug, summary, event_name
		FROM talk_translations
		WHERE talk_id = $1
		  AND locale = $2
		  AND translation_status = 'reviewed'
		  AND source_version = (SELECT translation_source_version FROM talks WHERE id = $1)
	`, talkID, locale).Scan(&translation.Title, &translation.Slug, &translation.Summary, &translation.EventName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return talkTranslation{}, ErrNotFound
		}
		return talkTranslation{}, err
	}
	return translation, nil
}

func localizeProject(project Project, translation projectTranslation) Project {
	project.Title = translation.Title
	project.Slug = translation.Slug
	project.Summary = translation.Summary
	project.ContentMD = translation.ContentMD
	return project
}

func localizeWriting(writing Writing, translation writingTranslation) Writing {
	writing.Title = translation.Title
	writing.Slug = translation.Slug
	writing.Excerpt = translation.Excerpt
	writing.ContentMD = translation.ContentMD
	return writing
}

func localizeTalk(talk Talk, translation talkTranslation) Talk {
	talk.Title = translation.Title
	talk.Slug = translation.Slug
	talk.Summary = translation.Summary
	talk.EventName = translation.EventName
	return talk
}

func (r *Repository) routableAlternates(ctx context.Context, sourceTable string, sourceID int64, sourceSlug string, resourcePath string) ([]AlternateRoute, error) {
	if !localizedRoutableTableAllowed(sourceTable) {
		return nil, fmt.Errorf("unknown localized table %s", sourceTable)
	}
	alternates := []AlternateRoute{sourceAlternate(resourcePath, sourceSlug)}
	query := fmt.Sprintf(`
		SELECT locale, slug
		FROM %s
		WHERE %s = $1
		  AND translation_status = 'reviewed'
		  AND source_version = (SELECT translation_source_version FROM %s WHERE id = $1)
		ORDER BY locale
	`, translationTableFor(sourceTable), translationSourceColumn(sourceTable), sourceTable)
	rows, err := r.db.QueryContext(ctx, query, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var localeText string
		var slug string
		if err := rows.Scan(&localeText, &slug); err != nil {
			return nil, err
		}
		locale, err := i18n.ParseTranslationLocale(localeText)
		if err != nil {
			return nil, err
		}
		alternates = append(alternates, translationAlternate(locale, resourcePath, slug))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return alternates, nil
}

func localizedRoutableTableAllowed(sourceTable string) bool {
	switch sourceTable {
	case "projects", "talks", "writings":
		return true
	default:
		return false
	}
}

func translationTableFor(sourceTable string) string {
	switch sourceTable {
	case "projects":
		return "project_translations"
	case "writings":
		return "writing_translations"
	default:
		return "talk_translations"
	}
}

func translationSourceColumn(sourceTable string) string {
	switch sourceTable {
	case "projects":
		return "project_id"
	case "writings":
		return "writing_id"
	default:
		return "talk_id"
	}
}
