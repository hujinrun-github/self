package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppOrigin          string
	PublicBaseURL      string
	SiteName           string
	AdminEmail         string
	AdminPassword      string
	SessionSecret      string
	DatabaseURL        string
	UploadsDir         string
	PrivateUploadsDir  string
	SessionTTL         time.Duration
	SessionIdleTimeout time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		AppOrigin:          os.Getenv("APP_ORIGIN"),
		PublicBaseURL:      os.Getenv("PUBLIC_BASE_URL"),
		SiteName:           os.Getenv("SITE_NAME"),
		AdminEmail:         os.Getenv("ADMIN_EMAIL"),
		AdminPassword:      os.Getenv("ADMIN_PASSWORD"),
		SessionSecret:      os.Getenv("SESSION_SECRET"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		UploadsDir:         os.Getenv("UPLOADS_DIR"),
		PrivateUploadsDir:  os.Getenv("PRIVATE_UPLOADS_DIR"),
		SessionTTL:         durationFromHours("SESSION_TTL_HOURS", 12),
		SessionIdleTimeout: durationFromMinutes("SESSION_IDLE_TIMEOUT_MINUTES", 120),
	}
	if cfg.AppOrigin == "" || cfg.PublicBaseURL == "" || cfg.SiteName == "" ||
		cfg.AdminEmail == "" || cfg.AdminPassword == "" || cfg.SessionSecret == "" ||
		cfg.DatabaseURL == "" || cfg.UploadsDir == "" || cfg.PrivateUploadsDir == "" {
		return Config{}, errors.New("missing required runtime configuration")
	}
	if len(cfg.AdminPassword) < 16 {
		return Config{}, errors.New("ADMIN_PASSWORD must be at least 16 characters")
	}
	if len(cfg.SessionSecret) < 32 {
		return Config{}, errors.New("SESSION_SECRET must be at least 32 characters")
	}
	return cfg, nil
}

func durationFromHours(name string, fallback int) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return time.Duration(fallback) * time.Hour
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * time.Hour
	}
	return time.Duration(n) * time.Hour
}

func durationFromMinutes(name string, fallback int) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return time.Duration(fallback) * time.Minute
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * time.Minute
	}
	return time.Duration(n) * time.Minute
}

func (c Config) String() string {
	return fmt.Sprintf("site=%s db=%s", c.SiteName, redactDatabaseURL(c.DatabaseURL))
}

func redactDatabaseURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "invalid"
	}
	if parsed.User != nil {
		username := parsed.User.Username()
		parsed.User = url.User(username)
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
