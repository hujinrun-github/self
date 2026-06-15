package config

import "testing"

func TestLoadRequiresCoreEnv(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "1234567890abcdef")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_PATH", "data/portfolio.db")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.PublicBaseURL != "http://localhost:8080" {
		t.Fatalf("PublicBaseURL = %q", cfg.PublicBaseURL)
	}
}

func TestLoadRejectsShortAdminPassword(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:8080")
	t.Setenv("PUBLIC_BASE_URL", "http://localhost:8080")
	t.Setenv("SITE_NAME", "Portfolio")
	t.Setenv("ADMIN_EMAIL", "admin@example.com")
	t.Setenv("ADMIN_PASSWORD", "short")
	t.Setenv("SESSION_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_PATH", "data/portfolio.db")
	t.Setenv("UPLOADS_DIR", "data/uploads")
	t.Setenv("PRIVATE_UPLOADS_DIR", "data/private_uploads")
	if _, err := Load(); err == nil {
		t.Fatal("expected error for short ADMIN_PASSWORD")
	}
}
