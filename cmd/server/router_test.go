package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
)

func TestBuildRouterServesAPIHealthBeforeSPAFallback(t *testing.T) {
	adminCalls := 0
	spaCalls := 0

	router := buildRouter(routerOptions{
		publicBaseURL: "https://example.com",
		healthHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
		}),
		authRoutes: func(r chi.Router) {
			r.Post("/api/admin/login", func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
		},
		requireAdmin: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				adminCalls++
				http.Error(w, "admin only", http.StatusUnauthorized)
			})
		},
		spaHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			spaCalls++
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("spa"))
		}),
	})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if adminCalls != 0 {
		t.Fatalf("admin middleware calls = %d, want 0", adminCalls)
	}
	if spaCalls != 0 {
		t.Fatalf("spa calls = %d, want 0", spaCalls)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("content-type = %q, want application/json", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache-control = %q, want %q", got, "no-store")
	}
	if body := recorder.Body.String(); strings.Contains(body, "spa") {
		t.Fatalf("body = %q, should not come from spa fallback", body)
	}
}
