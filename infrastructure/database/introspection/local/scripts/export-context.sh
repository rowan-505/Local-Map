#!/usr/bin/env bash
# Export schema-only DDL from local Postgres into
# infrastructure/database/introspection/local/schema/local-db-schema.sql (pg_dump).
# Optionally refresh infrastructure/database/introspection/local/erd/local-current-db.mmd.
#
# Usage (from repo root):
#   npm run db:context:local          # schema + ERD
#   npm run db:schema:local           # schema SQL only (--schema-only)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=env.sh
source "${SCRIPT_DIR}/env.sh"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "error: pg_dump not found. Install PostgreSQL client tools (e.g. brew install libpq && brew link --force libpq)." >&2
  exit 1
fi

schema_only=false
for arg in "$@"; do
  if [[ "${arg}" == "--schema-only" ]]; then
    schema_only=true
  fi
done

mkdir -p "$(dirname "${LOCAL_PG_SCHEMA_OUT}")"

local_pg_log_target

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

pg_dump "${LOCAL_RAW_DATABASE_URL}" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file="${tmp}"

grep -v '^\\restrict ' "${tmp}" >"${tmp}.stripped"
mv "${tmp}.stripped" "${tmp}"

{
  echo "--"
  echo "-- Local database schema snapshot (generated, do not edit by hand)"
  echo "-- Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "-- Source: LOCAL_RAW_DATABASE_URL from repo root .env"
  echo "-- Regenerate: npm run db:schema:local   (SQL only)"
  echo "--            npm run db:context:local (SQL + ERD)"
  echo "--"
  echo
  cat "${tmp}"
} >"${LOCAL_PG_SCHEMA_OUT}"

echo "[local-db] wrote ${LOCAL_PG_SCHEMA_OUT#"${REPO_ROOT}/"}"

if [[ "${schema_only}" == true ]]; then
  exit 0
fi

export DATABASE_URL="${LOCAL_RAW_DATABASE_URL}"
export ERD_OUTPUT_PATH="infrastructure/database/introspection/local/erd/local-current-db.mmd"
export ERD_SOURCE_LABEL="local PostgreSQL (LOCAL_RAW_DATABASE_URL)"
export ERD_SCHEMAS="${LOCAL_PG_ERD_SCHEMAS}"

mkdir -p "$(dirname "${LOCAL_PG_ERD_OUT}")"
(cd "${REPO_ROOT}" && npx --yes tsx tools/database/generate-erd.ts)
