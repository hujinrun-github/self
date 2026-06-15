package httpserver

import (
	"net/http"

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
	r.Handle("/*", handlerOrNotFound(options.ReactFallback))
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
