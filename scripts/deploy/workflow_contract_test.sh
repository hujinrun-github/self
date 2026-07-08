#!/usr/bin/env bash

set -euo pipefail

workflow=".github/workflows/deploy.yml"

grep -F "push:" "$workflow" >/dev/null
grep -F "branches:" "$workflow" >/dev/null
grep -F -- "- main" "$workflow" >/dev/null
grep -F "workflow_dispatch:" "$workflow" >/dev/null
grep -F "release_type:" "$workflow" >/dev/null
grep -F "app-only" "$workflow" >/dev/null
grep -F "migration" "$workflow" >/dev/null
grep -F "needs: ci" "$workflow" >/dev/null
grep -F "environment: portfolio-production" "$workflow" >/dev/null
grep -F "services:" "$workflow" >/dev/null
grep -F "postgres:" "$workflow" >/dev/null
grep -F "go test ./cmd/server ./internal/config ./internal/db ./internal/httpserver ./internal/auth ./internal/site ./internal/profile ./internal/content ./internal/media ./internal/backup ./cmd/migrate-sqlite-to-postgres -count=1" "$workflow" >/dev/null
grep -F "npm --prefix web test -- --run" "$workflow" >/dev/null
grep -F "npm --prefix web run build" "$workflow" >/dev/null
grep -F "Validate deploy configuration" "$workflow" >/dev/null
grep -F "require_env PORTFOLIO_APP_DIR" "$workflow" >/dev/null
grep -F "is required in the portfolio-production GitHub Environment" "$workflow" >/dev/null
grep -F 'git checkout --detach "$GITHUB_SHA"' "$workflow" >/dev/null
grep -F "appleboy/ssh-action" "$workflow" >/dev/null
grep -F "remote app dir does not exist" "$workflow" >/dev/null
grep -F 'bash "$PORTFOLIO_APP_DIR/scripts/deploy/remote-deploy.sh"' "$workflow" >/dev/null
grep -F "PORTFOLIO_DATABASE_URL" "$workflow" >/dev/null
grep -F "PORTFOLIO_APP_DIR" "$workflow" >/dev/null
grep -F "GITHUB_SHA" "$workflow" >/dev/null

echo "PASS: deploy workflow matches the expected contract"
