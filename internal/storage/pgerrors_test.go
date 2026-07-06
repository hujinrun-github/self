package storage

import (
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSQLState(t *testing.T) {
	err := fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: CodeUniqueViolation})
	if got := SQLState(err); got != CodeUniqueViolation {
		t.Fatalf("SQLState() = %q, want %q", got, CodeUniqueViolation)
	}
	if !IsSQLState(err, CodeUniqueViolation) {
		t.Fatal("IsSQLState() = false, want true")
	}
	if got := SQLState(fmt.Errorf("plain error")); got != "" {
		t.Fatalf("SQLState(non-pg error) = %q, want empty", got)
	}
}
