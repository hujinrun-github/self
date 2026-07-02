#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
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
trap 'rm -f "$CONFIG_OUTPUT"' EXIT

if ! docker compose -f docker-compose.yml config >"$CONFIG_OUTPUT" 2>&1; then
  cat "$CONFIG_OUTPUT" >&2
  fail "docker compose config did not succeed"
fi

assert_regex '^services:$'
assert_regex '^[[:space:]]+portfolio-app:$'
assert_contains 'container_name: portfolio-app'

assert_contains 'published: "4300"'
assert_contains 'target: 8080'

assert_contains 'healthcheck:'
assert_contains 'wget -qO- http://127.0.0.1:8080/api/health'

assert_contains 'target: /app/data/uploads'
assert_regex 'runtime[\\/]uploads'

assert_contains 'target: /app/data/private_uploads'
assert_regex 'runtime[\\/]private_uploads'

echo "PASS: docker-compose.yml matches the expected contract"
