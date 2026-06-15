package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCacheHeaders(t *testing.T) {
	cases := map[string]string{
		"/api/site/home":       "no-store",
		"/assets/index.js":     "public, max-age=31536000, immutable",
		"/uploads/ab/card.jpg": "public, max-age=31536000, immutable",
		"/projects/example":    "no-cache",
		"/admin/preview/thing": "no-cache",
		"/":                    "no-cache",
	}
	for path, want := range cases {
		t.Run(path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, path, nil)
			SetCacheHeaders(recorder, req)
			if got := recorder.Header().Get("Cache-Control"); got != want {
				t.Fatalf("Cache-Control = %q, want %q", got, want)
			}
		})
	}
}
