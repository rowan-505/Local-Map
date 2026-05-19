#!/usr/bin/env bash
# Shared helpers for local Postgres introspection (not used at app runtime).
# Loads repo root .env when present; requires LOCAL_RAW_DATABASE_URL.
# Never prints credentials.

set -euo pipefail

_local_pg_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export REPO_ROOT="$(cd "${_local_pg_script_dir}/../../../../.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${REPO_ROOT}/.env"
  set +a
fi

if [[ -z "${LOCAL_RAW_DATABASE_URL:-}" ]]; then
  echo "error: LOCAL_RAW_DATABASE_URL is not set (add it to ${REPO_ROOT}/.env — see .env.example)" >&2
  exit 1
fi

local_pg_log_target() {
  python3 -c "
import os
from urllib.parse import urlparse
raw = os.environ.get('LOCAL_RAW_DATABASE_URL', '')
u = urlparse(raw)
host = u.hostname or '(unknown host)'
port = u.port or 5432
db = (u.path or '').lstrip('/') or '(unknown db)'
print(f'[local-db] target {host}:{port}/{db}')
"
}

export LOCAL_PG_SCHEMA_OUT="${REPO_ROOT}/infrastructure/database/introspection/local/schema/local-db-schema.sql"
export LOCAL_PG_ERD_OUT="${REPO_ROOT}/infrastructure/database/introspection/local/erd/local-current-db.mmd"

export LOCAL_PG_ERD_SCHEMAS="${LOCAL_PG_ERD_SCHEMAS:-ref,core,raw,staging,system,tiles,routing,search,app_auth}"
