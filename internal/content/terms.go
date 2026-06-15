package content

import (
	"context"
	"database/sql"
)

func (r *Repository) replaceProjectTechs(ctx context.Context, tx *sql.Tx, projectID int64, names []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM project_tech WHERE project_id = ?`, projectID); err != nil {
		return err
	}
	for index, name := range names {
		slug, err := Slugify(name)
		if err != nil {
			return err
		}
		techID, err := upsertTerm(ctx, tx, "techs", name, slug)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_tech (project_id, tech_id, sort_order) VALUES (?, ?, ?)`, projectID, techID, (index+1)*10); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) projectTechs(ctx context.Context, projectID int64) ([]Term, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT techs.name, techs.slug, project_tech.sort_order FROM project_tech JOIN techs ON techs.id = project_tech.tech_id WHERE project_tech.project_id = ? ORDER BY project_tech.sort_order`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	terms := []Term{}
	for rows.Next() {
		var term Term
		if err := rows.Scan(&term.Name, &term.Slug, &term.SortOrder); err != nil {
			return nil, err
		}
		terms = append(terms, term)
	}
	return terms, rows.Err()
}

func (r *Repository) replaceWritingTags(ctx context.Context, tx *sql.Tx, writingID int64, names []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM writing_tags WHERE writing_id = ?`, writingID); err != nil {
		return err
	}
	for index, name := range names {
		slug, err := Slugify(name)
		if err != nil {
			return err
		}
		tagID, err := upsertTerm(ctx, tx, "tags", name, slug)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO writing_tags (writing_id, tag_id, sort_order) VALUES (?, ?, ?)`, writingID, tagID, (index+1)*10); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) writingTags(ctx context.Context, writingID int64) ([]Term, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT tags.name, tags.slug, writing_tags.sort_order FROM writing_tags JOIN tags ON tags.id = writing_tags.tag_id WHERE writing_tags.writing_id = ? ORDER BY writing_tags.sort_order`, writingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	terms := []Term{}
	for rows.Next() {
		var term Term
		if err := rows.Scan(&term.Name, &term.Slug, &term.SortOrder); err != nil {
			return nil, err
		}
		terms = append(terms, term)
	}
	return terms, rows.Err()
}

func upsertTerm(ctx context.Context, tx *sql.Tx, table string, name string, slug string) (int64, error) {
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO `+table+` (name, slug, created_at, updated_at) VALUES (?, ?, ?, ?)`, name, slug, formatTimeNow(), formatTimeNow()); err != nil {
		return 0, err
	}
	var id int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM `+table+` WHERE slug = ?`, slug).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}
