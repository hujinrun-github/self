package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"

	"portfolio/internal/auth"
	"portfolio/internal/config"
	"portfolio/internal/content"
	appdb "portfolio/internal/db"
	"portfolio/internal/health"
	"portfolio/internal/httpserver"
	"portfolio/internal/media"
	"portfolio/internal/profile"
	"portfolio/internal/site"
	"portfolio/internal/translation"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if cfg.MediaBlobBackend == "hybrid" && (cfg.MinIOEndpoint == "" || cfg.MinIOAccessKey == "" || cfg.MinIOSecretKey == "" || cfg.MinIOBucket == "") {
		log.Fatal("hybrid media backend requires MinIO configuration")
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
	localBlobStore := media.NewLocalBlobStore(cfg.UploadsDir)
	var minioBlobStore media.BlobStore
	if cfg.MediaBlobBackend == "hybrid" {
		minioBlobStore, err = media.NewMinIOBlobStore(media.MinIOConfig{
			Endpoint:  cfg.MinIOEndpoint,
			AccessKey: cfg.MinIOAccessKey,
			SecretKey: cfg.MinIOSecretKey,
			Bucket:    cfg.MinIOBucket,
			UseSSL:    cfg.MinIOUseSSL,
		})
		if err != nil {
			log.Fatal(err)
		}
	}
	if err := health.RunStartupChecks(context.Background(), cfg.MediaBlobBackend, func(ctx context.Context) error {
		return media.CheckBlobStoreRoundTrip(ctx, minioBlobStore, "_healthchecks/startup")
	}); err != nil {
		log.Fatal(err)
	}
	mediaService := media.NewService(database, cfg.UploadsDir, cfg.PrivateUploadsDir, localBlobStore, minioBlobStore)
	if err := mediaService.CleanupPrivateUploads(context.Background(), 24*time.Hour); err != nil {
		log.Printf("private upload cleanup failed: %v", err)
	}
	translationService := translation.NewService(translation.Config{
		Provider: cfg.TranslationProvider,
		APIKey:   cfg.TranslationAPIKey,
		BaseURL:  cfg.TranslationBaseURL,
		Model:    cfg.TranslationModel,
		Timeout:  time.Duration(cfg.TranslationTimeoutSeconds) * time.Second,
	})
	profileRepo := profile.NewRepository(database)
	contentRepo := content.NewRepository(database)
	importService := content.NewWritingImportService(contentRepo, mediaService, func() time.Time { return time.Now().UTC() })
	if err := importService.CleanupExpiredSessions(context.Background()); err != nil {
		log.Printf("writing import cleanup failed: %v", err)
	}
	go func() {
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			if err := importService.CleanupExpiredSessions(context.Background()); err != nil {
				log.Printf("writing import cleanup failed: %v", err)
			}
		}
	}()
	homeRepo := site.NewHomeRepository(database, func() time.Time { return time.Now().UTC() })

	distDir := filepath.Join("web", "dist")
	indexPath := filepath.Join(distDir, "index.html")
	indexHTML, err := os.ReadFile(indexPath)
	if err != nil {
		log.Printf("web dist index missing, serving fallback shell: %v", err)
		indexHTML = []byte(`<!doctype html><html><head><title></title></head><body><div id="root"></div></body></html>`)
	}

	healthService := health.NewService(
		cfg.MediaBlobBackend,
		func(ctx context.Context) error {
			return appdb.Ping(ctx, cfg.DatabaseURL)
		},
		func(ctx context.Context) error {
			return media.CheckBlobStoreRoundTrip(ctx, minioBlobStore, "_healthchecks/http")
		},
	)

	r := buildRouter(routerOptions{
		publicBaseURL: cfg.PublicBaseURL,
		healthHandler: healthService.Handler(),
		authRoutes:    authService.RegisterRoutes,
		requireAdmin:  authService.RequireAdmin,
		adminRoutes: []routeRegistrar{
			func(r chi.Router) {
				profile.RegisterAdminRoutes(r, profileRepo, translationService)
			},
			func(r chi.Router) {
				content.RegisterAdminRoutes(r, contentRepo, translationService)
			},
			func(r chi.Router) {
				content.RegisterWritingImportRoutes(r, importService)
			},
			func(r chi.Router) {
				media.RegisterAdminRoutes(r, mediaService)
			},
		},
		publicRoutes: []routeRegistrar{
			func(r chi.Router) {
				profile.RegisterSiteRoutes(r, profileRepo)
			},
			func(r chi.Router) {
				content.RegisterSiteRoutes(r, contentRepo)
			},
			func(r chi.Router) {
				site.RegisterRoutes(r, homeRepo)
			},
			func(r chi.Router) {
				media.RegisterPublicRoutes(r, mediaService)
			},
		},
		uploadHandler: http.StripPrefix("/uploads/", http.FileServer(http.Dir(cfg.UploadsDir))),
		sitemapHandler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			body, err := site.GenerateSitemap(req.Context(), database, cfg.PublicBaseURL, time.Now().UTC())
			if err != nil {
				httpserver.WriteError(w, http.StatusInternalServerError, "internal_error", "Could not generate sitemap", nil)
				return
			}
			w.Header().Set("Content-Type", "application/xml; charset=utf-8")
			_, _ = w.Write(body)
		}),
		robotsHandler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte(site.RobotsTxt(cfg.PublicBaseURL)))
		}),
		adminPreviewHandler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("X-Robots-Tag", "noindex, nofollow")
			serveIndex(w, req, indexHTML, cfg)
		}),
		assetsHandler:  http.StripPrefix("/", http.FileServer(http.Dir(distDir))),
		faviconHandler: http.FileServer(http.Dir(filepath.Join("web", "dist"))),
		spaHandler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			serveIndex(w, req, indexHTML, cfg)
		}),
	})

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
