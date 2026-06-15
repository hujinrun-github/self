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
	sortOrder, err := nextSortOrder(ctx, tx, "experiences")
	if err != nil {
		return Experience{}, err
	}
	now := formatTime(r.clock())
	result, err := tx.ExecContext(ctx, `INSERT INTO experiences (period, title, organization, description, status, sort_order, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		input.Period, input.Title, input.Organization, input.Description, StatusDraft, sortOrder, timePtrString(input.PublishedAt), now, now)
	if err != nil {
		return Experience{}, err
	}
	id, err := result.LastInsertId()
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
	var publishedAt sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT id, period, title, organization, description, status, sort_order, published_at FROM experiences WHERE id = ?`, id).
		Scan(&experience.ID, &experience.Period, &experience.Title, &experience.Organization, &experience.Description, &experience.Status, &experience.SortOrder, &publishedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Experience{}, ErrNotFound
		}
		return Experience{}, err
	}
	if publishedAt.Valid {
		parsed, err := parseTime(publishedAt.String)
		if err != nil {
			return Experience{}, err
		}
		experience.PublishedAt = &parsed
	}
	return experience, nil
}

func (r *Repository) SetExperienceStatus(ctx context.Context, id int64, status Status, publishedAt *time.Time) error {
	return r.setRoutableStatus(ctx, "experiences", id, status, publishedAt)
}

func (r *Repository) ReorderExperiences(ctx context.Context, orderedIDs []int64) error {
	return reorder(ctx, r.db, "experiences", orderedIDs)
}
