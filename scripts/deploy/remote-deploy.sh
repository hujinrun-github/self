#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

normalize_minio_endpoint_url() {
  local raw="${PORTFOLIO_MINIO_ENDPOINT:-}"
  if [[ -z "$raw" ]]; then
    echo ""
    return 0
  fi
  if [[ "$raw" == *"://"* ]]; then
    printf '%s\n' "$raw"
    return 0
  fi
  if is_true "${PORTFOLIO_MINIO_USE_SSL:-false}"; then
    printf 'https://%s\n' "$raw"
    return 0
  fi
  printf 'http://%s\n' "$raw"
}

run_minio_preflight_if_needed() {
  local endpoint object_key

  if [[ "${PORTFOLIO_MEDIA_BLOB_BACKEND:-local}" != "hybrid" ]]; then
    return 0
  fi

  require_env_value PORTFOLIO_MINIO_ACCESS_KEY
  require_env_value PORTFOLIO_MINIO_SECRET_KEY
  require_env_value PORTFOLIO_MINIO_BUCKET

  endpoint="$(normalize_minio_endpoint_url)"
  if [[ -z "$endpoint" ]]; then
    echo "missing required environment variable: PORTFOLIO_MINIO_ENDPOINT" >&2
    return 1
  fi

  object_key="_healthchecks/${GITHUB_SHA:-manual}-$(date -u +%s).txt"
  trace_command "docker run --rm --entrypoint /bin/sh minio/mc -lc minio preflight"
  if is_true "${DRY_RUN:-0}"; then
    return 0
  fi

  docker run --rm \
    -e MINIO_ENDPOINT="$endpoint" \
    -e MINIO_ACCESS_KEY="${PORTFOLIO_MINIO_ACCESS_KEY}" \
    -e MINIO_SECRET_KEY="${PORTFOLIO_MINIO_SECRET_KEY}" \
    -e MINIO_BUCKET="${PORTFOLIO_MINIO_BUCKET}" \
    -e HEALTHCHECK_OBJECT="$object_key" \
    --entrypoint /bin/sh \
    minio/mc \
    -lc '
      mc alias set portfolio "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null &&
      mc ls "portfolio/$MINIO_BUCKET" >/dev/null &&
      printf healthcheck | mc pipe "portfolio/$MINIO_BUCKET/$HEALTHCHECK_OBJECT" >/dev/null &&
      mc cat "portfolio/$MINIO_BUCKET/$HEALTHCHECK_OBJECT" >/dev/null &&
      mc rm "portfolio/$MINIO_BUCKET/$HEALTHCHECK_OBJECT" >/dev/null
    '
}

wait_for_health() {
  local port="$1"
  local url="http://127.0.0.1:${port}/api/health"
  local attempt

  if command -v curl >/dev/null 2>&1; then
    trace_command "curl -fsS $url"
    if is_true "${DRY_RUN:-0}"; then
      return 0
    fi
    for attempt in $(seq 1 30); do
      if curl -fsS "$url" >/dev/null; then
        return 0
      fi
      sleep 2
    done
    echo "health check did not succeed: $url" >&2
    return 1
  fi

  if command -v wget >/dev/null 2>&1; then
    trace_command "wget -qO- $url"
    if is_true "${DRY_RUN:-0}"; then
      return 0
    fi
    for attempt in $(seq 1 30); do
      if wget -qO- "$url" >/dev/null; then
        return 0
      fi
      sleep 2
    done
    echo "health check did not succeed: $url" >&2
    return 1
  fi

  echo "neither curl nor wget is available for health polling" >&2
  return 1
}

main() {
  local app_dir="${PORTFOLIO_APP_DIR:-$PWD}"
  local state_file current_sha="" release_override release_type wait_supported=0 host_port

  require_env_value GITHUB_SHA

  if [[ ! -d "$app_dir" ]]; then
    echo "remote app dir does not exist: $app_dir" >&2
    return 1
  fi
  cd "$app_dir"
  mkdir -p runtime
  state_file="runtime/.last_deployed_sha"
  if [[ -f "$state_file" ]]; then
    current_sha="$(tr -d '[:space:]' <"$state_file")"
  fi

  run_logged git fetch --all --tags --prune
  run_logged git checkout --detach "$GITHUB_SHA"

  release_override="${RELEASE_TYPE:-auto}"
  release_type="$(resolve_release_type "$app_dir" "$current_sha" "$GITHUB_SHA" "$release_override")"

  host_port="${PORTFOLIO_PORT_HOST:-4300}"
  assert_port_owner_ok "$host_port"

  if compose_supports_wait; then
    wait_supported=1
  fi

  mkdir -p runtime/uploads runtime/private_uploads runtime/backups
  render_env_file ".env"
  run_minio_preflight_if_needed

  if [[ "$release_type" == "migration" ]]; then
    run_logged docker compose stop portfolio-app
    run_schema_backup "runtime/backups" "$GITHUB_SHA"
    run_full_backup "runtime/backups" "$GITHUB_SHA"
  fi

  run_logged docker compose config
  run_logged docker compose build

  if [[ "$wait_supported" -eq 1 ]]; then
    run_logged docker compose up -d --remove-orphans --wait
  else
    run_logged docker compose up -d --remove-orphans
    wait_for_health "$host_port"
  fi

  run_logged docker compose ps
  run_logged docker compose logs --tail=100 portfolio-app

  if ! is_true "${DRY_RUN:-0}"; then
    printf '%s\n' "$GITHUB_SHA" >"$state_file"
  fi
}

main "$@"
