package content

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"portfolio/internal/storage"
)

type TalkInput struct {
	Title           string     `json:"title"`
	Slug            string     `json:"slug"`
	Summary         string     `json:"summary"`
	CoverMediaID    *int64     `json:"cover_media_id"`
	EventName       string     `json:"event_name"`
	VideoURL        string     `json:"video_url"`
	DurationMinutes *int       `json:"duration_minutes"`
	SEOTitle        string     `json:"seo_title"`
	SEODescription  string     `json:"seo_description"`
	OGImageMediaID  *int64     `json:"og_image_media_id"`
	Featured        bool       `json:"featured"`
	PublishedAt     *time.Time `json:"published_at"`
}

type Talk struct {
	ID          int64      `json:"id"`
	Title       string     `json:"title"`
	Slug        string     `json:"slug"`
	Summary     string     `json:"summary"`
	EventName   string     `json:"event_name"`
	VideoURL    string     `json:"video_url"`
	Status      Status     `json:"status"`
	Featured    bool       `json:"featured"`
	SortOrder   int        `json:"sort_order"`
	PublishedAt *time.Time `json:"published_at"`
}

func (r *Repository) CreateTalk(ctx context.Context, input TalkInput) (Talk, error) {
	for attempt := 0; attempt < 10; attempt++ {
		talk, err := r.createTalkAttempt(ctx, input)
		if err == nil {
			return talk, nil
		}
		if !storage.IsSQLState(err, storage.CodeUniqueViolation) {
			return Talk{}, err
		}
	}
	return Talk{}, ErrSlugConflict
}

func (r *Repository) createTalkAttempt(ctx context.Context, input TalkInput) (Talk, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Talk{}, err
	}
	defer tx.Rollback()
	slug, err := r.uniqueSlug(ctx, tx, "talks", 0, chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return Talk{}, err
	}
	if err := lockContentOrder(ctx, tx, "talks"); err != nil {
		return Talk{}, err
	}
	sortOrder, err := nextSortOrder(ctx, tx, "talks")
	if err != nil {
		return Talk{}, err
	}
	now := normalizeTime(r.clock())
	var id int64
	err = tx.QueryRowContext(ctx, `INSERT INTO talks (title, slug, summary, cover_media_id, event_name, video_url, duration_minutes, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
		input.Title, slug, input.Summary, input.CoverMediaID, input.EventName, input.VideoURL, input.DurationMinutes, input.SEOTitle, input.SEODescription, input.OGImageMediaID, StatusDraft, input.Featured, sortOrder, normalizedTimePtr(input.PublishedAt), now, now).Scan(&id)
	if err != nil {
		return Talk{}, err
	}
	if err := tx.Commit(); err != nil {
		return Talk{}, err
	}
	return r.GetTalk(ctx, id)
}

func (r *Repository) GetTalk(ctx context.Context, id int64) (Talk, error) {
	var talk Talk
	var publishedAt sql.NullTime
	err := r.db.QueryRowContext(ctx, `SELECT id, title, slug, summary, event_name, video_url, status, featured, sort_order, published_at FROM talks WHERE id = $1`, id).
		Scan(&talk.ID, &talk.Title, &talk.Slug, &talk.Summary, &talk.EventName, &talk.VideoURL, &talk.Status, &talk.Featured, &talk.SortOrder, &publishedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Talk{}, ErrNotFound
		}
		return Talk{}, err
	}
	if publishedAt.Valid {
		value := normalizeTime(publishedAt.Time)
		talk.PublishedAt = &value
	}
	return talk, nil
}

func (r *Repository) SetTalkStatus(ctx context.Context, id int64, status Status, publishedAt *time.Time) error {
	return r.setRoutableStatus(ctx, "talks", id, status, publishedAt)
}

func (r *Repository) ReorderTalks(ctx context.Context, orderedIDs []int64) error {
	return reorder(ctx, r.db, "talks", orderedIDs)
}
