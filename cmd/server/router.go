package main

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/httpserver"
)

type routeRegistrar func(chi.Router)

type routerOptions struct {
	publicBaseURL       string
	healthHandler       http.Handler
	authRoutes          routeRegistrar
	requireAdmin        func(http.Handler) http.Handler
	adminRoutes         []routeRegistrar
	publicRoutes        []routeRegistrar
	uploadHandler       http.Handler
	sitemapHandler      http.Handler
	robotsHandler       http.Handler
	adminPreviewHandler http.Handler
	assetsHandler       http.Handler
	faviconHandler      http.Handler
	spaHandler          http.Handler
}

func buildRouter(opts routerOptions) http.Handler {
	r := chi.NewRouter()
	r.Use(httpserver.SecurityHeaders(strings.HasPrefix(opts.publicBaseURL, "https://")))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			httpserver.SetCacheHeaders(w, req)
			next.ServeHTTP(w, req)
		})
	})

	r.Get("/api/health", handlerFuncOrNotFound(opts.healthHandler))

	if opts.authRoutes != nil {
		opts.authRoutes(r)
	}

	if len(opts.adminRoutes) > 0 {
		r.Group(func(adminRoutes chi.Router) {
			if opts.requireAdmin != nil {
				adminRoutes.Use(opts.requireAdmin)
			}
			for _, register := range opts.adminRoutes {
				if register != nil {
					register(adminRoutes)
				}
			}
		})
	}

	for _, register := range opts.publicRoutes {
		if register != nil {
			register(r)
		}
	}

	r.Handle("/uploads/*", handlerOrNotFound(opts.uploadHandler))
	r.Get("/sitemap.xml", handlerFuncOrNotFound(opts.sitemapHandler))
	r.Get("/robots.txt", handlerFuncOrNotFound(opts.robotsHandler))

	adminPreview := handlerOrNotFound(opts.adminPreviewHandler)
	if opts.requireAdmin != nil {
		r.With(opts.requireAdmin).Get("/admin/preview/*", adminPreview.ServeHTTP)
	} else {
		r.Get("/admin/preview/*", adminPreview.ServeHTTP)
	}

	r.Handle("/assets/*", handlerOrNotFound(opts.assetsHandler))
	r.Handle("/favicon.svg", handlerOrNotFound(opts.faviconHandler))
	r.Get("/", func(w http.ResponseWriter, req *http.Request) {
		if target, ok := httpserver.CanonicalZhRedirect(req.URL.Path); ok {
			http.Redirect(w, req, target, http.StatusPermanentRedirect)
			return
		}
		handlerOrNotFound(opts.spaHandler).ServeHTTP(w, req)
	})
	r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if target, ok := httpserver.CanonicalZhRedirect(req.URL.Path); ok {
			if req.URL.RawQuery != "" {
				target += "?" + req.URL.RawQuery
			}
			http.Redirect(w, req, target, http.StatusPermanentRedirect)
			return
		}
		handlerOrNotFound(opts.spaHandler).ServeHTTP(w, req)
	}))

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
