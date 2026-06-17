package content

import (
	"context"
	"fmt"
)

func (r *Repository) ListProjects(ctx context.Context, limit int) ([]Project, error) {
	ids, err := r.listContentIDs(ctx, "projects", limit)
	if err != nil {
		return nil, err
	}
	items := make([]Project, 0, len(ids))
	for _, id := range ids {
		item, err := r.GetProject(ctx, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) ListWriting(ctx context.Context, limit int) ([]Writing, error) {
	ids, err := r.listContentIDs(ctx, "writings", limit)
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

func (r *Repository) ListTalks(ctx context.Context, limit int) ([]Talk, error) {
	ids, err := r.listContentIDs(ctx, "talks", limit)
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

func (r *Repository) ListExperiences(ctx context.Context, limit int) ([]Experience, error) {
	ids, err := r.listContentIDs(ctx, "experiences", limit)
	if err != nil {
		return nil, err
	}
	items := make([]Experience, 0, len(ids))
	for _, id := range ids {
		item, err := r.GetExperience(ctx, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) listContentIDs(ctx context.Context, table string, limit int) ([]int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	query := fmt.Sprintf(`SELECT id FROM %s ORDER BY CASE status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, sort_order ASC, id DESC LIMIT ?`, table)
	rows, err := r.db.QueryContext(ctx, query, limit)
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
