package content

import (
	"strings"
	"testing"
)

func TestListContentIDsQueryUsesPostgresPlaceholder(t *testing.T) {
	query := listContentIDsQuery("projects")
	if !strings.Contains(query, "LIMIT $1") {
		t.Fatalf("query = %q, want postgres placeholder", query)
	}
	if strings.Contains(query, "LIMIT ?") {
		t.Fatalf("query = %q, got sqlite placeholder", query)
	}
}
