package content

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

func (r *Repository) setRoutableStatus(ctx context.Context, table string, id int64, status Status, publishedAt *time.Time) error {
	if !validStatus(status) {
		return ErrInvalidStatus
	}
	var existing sql.NullString
	query := `SELECT published_at FROM ` + table + ` WHERE id = ?`
	if err := r.db.QueryRowContext(ctx, query, id).Scan(&existing); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	var nextPublishedAt any
	if status == StatusPublished {
		if existing.Valid && existing.String != "" {
			nextPublishedAt = existing.String
		} else if publishedAt != nil {
			nextPublishedAt = formatTime(*publishedAt)
		} else {
			nextPublishedAt = formatTime(r.clock())
		}
	} else if existing.Valid {
		nextPublishedAt = existing.String
	}
	_, err := r.db.ExecContext(ctx, `UPDATE `+table+` SET status = ?, published_at = ?, updated_at = ? WHERE id = ?`, status, nextPublishedAt, formatTime(r.clock()), id)
	return err
}
