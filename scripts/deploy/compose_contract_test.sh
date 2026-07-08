#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_contains() {
  local needle="$1"
  if ! grep -Fq -- "$needle" docker-compose.yml; then
    fail "expected docker-compose.yml to contain: $needle"
  fi
}

assert_file_not_contains() {
  local needle="$1"
  if grep -Fq -- "$needle" docker-compose.yml; then
    fail "expected docker-compose.yml to not contain: $needle"
  fi
}

assert_contains() {
  local needle="$1"
  if ! grep -Fq -- "$needle" "$CONFIG_OUTPUT"; then
    fail "expected compose config to contain: $needle"
  fi
}

assert_regex() {
  local pattern="$1"
  if ! grep -Eq -- "$pattern" "$CONFIG_OUTPUT"; then
    fail "expected compose config to match: $pattern"
  fi
}

CONFIG_OUTPUT="$(mktemp)"
TEMP_ENV_CREATED=0

cleanup() {
  rm -f "$CONFIG_OUTPUT"
  if [[ "$TEMP_ENV_CREATED" -eq 1 ]]; then
    rm -f .env
  fi
}

trap cleanup EXIT

if [[ ! -f .env ]]; then
  TEMP_ENV_CREATED=1
  cat <<'EOF' > .env
# Temporary fixture for local Compose contract validation.
EOF
fi

assert_file_contains 'env_file:'
assert_file_contains '- .env'
assert_file_not_contains 'required:'

if ! PORT_HOST=4300 docker compose -f docker-compose.yml config >"$CONFIG_OUTPUT" 2>&1; then
  cat "$CONFIG_OUTPUT" >&2
  fail "docker compose config did not succeed"
fi

assert_regex '^services:$'
assert_regex '^[[:space:]]+portfolio-app:$'
assert_contains 'container_name: portfolio-app'
assert_contains 'restart: unless-stopped'
assert_contains 'host.docker.internal=host-gateway'

assert_contains 'published: "4300"'
assert_contains 'target: 8080'

assert_contains 'healthcheck:'
assert_contains 'wget -qO- http://127.0.0.1:8080/api/health'

assert_contains 'target: /app/data/uploads'
assert_regex 'runtime[\\/]uploads'

assert_contains 'target: /app/data/private_uploads'
assert_regex 'runtime[\\/]private_uploads'

echo "PASS: docker-compose.yml matches the expected contract"
