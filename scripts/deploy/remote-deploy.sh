#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

run_minio_preflight_if_needed() {
  local endpoint object_key network trace

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
  network="${PORTFOLIO_MINIO_PREFLIGHT_NETWORK:-default}"
  trace="docker run --rm"
  if [[ "$network" != "default" ]]; then
    trace="$trace --network $network"
  fi
  trace="$trace --add-host host.docker.internal:host-gateway"
  trace="$trace --entrypoint /bin/sh minio/mc -lc minio preflight"
  trace_command "$trace"
  if is_true "${DRY_RUN:-0}"; then
    return 0
  fi

  if [[ "$network" == "default" ]]; then
    docker run --rm \
      --add-host host.docker.internal:host-gateway \
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
    return 0
  fi

  docker run --rm \
    --network "$network" \
    --add-host host.docker.internal:host-gateway \
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

compose_up_current_release() {
  local wait_supported="$1"
  local host_port="$2"

  if [[ "$wait_supported" -eq 1 ]]; then
    run_logged docker compose up -d --remove-orphans --wait
    return 0
  fi

  run_logged docker compose up -d --remove-orphans
  wait_for_health "$host_port"
}

compose_up_rollback_release() {
  local wait_supported="$1"
  local host_port="$2"

  if [[ "$wait_supported" -eq 1 ]]; then
    run_logged docker compose up -d --no-build --force-recreate --wait portfolio-app
    return 0
  fi

  run_logged docker compose up -d --no-build --force-recreate portfolio-app
  wait_for_health "$host_port"
}

capture_rollback_image() {
  if is_true "${DRY_RUN:-0}"; then
    return 0
  fi
  docker inspect -f '{{.Image}}' portfolio-app 2>/dev/null || true
}

capture_rollback_image_tag() {
  if is_true "${DRY_RUN:-0}"; then
    return 0
  fi
  docker inspect -f '{{.Config.Image}}' portfolio-app 2>/dev/null || true
}

restore_env_backup() {
  local env_backup="$1"

  if [[ -f "$env_backup" ]]; then
    cp "$env_backup" ".env"
  fi
}

rollback_to_previous_service() {
  local rollback_image="$1"
  local rollback_tag="$2"
  local env_backup="$3"
  local wait_supported="$4"
  local host_port="$5"

  echo "deploy cutover failed; attempting to keep the previous portfolio-app version online" >&2
  restore_env_backup "$env_backup"

  if [[ -z "$rollback_image" || -z "$rollback_tag" ]]; then
    echo "previous portfolio-app image was not captured; cannot perform image rollback" >&2
    return 0
  fi

  if is_true "${DRY_RUN:-0}"; then
    trace_command "docker tag $rollback_image $rollback_tag"
    trace_command "docker compose rm -sf portfolio-app"
  else
    docker tag "$rollback_image" "$rollback_tag"
    docker compose rm -sf portfolio-app >/dev/null 2>&1 || true
  fi

  compose_up_rollback_release "$wait_supported" "$host_port"
}

main() {
  local app_dir="${PORTFOLIO_APP_DIR:-$PWD}"
  local state_file fingerprint_file current_fingerprint="" target_fingerprint release_override release_type wait_supported=0 host_port
  local env_backup="" rollback_image="" rollback_tag="" rollback_on_error=0

  require_env_value GITHUB_SHA

  if [[ ! -d "$app_dir" ]]; then
    echo "remote app dir does not exist: $app_dir" >&2
    return 1
  fi
  cd "$app_dir"
  mkdir -p runtime
  state_file="runtime/.last_deployed_sha"
  fingerprint_file="runtime/.last_migrations_fingerprint"
  if [[ -f "$fingerprint_file" ]]; then
    current_fingerprint="$(tr -d '[:space:]' <"$fingerprint_file")"
  fi

  release_override="${RELEASE_TYPE:-auto}"
  target_fingerprint="$(migration_fingerprint "$app_dir")"
  release_type="$(resolve_release_type_from_migration_fingerprint "$current_fingerprint" "$target_fingerprint" "$release_override")"

  host_port="${PORTFOLIO_PORT_HOST:-4300}"
  assert_port_owner_ok "$host_port"

  if compose_supports_wait; then
    wait_supported=1
  fi

  mkdir -p runtime/uploads runtime/private_uploads runtime/backups
  env_backup="runtime/.env.before-${GITHUB_SHA}"
  if [[ -f ".env" ]]; then
    cp ".env" "$env_backup"
  else
    rm -f "$env_backup"
  fi
  render_env_file ".env"
  run_minio_preflight_if_needed

  if [[ "$release_type" == "migration" ]]; then
    run_schema_backup "runtime/backups" "$GITHUB_SHA"
    run_full_backup "runtime/backups" "$GITHUB_SHA"
  fi

  run_quiet_logged docker compose config
  rollback_image="$(capture_rollback_image)"
  rollback_tag="$(capture_rollback_image_tag)"
  run_logged docker compose build

  trap 'status=$?; trap - ERR; if [[ "$rollback_on_error" -eq 1 ]]; then rollback_to_previous_service "$rollback_image" "$rollback_tag" "$env_backup" "$wait_supported" "$host_port" || true; fi; exit "$status"' ERR
  rollback_on_error=1
  compose_up_current_release "$wait_supported" "$host_port"
  rollback_on_error=0
  trap - ERR

  run_logged docker compose ps
  run_logged docker compose logs --tail=100 portfolio-app

  if ! is_true "${DRY_RUN:-0}"; then
    printf '%s\n' "$GITHUB_SHA" >"$state_file"
    printf '%s\n' "$target_fingerprint" >"$fingerprint_file"
  fi
}

main "$@"
