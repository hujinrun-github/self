package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

var (
	markdownInlineRawUploadImageRE     = regexp.MustCompile(`(?is)!\[[^\]]*\]\s*\(\s*['"]?\s*/uploads/[^\s)'"]+\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#][^\s)'"]*)?`)
	markdownImageReferenceUseRE        = regexp.MustCompile(`(?is)!\[([^\]]*)\]\s*\[([^\]]*)\]`)
	markdownRawUploadReferenceDefineRE = regexp.MustCompile(`(?im)^\s*\[([^\]]+)\]:\s*['"]?\s*/uploads/[^\s)'"]+\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#][^\s)'"]*)?`)
	htmlRawUploadImageRE               = regexp.MustCompile(`(?is)<img\b[^>]*\bsrc\s*=\s*(?:"\s*/uploads/|'\s*/uploads/|/uploads/)`)
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
	if markdownInlineRawUploadImageRE.MatchString(content) || htmlRawUploadImageRE.MatchString(content) {
		return ErrUnsafeMarkdownMedia
	}
	imageReferenceIDs := map[string]bool{}
	for _, match := range markdownImageReferenceUseRE.FindAllStringSubmatch(content, -1) {
		id := strings.TrimSpace(match[2])
		if id == "" {
			id = strings.TrimSpace(match[1])
		}
		imageReferenceIDs[strings.ToLower(id)] = true
	}
	if len(imageReferenceIDs) == 0 {
		return nil
	}
	for _, match := range markdownRawUploadReferenceDefineRE.FindAllStringSubmatch(content, -1) {
		if imageReferenceIDs[strings.ToLower(strings.TrimSpace(match[1]))] {
			return ErrUnsafeMarkdownMedia
		}
	}
	return nil
}
