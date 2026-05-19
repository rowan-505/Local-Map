#!/usr/bin/env bash
# Generate Mermaid ERD from LOCAL_RAW_DATABASE_URL into
# infrastructure/database/introspection/local/erd/local-current-db.mmd
#
# Usage (from repo root): npm run db:erd:local

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=env.sh
source "${SCRIPT_DIR}/env.sh"

if ! command -v npx >/dev/null 2>&1; then
  echo "error: npx not found (install Node.js)." >&2
  exit 1
fi

local_pg_log_target

export DATABASE_URL="${LOCAL_RAW_DATABASE_URL}"
export ERD_OUTPUT_PATH="infrastructure/database/introspection/local/erd/local-current-db.mmd"
export ERD_SOURCE_LABEL="local PostgreSQL (LOCAL_RAW_DATABASE_URL)"
export ERD_SCHEMAS="${LOCAL_PG_ERD_SCHEMAS}"

mkdir -p "$(dirname "${LOCAL_PG_ERD_OUT}")"
(cd "${REPO_ROOT}" && npx --yes tsx tools/database/generate-erd.ts)
