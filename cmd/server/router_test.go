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

	router := newTestRouter(&adminCalls, &spaCalls, false)

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

func TestBuildRouterPreservesTopLevelRouteBehavior(t *testing.T) {
	tests := []struct {
		name           string
		method         string
		target         string
		allowAdmin     bool
		wantStatus     int
		wantBody       string
		wantLocation   string
		wantAdminCalls int
		wantSPACalls   int
	}{
		{
			name:         "public admin login",
			method:       http.MethodPost,
			target:       "/api/admin/login",
			wantStatus:   http.StatusOK,
			wantBody:     "login",
			wantSPACalls: 0,
		},
		{
			name:         "uploads route",
			method:       http.MethodGet,
			target:       "/uploads/example.jpg",
			wantStatus:   http.StatusOK,
			wantBody:     "uploads",
			wantSPACalls: 0,
		},
		{
			name:         "sitemap route",
			method:       http.MethodGet,
			target:       "/sitemap.xml",
			wantStatus:   http.StatusOK,
			wantBody:     "sitemap",
			wantSPACalls: 0,
		},
		{
			name:         "robots route",
			method:       http.MethodGet,
			target:       "/robots.txt",
			wantStatus:   http.StatusOK,
			wantBody:     "robots",
			wantSPACalls: 0,
		},
		{
			name:           "admin preview requires admin middleware",
			method:         http.MethodGet,
			target:         "/admin/preview/post-1",
			allowAdmin:     true,
			wantStatus:     http.StatusOK,
			wantBody:       "preview",
			wantAdminCalls: 1,
			wantSPACalls:   0,
		},
		{
			name:         "assets route",
			method:       http.MethodGet,
			target:       "/assets/app.js",
			wantStatus:   http.StatusOK,
			wantBody:     "assets",
			wantSPACalls: 0,
		},
		{
			name:         "favicon route",
			method:       http.MethodGet,
			target:       "/favicon.svg",
			wantStatus:   http.StatusOK,
			wantBody:     "favicon",
			wantSPACalls: 0,
		},
		{
			name:         "canonical zh redirect preserves query",
			method:       http.MethodGet,
			target:       "/fr/projects?ref=1",
			wantStatus:   http.StatusPermanentRedirect,
			wantLocation: "/zh/projects?ref=1",
			wantSPACalls: 0,
		},
		{
			name:         "spa fallback",
			method:       http.MethodGet,
			target:       "/unknown",
			wantStatus:   http.StatusOK,
			wantBody:     "spa",
			wantSPACalls: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adminCalls := 0
			spaCalls := 0
			router := newTestRouter(&adminCalls, &spaCalls, tt.allowAdmin)

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(tt.method, tt.target, nil))

			if recorder.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, tt.wantStatus)
			}
			if tt.wantBody != "" && recorder.Body.String() != tt.wantBody {
				t.Fatalf("body = %q, want %q", recorder.Body.String(), tt.wantBody)
			}
			if tt.wantLocation != "" {
				if got := recorder.Header().Get("Location"); got != tt.wantLocation {
					t.Fatalf("location = %q, want %q", got, tt.wantLocation)
				}
			}
			if adminCalls != tt.wantAdminCalls {
				t.Fatalf("admin middleware calls = %d, want %d", adminCalls, tt.wantAdminCalls)
			}
			if spaCalls != tt.wantSPACalls {
				t.Fatalf("spa calls = %d, want %d", spaCalls, tt.wantSPACalls)
			}
		})
	}
}

func newTestRouter(adminCalls *int, spaCalls *int, allowAdmin bool) http.Handler {
	return buildRouter(routerOptions{
		publicBaseURL: "https://example.com",
		healthHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			httpserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
		}),
		authRoutes: func(r chi.Router) {
			r.Post("/api/admin/login", writeText("login"))
		},
		requireAdmin: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				(*adminCalls)++
				if !allowAdmin {
					http.Error(w, "admin only", http.StatusUnauthorized)
					return
				}
				next.ServeHTTP(w, r)
			})
		},
		uploadHandler:       http.HandlerFunc(writeText("uploads")),
		sitemapHandler:      http.HandlerFunc(writeText("sitemap")),
		robotsHandler:       http.HandlerFunc(writeText("robots")),
		adminPreviewHandler: http.HandlerFunc(writeText("preview")),
		assetsHandler:       http.HandlerFunc(writeText("assets")),
		faviconHandler:      http.HandlerFunc(writeText("favicon")),
		spaHandler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			*spaCalls++
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("spa"))
		}),
	})
}

func writeText(value string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(value))
	}
}
