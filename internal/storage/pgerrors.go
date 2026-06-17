package storage

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	CodeSerializationFailure = "40001"
	CodeDeadlockDetected     = "40P01"
	CodeUniqueViolation      = "23505"
	CodeForeignKeyViolation  = "23503"
	CodeCheckViolation       = "23514"
)

func SQLState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func IsSQLState(err error, code string) bool {
	return SQLState(err) == code
}
