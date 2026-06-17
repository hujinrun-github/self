package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

func (r *Repository) PublicProjectBySlug(ctx context.Context, slug string) (Project, error) {
	var id int64
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM projects WHERE slug = $1 AND status = $2 AND published_at <= $3`, slug, StatusPublished, normalizeTime(r.clock())).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Project{}, ErrNotFound
		}
		return Project{}, err
	}
	return r.GetProject(ctx, id)
}

func (r *Repository) PublicWriting(ctx context.Context, limit int) ([]Writing, error) {
	ids, err := r.publicIDs(ctx, "writings", limit)
	if err != nil {
		return nil, err
	}
	items := make([]Writing, 0, len(ids))
	for _, id := range ids {
		item, err := r.GetWriting(ctx, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) PublicWritingBySlug(ctx context.Context, slug string) (Writing, error) {
	var id int64
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM writings WHERE slug = $1 AND status = $2 AND published_at <= $3`, slug, StatusPublished, normalizeTime(r.clock())).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Writing{}, ErrNotFound
		}
		return Writing{}, err
	}
	return r.GetWriting(ctx, id)
}

func (r *Repository) PublicTalks(ctx context.Context, limit int) ([]Talk, error) {
	ids, err := r.publicIDs(ctx, "talks", limit)
	if err != nil {
		return nil, err
	}
	items := make([]Talk, 0, len(ids))
	for _, id := range ids {
		item, err := r.GetTalk(ctx, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) PublicTalkBySlug(ctx context.Context, slug string) (Talk, error) {
	var id int64
	if err := r.db.QueryRowContext(ctx, `SELECT id FROM talks WHERE slug = $1 AND status = $2 AND published_at <= $3`, slug, StatusPublished, normalizeTime(r.clock())).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Talk{}, ErrNotFound
		}
		return Talk{}, err
	}
	return r.GetTalk(ctx, id)
}

func (r *Repository) publicIDs(ctx context.Context, table string, limit int) ([]int64, error) {
	if !publicTableAllowed(table) {
		return nil, fmt.Errorf("unknown public table %s", table)
	}
	if limit <= 0 {
		limit = 12
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM `+table+` WHERE status = $1 AND published_at <= $2 ORDER BY published_at DESC, sort_order ASC LIMIT $3`, StatusPublished, normalizeTime(r.clock()), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func publicTableAllowed(table string) bool {
	switch table {
	case "writings", "talks":
		return true
	default:
		return false
	}
}
