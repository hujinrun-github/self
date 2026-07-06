package content

import (
	"context"
	"database/sql"
	"fmt"
)

func nextSortOrder(ctx context.Context, tx *sql.Tx, table string) (int, error) {
	if !contentTableAllowed(table) {
		return 0, fmt.Errorf("unknown order table %s", table)
	}
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

	if err := lockContentOrder(ctx, tx, table); err != nil {
		return err
	}
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
		if err := tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE id = $1`, table), id).Scan(&exists); err != nil {
			return err
		}
		if exists != 1 {
			return ErrInvalidReorder
		}
	}
	for index, id := range orderedIDs {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(`UPDATE %s SET sort_order = $1 WHERE id = $2`, table), (index+1)*10, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func lockContentOrder(ctx context.Context, tx *sql.Tx, table string) error {
	keys := map[string]int64{
		"projects":    710204101,
		"writings":    710204102,
		"talks":       710204103,
		"experiences": 710204104,
	}
	key, ok := keys[table]
	if !ok {
		return fmt.Errorf("unknown order table %s", table)
	}
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, key)
	return err
}
