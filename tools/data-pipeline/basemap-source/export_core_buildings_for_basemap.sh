#!/usr/bin/env bash
# Read-only Supabase export of core.core_map_buildings for local basemap merge.
# Writes CSV (+ checksum) under artifacts/. Never writes to Supabase.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"
SQL_FILE="${SCRIPT_DIR}/sql/export_core_buildings_for_basemap.sql"
ARTIFACT_ROOT="${SCRIPT_DIR}/artifacts"
STAMP="${CORE_BASEMAP_MERGE_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUT="${ARTIFACT_ROOT}/core_basemap_merge_${STAMP}"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${SUPABASE_READ_DATABASE_URL:?Set SUPABASE_READ_DATABASE_URL (or source prod-mirror/00_env.sh)}"

mkdir -p "${OUT}"
CSV="${OUT}/core_buildings_export.csv"
SHA="${OUT}/core_buildings_export.csv.sha256"
COUNT_FILE="${OUT}/export_counts.txt"

echo "==> Exporting Core buildings (read-only) → ${CSV}"

psql "${SUPABASE_READ_DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
CREATE TEMP VIEW _core_buildings_basemap_export AS
$(cat "${SQL_FILE}");
\\copy (SELECT * FROM _core_buildings_basemap_export) TO '${CSV}' WITH (FORMAT csv, HEADER true)
SQL

ROW_COUNT=$(($(wc -l < "${CSV}") - 1))
if [[ "${ROW_COUNT}" -lt 1 ]]; then
  echo "Export produced zero data rows: ${CSV}" >&2
  exit 1
fi

(
  cd "${OUT}"
  shasum -a 256 "$(basename "${CSV}")" | tee "$(basename "${SHA}")"
)

{
  echo "stamp=${STAMP}"
  echo "rows=${ROW_COUNT}"
  echo "csv=${CSV}"
  echo "sha256_file=${SHA}"
  date -u +"exported_at=%Y-%m-%dT%H:%M:%SZ"
} | tee "${COUNT_FILE}"

echo "EXPORT_OK rows=${ROW_COUNT} out=${OUT}"
echo "${OUT}"
