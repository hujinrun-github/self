package content

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

func (r *Repository) replaceProjectTechs(ctx context.Context, tx *sql.Tx, projectID int64, names []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM project_tech WHERE project_id = $1`, projectID); err != nil {
		return err
	}
	terms, err := uniqueTermInputs(names)
	if err != nil {
		return err
	}
	for index, term := range terms {
		techID, err := upsertTerm(ctx, tx, "techs", term.name, term.slug)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_tech (project_id, tech_id, sort_order) VALUES ($1, $2, $3)`, projectID, techID, (index+1)*10); err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) projectTechs(ctx context.Context, projectID int64) ([]Term, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT techs.name, techs.slug, project_tech.sort_order FROM project_tech JOIN techs ON techs.id = project_tech.tech_id WHERE project_tech.project_id = $1 ORDER BY project_tech.sort_order`, projectID)
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM writing_tags WHERE writing_id = $1`, writingID); err != nil {
		return err
	}
	terms, err := uniqueTermInputs(names)
	if err != nil {
		return err
	}
	for index, term := range terms {
		tagID, err := upsertTerm(ctx, tx, "tags", term.name, term.slug)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO writing_tags (writing_id, tag_id, sort_order) VALUES ($1, $2, $3)`, writingID, tagID, (index+1)*10); err != nil {
			return err
		}
	}
	return nil
}

type termInput struct {
	name string
	slug string
}

func uniqueTermInputs(names []string) ([]termInput, error) {
	terms := make([]termInput, 0, len(names))
	seen := map[string]bool{}
	for _, name := range names {
		slug, err := Slugify(name)
		if err != nil {
			return nil, err
		}
		if seen[slug] {
			continue
		}
		seen[slug] = true
		terms = append(terms, termInput{name: name, slug: slug})
	}
	return terms, nil
}

func (r *Repository) writingTags(ctx context.Context, writingID int64) ([]Term, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT tags.name, tags.slug, writing_tags.sort_order FROM writing_tags JOIN tags ON tags.id = writing_tags.tag_id WHERE writing_tags.writing_id = $1 ORDER BY writing_tags.sort_order`, writingID)
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
	if !termTableAllowed(table) {
		return 0, fmt.Errorf("unknown term table %s", table)
	}
	var id int64
	now := normalizeTime(time.Now())
	if err := tx.QueryRowContext(ctx, `INSERT INTO `+table+` (name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at RETURNING id`, name, slug, now, now).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func termTableAllowed(table string) bool {
	switch table {
	case "tags", "techs":
		return true
	default:
		return false
	}
}
