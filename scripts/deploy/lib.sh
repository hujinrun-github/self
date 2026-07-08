#!/usr/bin/env bash

set -euo pipefail

trace_command() {
  if [[ -n "${TRACE_FILE:-}" ]]; then
    printf '%s\n' "$*" >>"$TRACE_FILE"
  fi
  if is_true "${DRY_RUN:-0}"; then
    printf '%s\n' "$*"
  fi
}

is_true() {
  local value="${1:-}"
  case "${value,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

run_logged() {
  trace_command "$*"
  if is_true "${DRY_RUN:-0}"; then
    return 0
  fi
  "$@"
}

require_env_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "missing required environment variable: $name" >&2
    return 1
  fi
}

migration_fingerprint() {
  local repo="$1"
  local migrations_dir="$repo/internal/db/migrations"

  if [[ ! -d "$migrations_dir" ]]; then
    printf 'none\n'
    return 0
  fi

  (
    cd "$repo"
    find internal/db/migrations -type f -name '*.sql' -print0 \
      | sort -z \
      | xargs -0 sha256sum \
      | sha256sum \
      | awk '{print $1}'
  )
}

resolve_release_type_from_migration_fingerprint() {
  local current_fingerprint="$1"
  local target_fingerprint="$2"
  local override="${3:-auto}"

  case "$override" in
    auto|app-only|migration) ;;
    *)
      echo "unsupported release type override: $override" >&2
      return 1
      ;;
  esac

  if [[ -z "$target_fingerprint" ]]; then
    echo "target migration fingerprint is required" >&2
    return 1
  fi

  if [[ "$override" == "migration" ]]; then
    printf 'migration\n'
    return 0
  fi

  if [[ -z "$current_fingerprint" ]]; then
    if [[ "$override" == "app-only" ]]; then
      echo "cannot force app-only release without a known migration fingerprint" >&2
      return 1
    fi
    printf 'migration\n'
    return 0
  fi

  if [[ "$current_fingerprint" != "$target_fingerprint" ]]; then
    if [[ "$override" == "app-only" ]]; then
      echo "cannot force app-only release: migration fingerprint changed" >&2
      return 1
    fi
    printf 'migration\n'
    return 0
  fi

  printf 'app-only\n'
}

compose_supports_wait() {
  docker compose up --help 2>&1 | grep -Fq -- '--wait'
}

assert_port_owner_ok() {
  local port="$1"
  local docker_ps_output=""
  local listener_output=""

  docker_ps_output="$(
    docker ps --filter "name=^/portfolio-app$" --format '{{.Names}} {{.Ports}}' 2>/dev/null || true
  )"
  if printf '%s\n' "$docker_ps_output" | grep -Eq "portfolio-app .*(:|0\\.0\\.0\\.0:|\\[::\\]:)$port->"; then
    return 0
  fi

  if command -v ss >/dev/null 2>&1; then
    listener_output="$(ss -ltn "sport = :$port" 2>/dev/null || true)"
    if printf '%s\n' "$listener_output" | tail -n +2 | grep -Eq "[.:]$port([[:space:]]|$)"; then
      echo "host port $port is already in use by a non-portfolio listener" >&2
      return 1
    fi
    return 0
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "host port $port is already in use by a non-portfolio listener" >&2
      return 1
    fi
    return 0
  fi

  echo "unable to verify host port ownership for $port" >&2
  return 1
}

render_env_file() {
  local target="$1"

  require_env_value PORTFOLIO_APP_ORIGIN
  require_env_value PORTFOLIO_PUBLIC_BASE_URL
  require_env_value PORTFOLIO_SITE_NAME
  require_env_value PORTFOLIO_ADMIN_EMAIL
  require_env_value PORTFOLIO_ADMIN_PASSWORD
  require_env_value PORTFOLIO_SESSION_SECRET
  require_env_value PORTFOLIO_DATABASE_URL

  cat >"$target" <<EOF
APP_ORIGIN=${PORTFOLIO_APP_ORIGIN}
APP_ORIGINS=${PORTFOLIO_APP_ORIGINS:-$PORTFOLIO_APP_ORIGIN}
PUBLIC_BASE_URL=${PORTFOLIO_PUBLIC_BASE_URL}
SITE_NAME=${PORTFOLIO_SITE_NAME}
ADMIN_EMAIL=${PORTFOLIO_ADMIN_EMAIL}
ADMIN_PASSWORD=${PORTFOLIO_ADMIN_PASSWORD}
SESSION_SECRET=${PORTFOLIO_SESSION_SECRET}
DATABASE_URL=${PORTFOLIO_DATABASE_URL}
UPLOADS_DIR=/app/data/uploads
PRIVATE_UPLOADS_DIR=/app/data/private_uploads
MEDIA_BLOB_BACKEND=${PORTFOLIO_MEDIA_BLOB_BACKEND:-local}
MINIO_ENDPOINT=${PORTFOLIO_MINIO_ENDPOINT:-}
MINIO_ACCESS_KEY=${PORTFOLIO_MINIO_ACCESS_KEY:-}
MINIO_SECRET_KEY=${PORTFOLIO_MINIO_SECRET_KEY:-}
MINIO_BUCKET=${PORTFOLIO_MINIO_BUCKET:-}
MINIO_USE_SSL=${PORTFOLIO_MINIO_USE_SSL:-false}
TRANSLATION_PROVIDER=${PORTFOLIO_TRANSLATION_PROVIDER:-}
TRANSLATION_API_KEY=${PORTFOLIO_TRANSLATION_API_KEY:-}
TRANSLATION_BASE_URL=${PORTFOLIO_TRANSLATION_BASE_URL:-}
TRANSLATION_MODEL=${PORTFOLIO_TRANSLATION_MODEL:-}
TRANSLATION_TIMEOUT_SECONDS=${PORTFOLIO_TRANSLATION_TIMEOUT_SECONDS:-30}
PORT=8080
PORT_HOST=${PORTFOLIO_PORT_HOST:-4300}
EOF
}

require_pg_dump_or_container_fallback() {
  if command -v pg_dump >/dev/null 2>&1; then
    printf 'host\n'
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    printf 'container\n'
    return 0
  fi
  echo "pg_dump is unavailable and docker fallback is not installed" >&2
  return 1
}

parse_database_url() {
  local raw="$1"
  local without_scheme userinfo hostpath hostport dbquery user password host port dbname

  without_scheme="${raw#postgres://}"
  without_scheme="${without_scheme#postgresql://}"
  if [[ "$without_scheme" == "$raw" ]]; then
    echo "unsupported database url: $raw" >&2
    return 1
  fi
  if [[ "$without_scheme" != *@* ]]; then
    echo "database url is missing userinfo or host" >&2
    return 1
  fi

  userinfo="${without_scheme%%@*}"
  hostpath="${without_scheme#*@}"
  hostport="${hostpath%%/*}"
  dbquery="${hostpath#*/}"
  dbname="${dbquery%%\?*}"

  user="${userinfo%%:*}"
  if [[ "$userinfo" == *:* ]]; then
    password="${userinfo#*:}"
  else
    password=""
  fi

  if [[ "$hostport" == *:* ]]; then
    host="${hostport%%:*}"
    port="${hostport##*:}"
  else
    host="$hostport"
    port="5432"
  fi

  printf '%s\n%s\n%s\n%s\n%s\n' "$host" "$port" "$user" "$password" "$dbname"
}

load_database_connection_parts() {
  local raw_url="${PORTFOLIO_DATABASE_URL:-}"
  local parsed=()

  require_env_value PORTFOLIO_DATABASE_URL

  mapfile -t parsed < <(parse_database_url "$raw_url")
  DB_HOST="${POSTGRES_HOST:-${parsed[0]}}"
  DB_PORT="${POSTGRES_PORT:-${parsed[1]}}"
  DB_USER="${PORTFOLIO_DB_USER:-${parsed[2]}}"
  DB_PASSWORD="${PORTFOLIO_DB_PASSWORD:-${parsed[3]}}"
  DB_NAME="${POSTGRES_DB:-${parsed[4]}}"
}

run_schema_backup() {
  local backup_dir="$1"
  local sha="$2"
  local stamp file strategy

  load_database_connection_parts
  strategy="$(require_pg_dump_or_container_fallback)"
  stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
  file="$backup_dir/${stamp}-${sha}-schema.sql"

  if [[ "$strategy" == "host" ]]; then
    trace_command "pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --schema-only"
    if is_true "${DRY_RUN:-0}"; then
      return 0
    fi
    PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --schema-only >"$file"
    return 0
  fi

  trace_command "docker run --rm postgres:16-alpine pg_dump --schema-only"
  if is_true "${DRY_RUN:-0}"; then
    return 0
  fi
  docker run --rm \
    -e PGPASSWORD="$DB_PASSWORD" \
    -e POSTGRES_HOST="$DB_HOST" \
    -e POSTGRES_PORT="$DB_PORT" \
    -e POSTGRES_DB="$DB_NAME" \
    -e PORTFOLIO_DB_USER="$DB_USER" \
    -e BACKUP_FILE="$(basename "$file")" \
    -v "$backup_dir:/backup" \
    postgres:16-alpine \
    sh -lc 'pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$PORTFOLIO_DB_USER" -d "$POSTGRES_DB" --schema-only > "/backup/$BACKUP_FILE"'
}

run_full_backup() {
  local backup_dir="$1"
  local sha="$2"
  local stamp file strategy

  load_database_connection_parts
  strategy="$(require_pg_dump_or_container_fallback)"
  stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
  file="$backup_dir/${stamp}-${sha}-full.dump"

  if [[ "$strategy" == "host" ]]; then
    trace_command "pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -Fc"
    if is_true "${DRY_RUN:-0}"; then
      return 0
    fi
    PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc >"$file"
    return 0
  fi

  trace_command "docker run --rm postgres:16-alpine pg_dump -Fc"
  if is_true "${DRY_RUN:-0}"; then
    return 0
  fi
  docker run --rm \
    -e PGPASSWORD="$DB_PASSWORD" \
    -e POSTGRES_HOST="$DB_HOST" \
    -e POSTGRES_PORT="$DB_PORT" \
    -e POSTGRES_DB="$DB_NAME" \
    -e PORTFOLIO_DB_USER="$DB_USER" \
    -e BACKUP_FILE="$(basename "$file")" \
    -v "$backup_dir:/backup" \
    postgres:16-alpine \
    sh -lc 'pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$PORTFOLIO_DB_USER" -d "$POSTGRES_DB" -Fc > "/backup/$BACKUP_FILE"'
}
