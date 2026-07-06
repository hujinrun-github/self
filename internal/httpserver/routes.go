package httpserver

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

type RouterOptions struct {
	APIRoutes           func(chi.Router)
	UploadHandler       http.Handler
	SitemapHandler      http.Handler
	RobotsHandler       http.Handler
	AdminPreviewHandler http.Handler
	ReactFallback       http.Handler
}

func NewRouter(options RouterOptions) http.Handler {
	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		if options.APIRoutes != nil {
			options.APIRoutes(api)
		}
	})
	r.Handle("/uploads/*", handlerOrNotFound(options.UploadHandler))
	r.Get("/sitemap.xml", handlerFuncOrNotFound(options.SitemapHandler))
	r.Get("/robots.txt", handlerFuncOrNotFound(options.RobotsHandler))
	r.Handle("/admin/preview/*", handlerOrNotFound(options.AdminPreviewHandler))
	r.HandleFunc("/*", func(w http.ResponseWriter, r *http.Request) {
		if target, ok := canonicalZhRedirect(r.URL.Path); ok {
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return
		}
		handlerOrNotFound(options.ReactFallback).ServeHTTP(w, r)
	})
	return r
}

func handlerOrNotFound(handler http.Handler) http.Handler {
	if handler == nil {
		return http.NotFoundHandler()
	}
	return handler
}

func handlerFuncOrNotFound(handler http.Handler) http.HandlerFunc {
	if handler == nil {
		return http.NotFound
	}
	return handler.ServeHTTP
}

func canonicalZhRedirect(path string) (string, bool) {
	if path == "" || path == "/" {
		return "/zh", true
	}

	trimmed := strings.TrimPrefix(path, "/")
	first, remainder := splitFirstSegment(trimmed)
	normalized := strings.ToLower(first)

	if normalized == "zh" || normalized == "en" || normalized == "ja" {
		if target, ok := retiredTalksRedirect(normalized, remainder); ok {
			return target, true
		}
		return "", false
	}

	if isReservedTopLevelSegment(normalized) {
		return "", false
	}
	if isLocaleSegment(normalized) {
		if remainder == "" {
			return "/zh", true
		}
		return "/zh/" + remainder, true
	}
	if isLegacyPublicRoot(normalized) {
		if normalized == "talks" {
			return "/zh", true
		}
		return "/zh/" + trimmed, true
	}
	return "", false
}

func CanonicalZhRedirect(path string) (string, bool) {
	return canonicalZhRedirect(path)
}

func splitFirstSegment(path string) (string, string) {
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], parts[1]
}

func isReservedTopLevelSegment(segment string) bool {
	switch segment {
	case "admin", "api", "robots.txt", "sitemap.xml", "uploads":
		return true
	default:
		return false
	}
}

func isLegacyPublicRoot(segment string) bool {
	switch segment {
	case "bio", "contact", "projects", "talks", "writing":
		return true
	default:
		return false
	}
}

func retiredTalksRedirect(locale string, remainder string) (string, bool) {
	if remainder == "talks" || strings.HasPrefix(remainder, "talks/") {
		return "/" + locale, true
	}
	return "", false
}

func isLocaleSegment(value string) bool {
	if len(value) != 2 {
		return false
	}
	for _, r := range value {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}
