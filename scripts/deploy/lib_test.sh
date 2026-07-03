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
  git -C "$FIXTURE_REPO" init -q
  git -C "$FIXTURE_REPO" config user.email "codex@example.com"
  git -C "$FIXTURE_REPO" config user.name "Codex"

  mkdir -p "$FIXTURE_REPO/internal/db/migrations" "$FIXTURE_REPO/cmd/server"
  cat <<'EOF' > "$FIXTURE_REPO/cmd/server/main.go"
package main

func main() {}
EOF
  git -C "$FIXTURE_REPO" add .
  git -C "$FIXTURE_REPO" commit -qm "base"
  BASE_SHA="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"

  cat <<'EOF' > "$FIXTURE_REPO/cmd/server/main.go"
package main

func main() {
	println("updated")
}
EOF
  git -C "$FIXTURE_REPO" commit -qam "app only change"
  APP_SHA="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"

  cat <<'EOF' > "$FIXTURE_REPO/internal/db/migrations/001_test.sql"
create table demo(id bigint primary key);
EOF
  git -C "$FIXTURE_REPO" add internal/db/migrations/001_test.sql
  git -C "$FIXTURE_REPO" commit -qm "migration change"
  MIGRATION_SHA="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
}

cleanup() {
  if [[ -n "$FIXTURE_REPO" && -d "$FIXTURE_REPO" ]]; then
    rm -rf "$FIXTURE_REPO"
  fi
}

trap cleanup EXIT

test_release_type_detects_migration_diff() {
  local actual
  actual="$(resolve_release_type "$FIXTURE_REPO" "$APP_SHA" "$MIGRATION_SHA" "auto")"
  assert_eq "$actual" "migration" "auto release type should detect migration diff"
}

test_release_type_detects_app_only_diff() {
  local actual
  actual="$(resolve_release_type "$FIXTURE_REPO" "$BASE_SHA" "$APP_SHA" "auto")"
  assert_eq "$actual" "app-only" "auto release type should stay app-only without migration diff"
}

test_release_type_defaults_to_migration_without_current_sha() {
  local actual
  actual="$(resolve_release_type "$FIXTURE_REPO" "" "$APP_SHA" "auto")"
  assert_eq "$actual" "migration" "missing current sha should force migration release"
}

test_manual_app_only_rejects_migration_diff() {
  local output
  if output="$(resolve_release_type "$FIXTURE_REPO" "$APP_SHA" "$MIGRATION_SHA" "app-only" 2>&1)"; then
    fail "expected app-only override to fail when migrations changed"
  fi
  assert_contains "$output" "migration files changed" "override failure should explain migration diff"
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
  test_release_type_detects_migration_diff
  test_release_type_detects_app_only_diff
  test_release_type_defaults_to_migration_without_current_sha
  test_manual_app_only_rejects_migration_diff
  test_render_env_file_maps_portfolio_prefix
  test_compose_supports_wait_detects_flag
  test_assert_port_owner_ok_allows_existing_portfolio_app
  test_assert_port_owner_ok_rejects_foreign_listener
  echo "PASS: lib.sh contract tests passed"
}

main "$@"
