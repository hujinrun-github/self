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
	if err := validateMarkdownMedia(input.ContentMD); err != nil {
		return Writing{}, err
	}
	for attempt := 0; attempt < 10; attempt++ {
		writing, err := r.createWritingAttempt(ctx, input)
		if err == nil {
			return writing, nil
		}
		if !isSlugUniqueViolation(err, "writings") {
			return Writing{}, err
		}
	}
	return Writing{}, ErrSlugConflict
}

func (r *Repository) createWritingAttempt(ctx context.Context, input WritingInput) (Writing, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Writing{}, err
	}
	defer tx.Rollback()

	if err := lockContentOrder(ctx, tx, "writings"); err != nil {
		return Writing{}, err
	}
	slug, err := r.uniqueSlug(ctx, tx, "writings", 0, chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return Writing{}, err
	}
	now := normalizeTime(r.clock())
	sortOrder, err := nextSortOrder(ctx, tx, "writings")
	if err != nil {
		return Writing{}, err
	}
	var id int64
	err = tx.QueryRowContext(ctx, `INSERT INTO writings (title, slug, excerpt, content_md, cover_media_id, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
		input.Title,
		slug,
		input.Excerpt,
		input.ContentMD,
		input.CoverMediaID,
		input.SEOTitle,
		input.SEODescription,
		input.OGImageMediaID,
		StatusDraft,
		input.Featured,
		sortOrder,
		normalizedTimePtr(input.PublishedAt),
		now,
		now,
	).Scan(&id)
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
	var publishedAt sql.NullTime
	err := r.db.QueryRowContext(ctx, `SELECT id, title, slug, excerpt, content_md, status, featured, sort_order, published_at FROM writings WHERE id = $1`, id).
		Scan(&writing.ID, &writing.Title, &writing.Slug, &writing.Excerpt, &writing.ContentMD, &writing.Status, &writing.Featured, &writing.SortOrder, &publishedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Writing{}, ErrNotFound
		}
		return Writing{}, err
	}
	if publishedAt.Valid {
		value := normalizeTime(publishedAt.Time)
		writing.PublishedAt = &value
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
