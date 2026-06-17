package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (r *Repository) setRoutableStatus(ctx context.Context, table string, id int64, status Status, publishedAt *time.Time) error {
	if !validStatus(status) {
		return ErrInvalidStatus
	}
	if !contentTableAllowed(table) {
		return fmt.Errorf("unknown status table %s", table)
	}
	var existing sql.NullTime
	query := `SELECT published_at FROM ` + table + ` WHERE id = $1`
	if err := r.db.QueryRowContext(ctx, query, id).Scan(&existing); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	var nextPublishedAt any
	if status == StatusPublished {
		if existing.Valid {
			nextPublishedAt = normalizeTime(existing.Time)
		} else if publishedAt != nil {
			nextPublishedAt = normalizeTime(*publishedAt)
		} else {
			nextPublishedAt = normalizeTime(r.clock())
		}
	} else if existing.Valid {
		nextPublishedAt = normalizeTime(existing.Time)
	}
	_, err := r.db.ExecContext(ctx, `UPDATE `+table+` SET status = $1, published_at = $2, updated_at = $3 WHERE id = $4`, status, nextPublishedAt, normalizeTime(r.clock()), id)
	return err
}

func contentTableAllowed(table string) bool {
	switch table {
	case "projects", "writings", "talks", "experiences":
		return true
	default:
		return false
	}
}

func validateMarkdownMedia(content string) error {
	if strings.Contains(content, "](/uploads/") || strings.Contains(content, `](/uploads\`) {
		return ErrUnsafeMarkdownMedia
	}
	return nil
}
