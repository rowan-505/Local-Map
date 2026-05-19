#!/usr/bin/env bash
# Shared helpers for Supabase / remote Postgres introspection (not used at app runtime).
# Loads repo root .env when present; requires DATABASE_URL.
# Never prints credentials.

set -euo pipefail

_supabase_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export REPO_ROOT="$(cd "${_supabase_script_dir}/../../../../.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${REPO_ROOT}/.env"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set (add it to ${REPO_ROOT}/.env — see .env.example)" >&2
  exit 1
fi

supabase_pg_log_target() {
  python3 -c "
import os
from urllib.parse import urlparse
raw = os.environ.get('DATABASE_URL', '')
u = urlparse(raw)
host = u.hostname or '(unknown host)'
port = u.port or 5432
db = (u.path or '').lstrip('/') or '(unknown db)'
print(f'[supabase-db] target {host}:{port}/{db}')
"
}

export SUPABASE_PG_ERD_OUT="${REPO_ROOT}/infrastructure/database/introspection/supabase/erd/current.mmd"
export SUPABASE_PG_ERD_MD="${REPO_ROOT}/docs/database/current-erd.md"

export SUPABASE_PG_ERD_SCHEMAS="${SUPABASE_PG_ERD_SCHEMAS:-ref,core,tiles,app_auth}"
