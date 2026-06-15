package content

import (
	"context"
	"database/sql"
	"errors"
	"time"
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
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Talk{}, err
	}
	defer tx.Rollback()
	slug, err := r.uniqueSlug(ctx, tx, "talks", 0, chooseSlugInput(input.Slug, input.Title))
	if err != nil {
		return Talk{}, err
	}
	sortOrder, err := nextSortOrder(ctx, tx, "talks")
	if err != nil {
		return Talk{}, err
	}
	now := formatTime(r.clock())
	result, err := tx.ExecContext(ctx, `INSERT INTO talks (title, slug, summary, cover_media_id, event_name, video_url, duration_minutes, seo_title, seo_description, og_image_media_id, status, featured, sort_order, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.Title, slug, input.Summary, input.CoverMediaID, input.EventName, input.VideoURL, input.DurationMinutes, input.SEOTitle, input.SEODescription, input.OGImageMediaID, StatusDraft, boolInt(input.Featured), sortOrder, timePtrString(input.PublishedAt), now, now)
	if err != nil {
		return Talk{}, err
	}
	id, err := result.LastInsertId()
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
	var publishedAt sql.NullString
	var featured int
	err := r.db.QueryRowContext(ctx, `SELECT id, title, slug, summary, event_name, video_url, status, featured, sort_order, published_at FROM talks WHERE id = ?`, id).
		Scan(&talk.ID, &talk.Title, &talk.Slug, &talk.Summary, &talk.EventName, &talk.VideoURL, &talk.Status, &featured, &talk.SortOrder, &publishedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Talk{}, ErrNotFound
		}
		return Talk{}, err
	}
	talk.Featured = featured == 1
	if publishedAt.Valid {
		parsed, err := parseTime(publishedAt.String)
		if err != nil {
			return Talk{}, err
		}
		talk.PublishedAt = &parsed
	}
	return talk, nil
}

func (r *Repository) SetTalkStatus(ctx context.Context, id int64, status Status, publishedAt *time.Time) error {
	return r.setRoutableStatus(ctx, "talks", id, status, publishedAt)
}

func (r *Repository) ReorderTalks(ctx context.Context, orderedIDs []int64) error {
	return reorder(ctx, r.db, "talks", orderedIDs)
}
