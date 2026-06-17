package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppOrigin          string
	AllowedOrigins     []string
	PublicBaseURL      string
	SiteName           string
	AdminEmail         string
	AdminPassword      string
	SessionSecret      string
	DatabasePath       string
	UploadsDir         string
	PrivateUploadsDir  string
	SessionTTL         time.Duration
	SessionIdleTimeout time.Duration
}

func Load() (Config, error) {
	appOrigin := strings.TrimSpace(os.Getenv("APP_ORIGIN"))
	cfg := Config{
		AppOrigin:          appOrigin,
		AllowedOrigins:     parseAllowedOrigins(appOrigin, os.Getenv("APP_ORIGINS")),
		PublicBaseURL:      os.Getenv("PUBLIC_BASE_URL"),
		SiteName:           os.Getenv("SITE_NAME"),
		AdminEmail:         os.Getenv("ADMIN_EMAIL"),
		AdminPassword:      os.Getenv("ADMIN_PASSWORD"),
		SessionSecret:      os.Getenv("SESSION_SECRET"),
		DatabasePath:       os.Getenv("DATABASE_PATH"),
		UploadsDir:         os.Getenv("UPLOADS_DIR"),
		PrivateUploadsDir:  os.Getenv("PRIVATE_UPLOADS_DIR"),
		SessionTTL:         durationFromHours("SESSION_TTL_HOURS", 12),
		SessionIdleTimeout: durationFromMinutes("SESSION_IDLE_TIMEOUT_MINUTES", 120),
	}
	if cfg.AppOrigin == "" || cfg.PublicBaseURL == "" || cfg.SiteName == "" ||
		cfg.AdminEmail == "" || cfg.AdminPassword == "" || cfg.SessionSecret == "" ||
		cfg.DatabasePath == "" || cfg.UploadsDir == "" || cfg.PrivateUploadsDir == "" {
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

func parseAllowedOrigins(primary string, extra string) []string {
	seen := make(map[string]struct{})
	origins := make([]string, 0, 1)
	add := func(value string) {
		value = strings.TrimRight(strings.TrimSpace(value), "/")
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		origins = append(origins, value)
	}

	add(primary)
	for _, value := range strings.FieldsFunc(extra, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	}) {
		add(value)
	}
	return origins
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
	return fmt.Sprintf("site=%s db=%s", c.SiteName, c.DatabasePath)
}
