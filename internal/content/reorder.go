package content

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func nextSortOrder(ctx context.Context, tx *sql.Tx, table string) (int, error) {
	var current sql.NullInt64
	if err := tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT MAX(sort_order) FROM %s`, table)).Scan(&current); err != nil {
		return 0, err
	}
	if !current.Valid {
		return 10, nil
	}
	return int(current.Int64) + 10, nil
}

func reorder(ctx context.Context, database *sql.DB, table string, orderedIDs []int64) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var total int
	if err := tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %s`, table)).Scan(&total); err != nil {
		return err
	}
	if total != len(orderedIDs) {
		return ErrInvalidReorder
	}
	seen := map[int64]bool{}
	for _, id := range orderedIDs {
		if seen[id] {
			return ErrInvalidReorder
		}
		seen[id] = true
		var exists int
		if err := tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id = ?`, table), id).Scan(&exists); err != nil {
			return err
		}
		if exists != 1 {
			return ErrInvalidReorder
		}
	}
	for index, id := range orderedIDs {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`UPDATE %s SET sort_order = ? WHERE id = ?`, table), (index+1)*10, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}
