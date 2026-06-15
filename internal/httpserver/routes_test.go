package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRoutePriorityBeforeSPAFallback(t *testing.T) {
	router := NewRouter(RouterOptions{
		APIRoutes: func(r chi.Router) {
			r.Get("/ping", writeText("api"))
		},
		UploadHandler:       http.HandlerFunc(writeText("uploads")),
		SitemapHandler:      http.HandlerFunc(writeText("sitemap")),
		RobotsHandler:       http.HandlerFunc(writeText("robots")),
		AdminPreviewHandler: http.HandlerFunc(writeText("preview")),
		ReactFallback:       http.HandlerFunc(writeText("spa")),
	})

	cases := map[string]string{
		"/api/ping":              "api",
		"/uploads/ab/card.jpg":   "uploads",
		"/sitemap.xml":           "sitemap",
		"/robots.txt":            "robots",
		"/admin/preview/project": "preview",
		"/projects/example":      "spa",
	}
	for path, want := range cases {
		t.Run(path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
			if got := recorder.Body.String(); got != want {
				t.Fatalf("body = %q, want %q", got, want)
			}
		})
	}
}

func TestProductionCSPDisallowsDataImages(t *testing.T) {
	handler := SecurityHeaders(true)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))

	csp := recorder.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("missing Content-Security-Policy")
	}
	if !containsDirective(csp, "img-src 'self';") {
		t.Fatalf("CSP missing strict img-src directive: %s", csp)
	}
	if containsDirective(csp, "data:") {
		t.Fatalf("CSP should not allow data: %s", csp)
	}
}

func writeText(value string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(value))
	}
}
