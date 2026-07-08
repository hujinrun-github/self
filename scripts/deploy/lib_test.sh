#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

ORIGINAL_PATH="$PATH"
FIXTURE_REPO=""

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$message: expected '$expected', got '$actual'"
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "$message: expected to find '$needle' in '$haystack'"
  fi
}

create_fixture_repo() {
  FIXTURE_REPO="$(mktemp -d)"
  mkdir -p "$FIXTURE_REPO/internal/db/migrations" "$FIXTURE_REPO/cmd/server"
  cat <<'EOF' > "$FIXTURE_REPO/cmd/server/main.go"
package main

func main() {}
EOF
}

cleanup() {
  if [[ -n "$FIXTURE_REPO" && -d "$FIXTURE_REPO" ]]; then
    rm -rf "$FIXTURE_REPO"
  fi
}

trap cleanup EXIT

test_migration_fingerprint_changes_when_migrations_change() {
  local before after
  before="$(migration_fingerprint "$FIXTURE_REPO")"
  cat <<'EOF' > "$FIXTURE_REPO/internal/db/migrations/002_more.sql"
alter table demo add column name text;
EOF
  after="$(migration_fingerprint "$FIXTURE_REPO")"
  [[ "$before" != "$after" ]] || fail "expected migration fingerprint to change"
}

test_release_type_from_fingerprint_detects_migration() {
  local actual
  actual="$(resolve_release_type_from_migration_fingerprint "old" "new" "auto")"
  assert_eq "$actual" "migration" "auto release should detect migration fingerprint changes"
}

test_release_type_from_fingerprint_detects_app_only() {
  local actual
  actual="$(resolve_release_type_from_migration_fingerprint "same" "same" "auto")"
  assert_eq "$actual" "app-only" "auto release should stay app-only when migration fingerprint is unchanged"
}

test_app_only_override_rejects_missing_migration_fingerprint() {
  local output
  if output="$(resolve_release_type_from_migration_fingerprint "" "new" "app-only" 2>&1)"; then
    fail "expected app-only override to fail without previous migration fingerprint"
  fi
  assert_contains "$output" "known migration fingerprint" "missing fingerprint failure should explain first deploy risk"
}

test_app_only_override_rejects_changed_migration_fingerprint() {
  local output
  if output="$(resolve_release_type_from_migration_fingerprint "old" "new" "app-only" 2>&1)"; then
    fail "expected app-only override to fail when migration fingerprint changed"
  fi
  assert_contains "$output" "migration fingerprint changed" "changed fingerprint failure should explain migration risk"
}

test_render_env_file_maps_portfolio_prefix() {
  local target
  target="$(mktemp)"
  PORTFOLIO_APP_ORIGIN="https://portfolio.example.com" \
  PORTFOLIO_PUBLIC_BASE_URL="https://portfolio.example.com" \
  PORTFOLIO_SITE_NAME="Portfolio" \
  PORTFOLIO_ADMIN_EMAIL="admin@example.com" \
  PORTFOLIO_ADMIN_PASSWORD="1234567890abcdef" \
  PORTFOLIO_SESSION_SECRET="0123456789abcdef0123456789abcdef" \
  PORTFOLIO_DATABASE_URL="postgres://example" \
  PORTFOLIO_MINIO_BUCKET="portfolio-media" \
  PORTFOLIO_MEDIA_BLOB_BACKEND="hybrid" \
  PORTFOLIO_PORT_HOST="4300" \
    render_env_file "$target"
  grep -F "DATABASE_URL=postgres://example" "$target" >/dev/null || fail "expected database url mapping"
  grep -F "MINIO_BUCKET=portfolio-media" "$target" >/dev/null || fail "expected bucket mapping"
  grep -F "MEDIA_BLOB_BACKEND=hybrid" "$target" >/dev/null || fail "expected blob backend mapping"
  grep -F "PORT_HOST=4300" "$target" >/dev/null || fail "expected host port mapping"
  grep -F "UPLOADS_DIR=/app/data/uploads" "$target" >/dev/null || fail "expected uploads dir default"
  grep -F "PRIVATE_UPLOADS_DIR=/app/data/private_uploads" "$target" >/dev/null || fail "expected private uploads dir default"
  grep -F "PORT=8080" "$target" >/dev/null || fail "expected app port default"
  rm -f "$target"
}

test_render_env_file_quotes_dollar_values_for_compose() {
  local target
  target="$(mktemp)"
  PORTFOLIO_APP_ORIGIN="https://portfolio.example.com" \
  PORTFOLIO_PUBLIC_BASE_URL="https://portfolio.example.com" \
  PORTFOLIO_SITE_NAME="Portfolio" \
  PORTFOLIO_ADMIN_EMAIL="admin@example.com" \
  PORTFOLIO_ADMIN_PASSWORD='abc$yB5cHjQ1s' \
  PORTFOLIO_SESSION_SECRET="0123456789abcdef0123456789abcdef" \
  PORTFOLIO_DATABASE_URL="postgres://example" \
    render_env_file "$target"
  grep -F 'ADMIN_PASSWORD='"'"'abc$yB5cHjQ1s'"'" "$target" >/dev/null || fail "expected dollar value to be single-quoted for compose"
  rm -f "$target"
}

test_schema_backup_maps_host_docker_internal_for_host_pg_dump() {
  local backup_dir trace_file
  backup_dir="$(mktemp -d)"
  trace_file="$(mktemp)"

  PATH="$SCRIPT_DIR/test-bin:$ORIGINAL_PATH" \
  TRACE_FILE="$trace_file" \
  DRY_RUN=1 \
  PORTFOLIO_DATABASE_URL="postgres://portfolio:secret@host.docker.internal:19588/portfolio?sslmode=disable" \
    run_schema_backup "$backup_dir" "deadbeef" >/dev/null

  grep -F "pg_dump -h 127.0.0.1 -p 19588 -U portfolio -d portfolio --schema-only" "$trace_file" >/dev/null || fail "expected host pg_dump to use localhost for host.docker.internal"
  rm -rf "$backup_dir" "$trace_file"
}

test_compose_supports_wait_detects_flag() {
  PATH="$SCRIPT_DIR/test-bin:$ORIGINAL_PATH" \
  TRACE_FILE="$(mktemp)" \
  MOCK_DOCKER_HELP=$'Usage: docker compose up\n      --wait   Wait for services' \
    compose_supports_wait || fail "expected wait flag to be detected"
}

test_assert_port_owner_ok_allows_existing_portfolio_app() {
  PATH="$SCRIPT_DIR/test-bin:$ORIGINAL_PATH" \
  TRACE_FILE="$(mktemp)" \
  MOCK_DOCKER_PS='portfolio-app 0.0.0.0:4300->8080/tcp' \
  MOCK_SS_OUTPUT=$'State Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0      4096   0.0.0.0:4300      0.0.0.0:*' \
    assert_port_owner_ok "4300" || fail "expected existing portfolio-app owner to be accepted"
}

test_assert_port_owner_ok_rejects_foreign_listener() {
  local output
  if output="$(
    PATH="$SCRIPT_DIR/test-bin:$ORIGINAL_PATH" \
    TRACE_FILE="$(mktemp)" \
    MOCK_DOCKER_PS='' \
    MOCK_SS_OUTPUT=$'State Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0      4096   0.0.0.0:4300      0.0.0.0:*' \
      assert_port_owner_ok "4300" 2>&1
  )"; then
    fail "expected foreign listener to be rejected"
  fi
  assert_contains "$output" "already in use" "foreign listener failure should mention port conflict"
}

main() {
  create_fixture_repo
  test_migration_fingerprint_changes_when_migrations_change
  test_release_type_from_fingerprint_detects_migration
  test_release_type_from_fingerprint_detects_app_only
  test_app_only_override_rejects_missing_migration_fingerprint
  test_app_only_override_rejects_changed_migration_fingerprint
  test_render_env_file_maps_portfolio_prefix
  test_render_env_file_quotes_dollar_values_for_compose
  test_schema_backup_maps_host_docker_internal_for_host_pg_dump
  test_compose_supports_wait_detects_flag
  test_assert_port_owner_ok_allows_existing_portfolio_app
  test_assert_port_owner_ok_rejects_foreign_listener
  echo "PASS: lib.sh contract tests passed"
}

main "$@"
