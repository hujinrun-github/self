package content

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type WritingInput struct {
	Title          string     `json:"title"`
	Slug           string     `json:"slug"`
	Excerpt        string     `json:"excerpt"`
	ContentMD      string     `json:"content_md"`
	CoverMediaID   *int64     `json:"cover_media_id"`
	SEOTitle       string     `json:"seo_title"`
	SEODescription string     `json:"seo_description"`
	OGImageMediaID *int64     `json:"og_image_media_id"`
	Featured       bool       `json:"featured"`
	PublishedAt    *time.Time `json:"published_at"`
	Tags           []string   `json:"tags"`
}

type Writing struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Slug        string     `json:"slug"`
	Excerpt     string     `json:"excerpt"`
	ContentMD   string     `json:"content_md"`
	Status      Status     `json:"status"`
	Featured    bool       `json:"featured"`
	SortOrder   int        `json:"sort_order"`
	PublishedAt *time.Time `json:"published_at"`
	Tags        []Term     `json:"tags"`
}

func (r *Repository) CreateWriting(ctx context.Context, input WritingInput) (Writing, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Writing{}, err
	}
	defer tx.Rollback()

	slug, err := r.uniqueSlug(ctx, tx, "writings", 0, chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return Writing{}, err
	}
	now := formatTime(r.clock())
	sortOrder, err := nextSortOrder(ctx, tx, "writings")
	if err != nil {
		return Writing{}, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO writings (title, slug, excerpt, content_md, cover_media_id, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.Title,
		slug,
		input.Excerpt,
		input.ContentMD,
		input.CoverMediaID,
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
		return Writing{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Writing{}, err
	}
	if err := r.replaceWritingTags(ctx, tx, id, input.Tags); err != nil {
		return Writing{}, err
	}
	if err := tx.Commit(); err != nil {
		return Writing{}, err
	}
	return r.GetWriting(ctx, id)
}

func (r *Repository) GetWriting(ctx context.Context, id int64) (Writing, error) {
	var writing Writing
	var publishedAt sql.NullString
	var featured int
	err := r.db.QueryRowContext(ctx, `SELECT id, title, slug, excerpt, content_md, status, featured, sort_order, published_at FROM writings WHERE id = ?`, id).
		Scan(&writing.ID, &writing.Title, &writing.Slug, &writing.Excerpt, &writing.ContentMD, &writing.Status, &featured, &writing.SortOrder, &publishedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Writing{}, ErrNotFound
		}
		return Writing{}, err
	}
	writing.Featured = featured == 1
	if publishedAt.Valid {
		parsed, err := parseTime(publishedAt.String)
		if err != nil {
			return Writing{}, err
		}
		writing.PublishedAt = &parsed
	}
	tags, err := r.writingTags(ctx, id)
	if err != nil {
		return Writing{}, err
	}
	writing.Tags = tags
	return writing, nil
}

func (r *Repository) SetWritingStatus(ctx context.Context, id int64, status Status, publishedAt *time.Time) error {
	return r.setRoutableStatus(ctx, "writings", id, status, publishedAt)
}

func (r *Repository) ReorderWritings(ctx context.Context, orderedIDs []int64) error {
	return reorder(ctx, r.db, "writings", orderedIDs)
}
