package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func Open(databaseURL string) (*sql.DB, error) {
	database, err := openDatabase(databaseURL)
	if err != nil {
		return nil, err
	}

	if err := pingDatabase(context.Background(), database); err != nil {
		_ = database.Close()
		return nil, err
	}
	if err := Migrate(database); err != nil {
		_ = database.Close()
		return nil, err
	}
	return database, nil
}

func openDatabase(databaseURL string) (*sql.DB, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, fmt.Errorf("database url is required")
	}
	if !isValidDatabaseURL(databaseURL) {
		return nil, fmt.Errorf("database url is invalid")
	}

	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres: invalid database configuration")
	}
	database.SetMaxOpenConns(10)
	database.SetMaxIdleConns(5)
	database.SetConnMaxLifetime(30 * time.Minute)

	return database, nil
}

func pingDatabase(ctx context.Context, database *sql.DB) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := database.PingContext(ctx); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("ping postgres: %w", err)
		}
		if strings.Contains(err.Error(), "cannot parse `") {
			return fmt.Errorf("ping postgres: invalid database configuration")
		}
		return fmt.Errorf("ping postgres: connection failed")
	}
	return nil
}

func isValidDatabaseURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (parsed.Scheme == "postgres" || parsed.Scheme == "postgresql") && parsed.Host != ""
}
