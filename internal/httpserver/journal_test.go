package httpserver

import (
	"net/http/httptest"
	"testing"
)

func TestJournalRoutesDoNotCacheOrIndexPrivateContent(t *testing.T) {
	for _, path := range []string{"/zh/journal", "/en/journal/12", "/api/site/journal/notebooks/12/assets/9", "/api/admin/journal/assets/9"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			SetCacheHeaders(w, httptest.NewRequest("GET", path, nil))
			if got := w.Header().Get("Cache-Control"); got != "private, no-store" {
				t.Fatalf("private page cache control: %q", got)
			}
			if got := w.Header().Get("X-Robots-Tag"); got != "noindex, nofollow" {
				t.Fatalf("private page robot policy: %q", got)
			}
		})
	}
}

func TestLegacyJournalLinksKeepCanonicalLocale(t *testing.T) {
	for _, path := range []string{"/journal", "/journal/12"} {
		got, redirect := CanonicalZhRedirect(path)
		if !redirect || got != "/zh"+path {
			t.Fatalf("canonical journal path %q = %q, %v", path, got, redirect)
		}
	}
}

func TestJournalPolicyDoesNotHideUnrelatedPublicPages(t *testing.T) {
	for _, path := range []string{"/zh/writing/journal-notes", "/assets/journal.js"} {
		w := httptest.NewRecorder()
		SetCacheHeaders(w, httptest.NewRequest("GET", path, nil))
		if w.Header().Get("X-Robots-Tag") != "" || w.Header().Get("Cache-Control") == "private, no-store" {
			t.Fatalf("journal privacy policy applied to unrelated route %q", path)
		}
	}
}
