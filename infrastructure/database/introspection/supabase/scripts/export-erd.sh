#!/usr/bin/env bash
# Generate Mermaid ERD from DATABASE_URL (Supabase) into
# infrastructure/database/introspection/supabase/erd/current.mmd
#
# Usage (from repo root): npm run db:erd:supabase

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=env.sh
source "${SCRIPT_DIR}/env.sh"

if ! command -v npx >/dev/null 2>&1; then
  echo "error: npx not found (install Node.js)." >&2
  exit 1
fi

supabase_pg_log_target

export ERD_OUTPUT_PATH="infrastructure/database/introspection/supabase/erd/current.mmd"
export ERD_SOURCE_LABEL="Supabase (DATABASE_URL)"
export ERD_SCHEMAS="${SUPABASE_PG_ERD_SCHEMAS}"

mkdir -p "$(dirname "${SUPABASE_PG_ERD_OUT}")"
(cd "${REPO_ROOT}" && npx --yes tsx tools/database/generate-erd.ts)
