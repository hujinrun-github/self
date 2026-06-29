package config

import (
	"reflect"
	"strings"
	"testing"
)

func TestLoadRequiresCoreEnv(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("APP_ORIGINS", "http://127.0.0.1:18182, https://tylerhu-1.king-shiner.ts.net:10000, http://localhost:8080/")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "1234567890abcdef")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgres://postgres@localhost:5432/portfolio?sslmode=disable")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.PublicBaseURL != "http://localhost:8080" {
		t.Fatalf("PublicBaseURL = %q", cfg.PublicBaseURL)
	}
	wantOrigins := []string{
		"http://localhost:8080",
		"http://127.0.0.1:18182",
		"https://tylerhu-1.king-shiner.ts.net:10000",
	}
	if !reflect.DeepEqual(cfg.AllowedOrigins, wantOrigins) {
		t.Fatalf("AllowedOrigins = %#v, want %#v", cfg.AllowedOrigins, wantOrigins)
	}
}

func TestLoadRejectsShortAdminPassword(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "short")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgres://postgres@localhost:5432/portfolio?sslmode=disable")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for short ADMIN_PASSWORD")
	}
}

func TestConfigStringRedactsDatabaseURL(t *testing.T) {
	passwordURL := "postgres://" + "postgres" + ":" + "secret" + "@192.168.1.20:19588/portfolio?sslmode=disable"
	cfg := Config{
		SiteName:    "Portfolio",
		DatabaseURL: passwordURL,
	}
	got := cfg.String()
	if strings.Contains(got, "secret") || strings.Contains(got, "sslmode") {
		t.Fatalf("String leaked database URL details: %s", got)
	}
	if !strings.Contains(got, "postgres://postgres@192.168.1.20:19588/portfolio") {
		t.Fatalf("String() = %q", got)
	}
}

func TestLoadIncludesOptionalTranslationConfig(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "1234567890abcdef")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgres://postgres@localhost:5432/portfolio?sslmode=disable")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	t.Setenv("TRANSLATION_PROVIDER", "deepseek")
	t.Setenv("TRANSLATION_API_KEY", "deepseek-secret")
	t.Setenv("TRANSLATION_BASE_URL", "https://api.deepseek.com")
	t.Setenv("TRANSLATION_MODEL", "deepseek-v4-flash")
	t.Setenv("TRANSLATION_TIMEOUT_SECONDS", "45")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.TranslationProvider != "deepseek" {
		t.Fatalf("TranslationProvider = %q", cfg.TranslationProvider)
	}
	if cfg.TranslationAPIKey != "deepseek-secret" {
		t.Fatalf("TranslationAPIKey = %q", cfg.TranslationAPIKey)
	}
	if cfg.TranslationBaseURL != "https://api.deepseek.com" {
		t.Fatalf("TranslationBaseURL = %q", cfg.TranslationBaseURL)
	}
	if cfg.TranslationModel != "deepseek-v4-flash" {
		t.Fatalf("TranslationModel = %q", cfg.TranslationModel)
	}
	if cfg.TranslationTimeoutSeconds != 45 {
		t.Fatalf("TranslationTimeoutSeconds = %d", cfg.TranslationTimeoutSeconds)
	}
}

func TestLoadIncludesOptionalMediaBlobConfig(t *testing.T) {
	t.Run("explicit hybrid", func(t *testing.T) {
		t.Setenv("APP_ORIGIN", "http://localhost:8080")
		t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
		t.Setenv("SITE_NAME", "Portfolio")
		t.Setenv("ADMIN_EMAIL", "admin@example.com")
		t.Setenv("ADMIN_PASSWORD", "1234567890abcdef")
		t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
		t.Setenv("DATABASE_URL", "postgres://postgres@localhost:5432/portfolio?sslmode=disable")
		t.Setenv("UPLOADS_DIR", "data/uploads")
		t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
		t.Setenv("MEDIA_BLOB_BACKEND", "hybrid")
		t.Setenv("MINIO_ENDPOINT", "http://127.0.0.1:19000")
		t.Setenv("MINIO_ACCESS_KEY", "minio-user")
		t.Setenv("MINIO_SECRET_KEY", "minio-secret")
		t.Setenv("MINIO_BUCKET", "portfolio-media")
		t.Setenv("MINIO_USE_SSL", "false")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if cfg.MediaBlobBackend != "hybrid" {
			t.Fatalf("MediaBlobBackend = %q", cfg.MediaBlobBackend)
		}
		if cfg.MinIOEndpoint != "http://127.0.0.1:19000" {
			t.Fatalf("MinIOEndpoint = %q", cfg.MinIOEndpoint)
		}
		if cfg.MinIOAccessKey != "minio-user" {
			t.Fatalf("MinIOAccessKey = %q", cfg.MinIOAccessKey)
		}
		if cfg.MinIOSecretKey != "minio-secret" {
			t.Fatalf("MinIOSecretKey = %q", cfg.MinIOSecretKey)
		}
		if cfg.MinIOBucket != "portfolio-media" {
			t.Fatalf("MinIOBucket = %q", cfg.MinIOBucket)
		}
		if cfg.MinIOUseSSL {
			t.Fatal("MinIOUseSSL = true, want false")
		}

		got := cfg.String()
		if strings.Contains(got, "minio-secret") {
			t.Fatalf("String leaked MinIO secret: %s", got)
		}
	})

	t.Run("defaults backend to local", func(t *testing.T) {
		t.Setenv("APP_ORIGIN", "http://localhost:8080")
		t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
		t.Setenv("SITE_NAME", "Portfolio")
		t.Setenv("ADMIN_EMAIL", "admin@example.com")
		t.Setenv("ADMIN_PASSWORD", "1234567890abcdef")
		t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
		t.Setenv("DATABASE_URL", "postgres://postgres@localhost:5432/portfolio?sslmode=disable")
		t.Setenv("UPLOADS_DIR", "data/uploads")
		t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if cfg.MediaBlobBackend != "local" {
			t.Fatalf("MediaBlobBackend = %q", cfg.MediaBlobBackend)
		}
	})
}
