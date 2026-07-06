package main

import "testing"

func TestParseArgsRequiresSQLiteAndPostgres(t *testing.T) {
	if _, err := parseArgs([]string{"--sqlite", "data/portfolio.db"}); err == nil {
		t.Fatal("expected missing postgres error")
	}
	if _, err := parseArgs([]string{"--postgres", "postgres://postgres@localhost:5432/portfolio?sslmode=disable"}); err == nil {
		t.Fatal("expected missing sqlite error")
	}
}

func TestParseArgsAcceptsSQLiteAndPostgres(t *testing.T) {
	cfg, err := parseArgs([]string{
		"--sqlite", "data/portfolio.db",
		"--postgres", "postgres://postgres@localhost:5432/portfolio?sslmode=disable",
	})
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if cfg.SQLitePath != "data/portfolio.db" {
		t.Fatalf("SQLitePath = %q", cfg.SQLitePath)
	}
	if cfg.PostgresURL != "postgres://postgres@localhost:5432/portfolio?sslmode=disable" {
		t.Fatalf("PostgresURL = %q", cfg.PostgresURL)
	}
}
