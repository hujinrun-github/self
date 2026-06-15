package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type Repository struct {
	db    *sql.DB
	clock func() time.Time
}

type ProjectInput struct {
	Title          string     `json:"title"`
	Slug           string     `json:"slug"`
	Summary        string     `json:"summary"`
	ContentMD      string     `json:"content_md"`
	CoverMediaID   *int64     `json:"cover_media_id"`
	DemoURL        string     `json:"demo_url"`
	RepoURL        string     `json:"repo_url"`
	SEOTitle       string     `json:"seo_title"`
	SEODescription string     `json:"seo_description"`
	OGImageMediaID *int64     `json:"og_image_media_id"`
	Featured       bool       `json:"featured"`
	PublishedAt    *time.Time `json:"published_at"`
	Techs          []string   `json:"techs"`
}

type Project struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Slug        string     `json:"slug"`
	Summary     string     `json:"summary"`
	ContentMD   string     `json:"content_md"`
	Status      Status     `json:"status"`
	Featured    bool       `json:"featured"`
	SortOrder   int        `json:"sort_order"`
	PublishedAt *time.Time `json:"published_at"`
	Techs       []Term     `json:"techs"`
}

type Term struct {
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	SortOrder int    `json:"sort_order"`
}

func NewRepository(database *sql.DB) *Repository {
	return &Repository{db: database, clock: func() time.Time { return time.Now().UTC() }}
}

func (r *Repository) CreateProject(ctx context.Context, input ProjectInput) (Project, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback()

	slug, err := r.uniqueSlug(ctx, tx, "projects", 0, chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return Project{}, err
	}
	now := formatTime(r.clock())
	sortOrder, err := nextSortOrder(ctx, tx, "projects")
	if err != nil {
		return Project{}, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO projects (title, slug, summary, content_md, cover_media_id, demo_url, repo_url, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.Title,
		slug,
		input.Summary,
		input.ContentMD,
		input.CoverMediaID,
		input.DemoURL,
		input.RepoURL,
		input.SEOTitle,
		input.SEODescription,
		input.OGImageMediaID,
		StatusDraft,
		boolInt(input.Featured),
		sortOrder,
		timePtrString(input.PublishedAt),
		now,
		now,
	)
	if err != nil {
		return Project{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Project{}, err
	}
	if err := r.replaceProjectTechs(ctx, tx, id, input.Techs); err != nil {
		return Project{}, err
	}
	if err := tx.Commit(); err != nil {
		return Project{}, err
	}
	return r.GetProject(ctx, id)
}

func (r *Repository) UpdateProject(ctx context.Context, id int64, input ProjectInput) (Project, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback()

	var currentSlug string
	var status Status
	if err := tx.QueryRowContext(ctx, `SELECT slug, status FROM projects WHERE id = ?`, id).Scan(&currentSlug, &status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Project{}, ErrNotFound
		}
		return Project{}, err
	}
	nextSlug := currentSlug
	if input.Slug != "" || input.Title != "" {
		candidateInput := chooseSlugInput(input.Slug, input.Title)
		if candidateInput != "" {
			candidate, err := Slugify(candidateInput)
			if err != nil {
				return Project{}, err
			}
			if status != StatusDraft && candidate != currentSlug {
				return Project{}, ErrImmutableSlug
			}
			if status == StatusDraft && candidate != currentSlug {
				nextSlug, err = r.uniqueSlug(ctx, tx, "projects", id, candidate)
				if err != nil {
					return Project{}, err
				}
			}
		}
	}

	now := formatTime(r.clock())
	_, err = tx.ExecContext(ctx, `UPDATE projects SET title = ?, slug = ?, summary = ?, content_md = ?, cover_media_id = ?, demo_url = ?, repo_url = ?, seo_title = ?, seo_description = ?, og_image_media_id = ?, featured = ?, published_at = COALESCE(?, published_at), updated_at = ? WHERE id = ?`,
		input.Title,
		nextSlug,
		input.Summary,
		input.ContentMD,
		input.CoverMediaID,
		input.DemoURL,
		input.RepoURL,
		input.SEOTitle,
		input.SEODescription,
		input.OGImageMediaID,
		boolInt(input.Featured),
		timePtrString(input.PublishedAt),
		now,
		id,
	)
	if err != nil {
		return Project{}, err
	}
	if err := r.replaceProjectTechs(ctx, tx, id, input.Techs); err != nil {
		return Project{}, err
	}
	if err := tx.Commit(); err != nil {
		return Project{}, err
	}
	return r.GetProject(ctx, id)
}

func (r *Repository) GetProject(ctx context.Context, id int64) (Project, error) {
	var project Project
	var publishedAt sql.NullString
	var featured int
	err := r.db.QueryRowContext(ctx, `SELECT id, title, slug, summary, content_md, status, featured, sort_order, published_at FROM projects WHERE id = ?`, id).
		Scan(&project.ID, &project.Title, &project.Slug, &project.Summary, &project.ContentMD, &project.Status, &featured, &project.SortOrder, &publishedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Project{}, ErrNotFound
		}
		return Project{}, err
	}
	project.Featured = featured == 1
	if publishedAt.Valid {
		parsed, err := parseTime(publishedAt.String)
		if err != nil {
			return Project{}, err
		}
		project.PublishedAt = &parsed
	}
	techs, err := r.projectTechs(ctx, id)
	if err != nil {
		return Project{}, err
	}
	project.Techs = techs
	return project, nil
}

func (r *Repository) SetProjectStatus(ctx context.Context, id int64, status Status, publishedAt *time.Time) error {
	return r.setRoutableStatus(ctx, "projects", id, status, publishedAt)
}

func (r *Repository) DeleteProject(ctx context.Context, id int64) error {
	var status Status
	var publishedAt sql.NullString
	if err := r.db.QueryRowContext(ctx, `SELECT status, published_at FROM projects WHERE id = ?`, id).Scan(&status, &publishedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != StatusDraft || publishedAt.Valid {
		return ErrDeleteBlocked
	}
	_, err := r.db.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, id)
	return err
}

func (r *Repository) PublicProjects(ctx context.Context, limit int) ([]Project, error) {
	if limit <= 0 {
		limit = 12
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM projects WHERE status = ? AND published_at <= ? ORDER BY published_at DESC, sort_order ASC LIMIT ?`, StatusPublished, formatTime(r.clock()), limit)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	projects := make([]Project, 0, len(ids))
	for _, id := range ids {
		project, err := r.GetProject(ctx, id)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, nil
}

func (r *Repository) ReorderProjects(ctx context.Context, orderedIDs []int64) error {
	return reorder(ctx, r.db, "projects", orderedIDs)
}

func (r *Repository) uniqueSlug(ctx context.Context, tx *sql.Tx, table string, excludeID int64, input string) (string, error) {
	base, err := Slugify(input)
	if err != nil {
		return "", err
	}
	candidate := base
	for suffix := 2; ; suffix++ {
		var count int
		query := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE slug = ? AND id <> ?`, table)
		if err := tx.QueryRowContext(ctx, query, candidate, excludeID).Scan(&count); err != nil {
			return "", err
		}
		if count == 0 {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s-%d", base, suffix)
		if len(candidate) > 80 {
			return "", ErrSlugTooLong
		}
	}
}

func chooseSlugInput(slug string, title string) string {
	if slug != "" {
		return slug
	}
	return title
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
