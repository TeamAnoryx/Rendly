#!/usr/bin/env bash
# Installs dependencies for Claude Code on the web (cloud sessions).
# Runs from the SessionStart hook in .claude/settings.json; no-op on local machines.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

install_deps() {
  local dir="$1"
  echo "[cloud-setup] installing dependencies in ${dir}"
  if [ -f "${dir}/package-lock.json" ]; then
    (cd "${dir}" && npm ci --no-audit --no-fund) || (cd "${dir}" && npm install --no-audit --no-fund)
  else
    (cd "${dir}" && npm install --no-audit --no-fund)
  fi
}

install_deps "${ROOT}/backend"
install_deps "${ROOT}/frontend"

# Secrets are never committed. Configure them as environment variables in the
# claude.ai/code environment settings; see CLOUD.md for the list.
for var in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY JWT_SECRET; do
  if [ -z "${!var:-}" ]; then
    echo "[cloud-setup] warning: ${var} is not set; the auth-service will not reach Supabase" >&2
  fi
done

echo "[cloud-setup] done"
