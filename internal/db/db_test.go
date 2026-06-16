package db

import (
	"strings"
	"testing"
)

func TestOpenRedactsDatabaseURLDetailsFromErrors(t *testing.T) {
	_, err := Open("postgres://postgres:secret@localhost:5432/portfolio?sslmode=not-a-mode")
	if err == nil {
		t.Fatal("expected invalid database URL error")
	}

	got := err.Error()
	for _, leaked := range []string{"secret", "sslmode", "disable"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("Open leaked database URL detail %q in error: %s", leaked, got)
		}
	}
}
