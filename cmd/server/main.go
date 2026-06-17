package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/auth"
	"portfolio/internal/config"
	"portfolio/internal/content"
	appdb "portfolio/internal/db"
	"portfolio/internal/httpserver"
	"portfolio/internal/media"
	"portfolio/internal/profile"
	"portfolio/internal/site"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	database, err := appdb.Open(cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	authService := auth.NewService(database, cfg)
	if err := authService.BootstrapAdmin(context.Background()); err != nil {
		log.Fatal(err)
	}
	mediaService := media.NewService(database, cfg.UploadsDir, cfg.PrivateUploadsDir)
	if err := mediaService.CleanupPrivateUploads(context.Background(), 24*time.Hour); err != nil {
		log.Printf("private upload cleanup failed: %v", err)
	}
	profileRepo := profile.NewRepository(database)
	contentRepo := content.NewRepository(database)
	homeRepo := site.NewHomeRepository(database, func() time.Time { return time.Now().UTC() })

	distDir := filepath.Join("web", "dist")
	indexPath := filepath.Join(distDir, "index.html")
	indexHTML, err := os.ReadFile(indexPath)
	if err != nil {
		log.Printf("web dist index missing, serving fallback shell: %v", err)
		indexHTML = []byte(`<!doctype html><html><head><title></title></head><body><div id="root"></div></body></html>`)
	}

	r := chi.NewRouter()
	r.Use(httpserver.SecurityHeaders(strings.HasPrefix(cfg.PublicBaseURL, "https://")))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			httpserver.SetCacheHeaders(w, req)
			next.ServeHTTP(w, req)
		})
	})

	authService.RegisterRoutes(r)
	r.Group(func(adminRoutes chi.Router) {
		adminRoutes.Use(authService.RequireAdmin)
		profile.RegisterAdminRoutes(adminRoutes, profileRepo)
		content.RegisterAdminRoutes(adminRoutes, contentRepo)
		media.RegisterAdminRoutes(adminRoutes, mediaService)
	})

	profile.RegisterSiteRoutes(r, profileRepo)
	content.RegisterSiteRoutes(r, contentRepo)
	site.RegisterRoutes(r, homeRepo)

	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.FileServer(http.Dir(cfg.UploadsDir))))
	r.Get("/sitemap.xml", func(w http.ResponseWriter, req *http.Request) {
		body, err := site.GenerateSitemap(req.Context(), database, cfg.PublicBaseURL, time.Now().UTC())
		if err != nil {
			httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not generate sitemap", nil)
			return
		}
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		_, _ = w.Write(body)
	})
	r.Get("/robots.txt", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte(site.RobotsTxt(cfg.PublicBaseURL)))
	})
	r.With(authService.RequireAdmin).Get("/admin/preview/*", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		serveIndex(w, req, indexHTML, cfg)
	})
	r.Handle("/assets/*", http.StripPrefix("/", http.FileServer(http.Dir(distDir))))
	r.Handle("/favicon.svg", http.FileServer(http.Dir(filepath.Join("web", "dist"))))
	r.Get("/", func(w http.ResponseWriter, req *http.Request) {
		serveIndex(w, req, indexHTML, cfg)
	})
	r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		serveIndex(w, req, indexHTML, cfg)
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Printf("serving %s on %s", cfg.SiteName, addr)
	log.Fatal(http.ListenAndServe(addr, r))
}

func serveIndex(w http.ResponseWriter, req *http.Request, indexHTML []byte, cfg config.Config) {
	meta := site.RouteMeta(req.URL.Path, site.SEOConfig{
		PublicBaseURL: cfg.PublicBaseURL,
		SiteName:      cfg.SiteName,
		Description:   cfg.SiteName,
	})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(site.InjectMeta(string(indexHTML), meta)))
}
