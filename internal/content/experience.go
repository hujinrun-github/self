package content

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type ExperienceInput struct {
	Period       string     `json:"period"`
	Title        string     `json:"title"`
	Organization string     `json:"organization"`
	Description  string     `json:"description"`
	PublishedAt  *time.Time `json:"published_at"`
}

type Experience struct {
	ID           int64      `json:"id"`
	Period       string     `json:"period"`
	Title        string     `json:"title"`
	Organization string     `json:"organization"`
	Description  string     `json:"description"`
	Status       Status     `json:"status"`
	SortOrder    int        `json:"sort_order"`
	PublishedAt  *time.Time `json:"published_at"`
}

func (r *Repository) CreateExperience(ctx context.Context, input ExperienceInput) (Experience, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Experience{}, err
	}
	defer tx.Rollback()
	if err := lockContentOrder(ctx, tx, "experiences"); err != nil {
		return Experience{}, err
	}
	sortOrder, err := nextSortOrder(ctx, tx, "experiences")
	if err != nil {
		return Experience{}, err
	}
	now := normalizeTime(r.clock())
	var id int64
	err = tx.QueryRowContext(ctx, `INSERT INTO experiences (period, title, organization, description, status, sort_order, published_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
		input.Period, input.Title, input.Organization, input.Description, StatusDraft, sortOrder, normalizedTimePtr(input.PublishedAt), now, now).Scan(&id)
	if err != nil {
		return Experience{}, err
	}
	if err := tx.Commit(); err != nil {
		return Experience{}, err
	}
	return r.GetExperience(ctx, id)
}

func (r *Repository) GetExperience(ctx context.Context, id int64) (Experience, error) {
	var experience Experience
	var publishedAt sql.NullTime
	err := r.db.QueryRowContext(ctx, `SELECT id, period, title, organization, description, status, sort_order, published_at FROM experiences WHERE id = $1`, id).
		Scan(&experience.ID, &experience.Period, &experience.Title, &experience.Organization, &experience.Description, &experience.Status, &experience.SortOrder, &publishedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Experience{}, ErrNotFound
		}
		return Experience{}, err
	}
	if publishedAt.Valid {
		value := normalizeTime(publishedAt.Time)
		experience.PublishedAt = &value
	}
	return experience, nil
}

func (r *Repository) SetExperienceStatus(ctx context.Context, id int64, status Status, publishedAt *time.Time) error {
	return r.setRoutableStatus(ctx, "experiences", id, status, publishedAt)
}

func (r *Repository) ReorderExperiences(ctx context.Context, orderedIDs []int64) error {
	return reorder(ctx, r.db, "experiences", orderedIDs)
}
