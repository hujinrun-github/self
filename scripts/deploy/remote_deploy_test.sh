#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_trace_contains() {
  local trace_file="$1"
  local needle="$2"
  if ! grep -Fq -- "$needle" "$trace_file"; then
    fail "expected trace to contain: $needle"
  fi
}

line_number() {
  local trace_file="$1"
  local needle="$2"
  local line
  line="$(grep -nF -- "$needle" "$trace_file" | head -n1 | cut -d: -f1)"
  if [[ -z "$line" ]]; then
    fail "expected trace line for: $needle"
  fi
  printf '%s\n' "$line"
}

run_remote_deploy() {
  local app_dir="$1"
  local trace_file="$2"

  (
    cd "$app_dir"
    PATH="$SCRIPT_DIR/test-bin:$PATH" \
    TRACE_FILE="$trace_file" \
    GITHUB_SHA="deadbeef" \
    RELEASE_TYPE="${RELEASE_TYPE:-migration}" \
    DRY_RUN=1 \
    PORTFOLIO_APP_ORIGIN="https://portfolio.example.com" \
    PORTFOLIO_APP_ORIGINS="https://portfolio.example.com" \
    PORTFOLIO_PUBLIC_BASE_URL="https://portfolio.example.com" \
    PORTFOLIO_SITE_NAME="Portfolio" \
    PORTFOLIO_ADMIN_EMAIL="admin@example.com" \
    PORTFOLIO_ADMIN_PASSWORD="1234567890abcdef" \
    PORTFOLIO_SESSION_SECRET="0123456789abcdef0123456789abcdef" \
    PORTFOLIO_DATABASE_URL="postgres://portfolio_app:secret@127.0.0.1:19588/portfolio?sslmode=disable" \
    PORTFOLIO_DB_USER="portfolio_app" \
    PORTFOLIO_DB_PASSWORD="secret" \
    PORTFOLIO_MEDIA_BLOB_BACKEND="local" \
    PORTFOLIO_MINIO_ENDPOINT="http://127.0.0.1:19000" \
    PORTFOLIO_MINIO_ACCESS_KEY="minio-user" \
    PORTFOLIO_MINIO_SECRET_KEY="minio-secret" \
    PORTFOLIO_MINIO_BUCKET="portfolio-media" \
    PORTFOLIO_MINIO_USE_SSL="false" \
    PORTFOLIO_TRANSLATION_PROVIDER="deepseek" \
    PORTFOLIO_TRANSLATION_API_KEY="deepseek-key" \
    PORTFOLIO_TRANSLATION_BASE_URL="https://api.deepseek.com" \
    PORTFOLIO_TRANSLATION_MODEL="deepseek-v4-flash" \
    PORTFOLIO_TRANSLATION_TIMEOUT_SECONDS="30" \
    PORTFOLIO_PORT_HOST="4300" \
    MOCK_DOCKER_HELP="${MOCK_DOCKER_HELP:---wait}" \
    MOCK_DOCKER_PS="${MOCK_DOCKER_PS:-}" \
    MOCK_SS_OUTPUT="${MOCK_SS_OUTPUT:-}" \
    MOCK_GIT_HEAD="${MOCK_GIT_HEAD:-current-sha}" \
      bash "$SCRIPT_DIR/remote-deploy.sh"
  )
}

test_migration_release_stops_before_backup_and_pins_sha() {
  local app_dir trace_file stop_line schema_line full_line config_line build_line up_line
  app_dir="$(mktemp -d)"
  trace_file="$(mktemp)"

  run_remote_deploy "$app_dir" "$trace_file"

  assert_trace_contains "$trace_file" "git fetch --all --tags --prune"
  assert_trace_contains "$trace_file" "git checkout --detach deadbeef"
  assert_trace_contains "$trace_file" "docker compose stop portfolio-app"
  assert_trace_contains "$trace_file" "pg_dump -h 127.0.0.1 -p 19588 -U portfolio_app -d portfolio --schema-only"
  assert_trace_contains "$trace_file" "pg_dump -h 127.0.0.1 -p 19588 -U portfolio_app -d portfolio -Fc"
  assert_trace_contains "$trace_file" "docker compose config"
  assert_trace_contains "$trace_file" "docker compose build"
  assert_trace_contains "$trace_file" "docker compose up -d --remove-orphans --wait"

  stop_line="$(line_number "$trace_file" "docker compose stop portfolio-app")"
  schema_line="$(line_number "$trace_file" "pg_dump -h 127.0.0.1 -p 19588 -U portfolio_app -d portfolio --schema-only")"
  full_line="$(line_number "$trace_file" "pg_dump -h 127.0.0.1 -p 19588 -U portfolio_app -d portfolio -Fc")"
  config_line="$(line_number "$trace_file" "docker compose config")"
  build_line="$(line_number "$trace_file" "docker compose build")"
  up_line="$(line_number "$trace_file" "docker compose up -d --remove-orphans --wait")"

  [[ "$stop_line" -lt "$schema_line" ]] || fail "expected stop before schema backup"
  [[ "$schema_line" -lt "$full_line" ]] || fail "expected schema backup before full backup"
  [[ "$full_line" -lt "$config_line" ]] || fail "expected backups before compose config"
  [[ "$config_line" -lt "$build_line" ]] || fail "expected config before build"
  [[ "$build_line" -lt "$up_line" ]] || fail "expected build before up"

  grep -F "DATABASE_URL=postgres://portfolio_app:secret@127.0.0.1:19588/portfolio?sslmode=disable" "$app_dir/.env" >/dev/null || fail "expected .env to be rendered"
}

test_app_only_release_skips_backup_and_stop() {
  local app_dir trace_file
  app_dir="$(mktemp -d)"
  trace_file="$(mktemp)"
  mkdir -p "$app_dir/runtime"
  printf 'current-sha\n' > "$app_dir/runtime/.last_deployed_sha"

  RELEASE_TYPE="app-only" run_remote_deploy "$app_dir" "$trace_file"

  if grep -Fq "docker compose stop portfolio-app" "$trace_file"; then
    fail "app-only release should not stop the app"
  fi
  if grep -Fq "pg_dump" "$trace_file"; then
    fail "app-only release should not take database backups"
  fi
  assert_trace_contains "$trace_file" "docker compose up -d --remove-orphans --wait"
}

test_wait_fallback_polls_health_when_wait_not_supported() {
  local app_dir trace_file up_line health_line
  app_dir="$(mktemp -d)"
  trace_file="$(mktemp)"

  MOCK_DOCKER_HELP="Usage: docker compose up" run_remote_deploy "$app_dir" "$trace_file"

  assert_trace_contains "$trace_file" "docker compose up -d --remove-orphans"
  assert_trace_contains "$trace_file" "curl -fsS http://127.0.0.1:4300/api/health"

  up_line="$(line_number "$trace_file" "docker compose up -d --remove-orphans")"
  health_line="$(line_number "$trace_file" "curl -fsS http://127.0.0.1:4300/api/health")"
  [[ "$up_line" -lt "$health_line" ]] || fail "expected health poll after non-wait compose up"
}

test_dry_run_prints_planned_steps() {
  local app_dir trace_file output
  app_dir="$(mktemp -d)"
  trace_file="$(mktemp)"
  mkdir -p "$app_dir/runtime"
  printf 'current-sha\n' > "$app_dir/runtime/.last_deployed_sha"

  output="$(RELEASE_TYPE="app-only" run_remote_deploy "$app_dir" "$trace_file")"

  [[ "$output" == *"git fetch --all --tags --prune"* ]] || fail "expected dry run to print git fetch"
  [[ "$output" == *"docker compose up -d --remove-orphans --wait"* ]] || fail "expected dry run to print compose up"
}

test_missing_app_dir_fails_clearly() {
  local missing_dir trace_file output
  missing_dir="/tmp/portfolio-missing-$RANDOM"
  trace_file="$(mktemp)"

  if output="$(
    PATH="$SCRIPT_DIR/test-bin:$PATH" \
    TRACE_FILE="$trace_file" \
    GITHUB_SHA="deadbeef" \
    RELEASE_TYPE="app-only" \
    DRY_RUN=1 \
    PORTFOLIO_APP_DIR="$missing_dir" \
      bash "$SCRIPT_DIR/remote-deploy.sh" 2>&1
  )"; then
    fail "expected missing PORTFOLIO_APP_DIR path to fail"
  fi
  [[ "$output" == *"remote app dir does not exist"* ]] || fail "expected clear missing app dir error, got: $output"
}

main() {
  test_migration_release_stops_before_backup_and_pins_sha
  test_app_only_release_skips_backup_and_stop
  test_wait_fallback_polls_health_when_wait_not_supported
  test_dry_run_prints_planned_steps
  test_missing_app_dir_fails_clearly
  echo "PASS: remote-deploy.sh contract tests passed"
}

main "$@"
