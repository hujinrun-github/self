package site

import "testing"

func TestJournalMetadataDoesNotIndexProtectedPages(t *testing.T) {
	for _, path := range []string{"/zh/journal", "/en/journal/17", "/ja/journal/24"} {
		meta := RouteMeta(path, SEOConfig{SiteName: "Portfolio", PublicBaseURL: "https://example.com"})
		if meta.Robots != "noindex, nofollow" || meta.Title != "Journal | Portfolio" {
			t.Fatalf("journal meta for %s: %#v", path, meta)
		}
	}
}
