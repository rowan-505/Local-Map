#!/usr/bin/env bash
# One-time Core → basemap_source.buildings merge orchestrator (local geo_core).
# Supabase is read-only (export only). Never deletes local basemap rows.
#
# Usage:
#   ./run_core_basemap_merge.sh --dry-run
#   EXECUTE_CORE_BASEMAP_MERGE=I_UNDERSTAND ./run_core_basemap_merge.sh --apply
#
# Optional:
#   --export-only
#   --skip-export   (reuse CORE_BASEMAP_MERGE_DIR or latest artifact)
#   CORE_BASEMAP_MERGE_STAMP=...
#   CORE_BASEMAP_MERGE_DIR=...
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SQL_DIR="${SCRIPT_DIR}/sql"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"
MIG011="${REPO_ROOT}/infrastructure/database/migrations/local/011_basemap_buildings_core_lineage.sql"
ARTIFACT_ROOT="${SCRIPT_DIR}/artifacts"
STAMP="${CORE_BASEMAP_MERGE_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"

MODE="dry-run"
SKIP_EXPORT=0
EXPORT_ONLY=0

usage() {
  cat <<'EOF'
usage: run_core_basemap_merge.sh [--dry-run|--apply|--export-only] [--skip-export]

  --dry-run       Export (unless skipped), load, classify, report (default)
  --apply         Same as dry-run, then apply writes (requires gate)
  --export-only   Only export from Supabase
  --skip-export   Reuse existing export CSV (CORE_BASEMAP_MERGE_DIR or latest)

Apply gate:
  EXECUTE_CORE_BASEMAP_MERGE=I_UNDERSTAND
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --export-only) EXPORT_ONLY=1; shift ;;
    --skip-export) SKIP_EXPORT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

run_psql() {
  if [[ "${PSQL_MODE}" == "docker" ]]; then
    local args=()
    local file=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -f) file="$2"; shift 2 ;;
        *) args+=("$1"); shift ;;
      esac
    done
    if [[ -n "${file}" ]]; then
      [[ -r "${file}" ]] || { echo "SQL file not readable: ${file}" >&2; exit 1; }
      "${PSQL[@]}" -X -v ON_ERROR_STOP=1 "${args[@]}" < "${file}"
    else
      "${PSQL[@]}" -X -v ON_ERROR_STOP=1 "${args[@]}"
    fi
  else
    "${PSQL[@]}" -X -v ON_ERROR_STOP=1 "$@"
  fi
}

resolve_psql() {
  if [[ -n "${LOCAL_DATABASE_URL:-}" ]]; then
    PSQL=(psql "${LOCAL_DATABASE_URL}")
    PSQL_MODE="url"
    return
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'geo-postgis'; then
    PSQL=(docker exec -i geo-postgis psql -U postgres -d geo_core)
    PSQL_MODE="docker"
    return
  fi
  echo "Set LOCAL_DATABASE_URL or start docker container geo-postgis" >&2
  exit 1
}

resolve_psql

ensure_migration() {
  echo "==> Ensuring migration 011 (core lineage columns)"
  local has_col
  has_col="$(run_psql -At -c "SELECT 1 FROM information_schema.columns WHERE table_schema='basemap_source' AND table_name='buildings' AND column_name='core_public_id' LIMIT 1;")"
  if [[ "${has_col}" == "1" ]]; then
    echo "    migration 011 columns already present; skip"
    return
  fi
  run_psql -f "${MIG011}"
}

resolve_out_dir() {
  if [[ -n "${CORE_BASEMAP_MERGE_DIR:-}" ]]; then
    OUT="${CORE_BASEMAP_MERGE_DIR}"
    return
  fi
  if [[ "${SKIP_EXPORT}" -eq 1 ]]; then
    OUT="$(ls -1dt "${ARTIFACT_ROOT}"/core_basemap_merge_* 2>/dev/null | head -1 || true)"
    if [[ -z "${OUT}" || ! -d "${OUT}" ]]; then
      echo "No existing core_basemap_merge_* artifact found; run without --skip-export" >&2
      exit 1
    fi
    return
  fi
  OUT="${ARTIFACT_ROOT}/core_basemap_merge_${STAMP}"
}

export_core() {
  echo "==> Export Core buildings from Supabase (read-only)"
  CORE_BASEMAP_MERGE_STAMP="${STAMP}" \
    bash "${SCRIPT_DIR}/export_core_buildings_for_basemap.sh" | tee "${OUT}/00_export.log"
  # export script prints OUT path as last line; prefer known path
  if [[ ! -f "${OUT}/core_buildings_export.csv" ]]; then
    # script may have created stamp dir itself
    OUT="$(ls -1dt "${ARTIFACT_ROOT}"/core_basemap_merge_* | head -1)"
  fi
  [[ -s "${OUT}/core_buildings_export.csv" ]] || {
    echo "Missing export CSV under ${OUT}" >&2
    exit 1
  }
}

load_export() {
  local csv="${OUT}/core_buildings_export.csv"
  echo "==> Loading export into basemap_source.core_buildings_export"
  run_psql -f "${SQL_DIR}/create_core_buildings_export_staging.sql"

  # Host-path COPY works with LOCAL_DATABASE_URL; docker needs stdin COPY.
  local copy_opts="FORMAT csv, HEADER true, NULL '', FORCE_NULL (external_id, source_feature_type, source_feature_id, source_registry_id, building_type_code, admin_area_id, levels, height_m, confidence, verification_status, is_active, is_soft_deleted, deleted_at, is_geometry_manually_edited, is_attributes_manually_edited, core_name, geom_type, geom_srid)"
  if [[ "${PSQL_MODE}" == "url" ]]; then
    run_psql -c "\\copy basemap_source.core_buildings_export FROM '${csv}' WITH (${copy_opts})"
  else
    "${PSQL[@]}" -X -v ON_ERROR_STOP=1 -c \
      "\\copy basemap_source.core_buildings_export FROM STDIN WITH (${copy_opts})" \
      < "${csv}"
  fi

  run_psql -At -c "SELECT 'loaded_export_rows='||count(*) FROM basemap_source.core_buildings_export;" \
    | tee "${OUT}/loaded_counts.txt"
}

capture_before() {
  run_psql -At <<'SQL' | tee "${OUT}/before_counts.txt"
SELECT 'local_total='||count(*) FROM basemap_source.buildings;
SELECT 'osm_rows='||count(*) FROM basemap_source.buildings WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL;
SELECT 'managed_rows='||count(*) FROM basemap_source.buildings WHERE source_type = 'coremap';
SELECT 'linked_core='||count(*) FROM basemap_source.buildings WHERE core_public_id IS NOT NULL;
SQL
}

run_merge() {
  local execute_flag="$1"
  echo "==> Classify / merge (execute=${execute_flag})"
  run_psql \
    -c "SELECT set_config('coremap.execute_merge', '${execute_flag}', false);" \
    -f "${SQL_DIR}/merge_core_into_basemap_buildings.sql" \
    | tee "${OUT}/merge_${execute_flag}.log"
}

export_report_csv() {
  local report="${OUT}/merge_report.csv"
  echo "==> Writing report CSV → ${report}"
  if [[ "${PSQL_MODE}" == "url" ]]; then
    run_psql -c "\\copy (
      SELECT core_id, core_public_id, external_id, action, reason,
             local_id, geom_hash_equal, typed_local_id, canon_local_id,
             is_soft_deleted
      FROM basemap_source.core_buildings_merge_report
      ORDER BY action, core_id
    ) TO '${report}' WITH (FORMAT csv, HEADER true)"
  else
    "${PSQL[@]}" -X -v ON_ERROR_STOP=1 -c \
      "\\copy (
        SELECT core_id, core_public_id, external_id, action, reason,
               local_id, geom_hash_equal, typed_local_id, canon_local_id,
               is_soft_deleted
        FROM basemap_source.core_buildings_merge_report
        ORDER BY action, core_id
      ) TO STDOUT WITH (FORMAT csv, HEADER true)" \
      > "${report}"
  fi
}

run_verify() {
  echo "==> Verify"
  run_psql -f "${SQL_DIR}/verify_core_basemap_merge.sql" | tee "${OUT}/verify.log"
  run_psql -At <<'SQL' | tee "${OUT}/after_counts.txt"
SELECT 'local_total='||count(*) FROM basemap_source.buildings;
SELECT 'osm_rows='||count(*) FROM basemap_source.buildings WHERE osm_feature_type IS NOT NULL AND osm_id IS NOT NULL;
SELECT 'managed_rows='||count(*) FROM basemap_source.buildings WHERE source_type = 'coremap';
SELECT 'linked_core='||count(*) FROM basemap_source.buildings WHERE core_public_id IS NOT NULL;
SQL
}

# --- main ---
mkdir -p "${ARTIFACT_ROOT}"
resolve_out_dir
mkdir -p "${OUT}"

if [[ "${EXPORT_ONLY}" -eq 1 ]]; then
  export_core
  echo "EXPORT_ONLY_OK out=${OUT}"
  exit 0
fi

ensure_migration

if [[ "${SKIP_EXPORT}" -eq 0 ]]; then
  export_core
else
  echo "==> Skipping export; using ${OUT}"
  [[ -s "${OUT}/core_buildings_export.csv" ]] || {
    echo "Missing ${OUT}/core_buildings_export.csv" >&2
    exit 1
  }
fi

capture_before
load_export

# Always classify dry-run first (writes report, no apply)
run_merge "0"
export_report_csv

# Reconcile expected count into artifact
{
  echo "stamp=${STAMP}"
  echo "mode=${MODE}"
  echo "out=${OUT}"
  grep -E '^(to_insert|expected_local_after|local_before|action=)' "${OUT}/merge_0.log" || true
} | tee "${OUT}/dry_run_summary.txt"

if [[ "${MODE}" == "apply" ]]; then
  if [[ "${EXECUTE_CORE_BASEMAP_MERGE:-}" != "I_UNDERSTAND" ]]; then
    echo "APPLY blocked: set EXECUTE_CORE_BASEMAP_MERGE=I_UNDERSTAND" >&2
    exit 1
  fi
  OSM_BEFORE="$(grep -E '^osm_rows=' "${OUT}/before_counts.txt" | cut -d= -f2)"
  run_merge "1"
  export_report_csv
  run_verify
  OSM_AFTER="$(grep -E '^osm_rows=' "${OUT}/after_counts.txt" | cut -d= -f2)"
  if [[ -n "${OSM_BEFORE}" && -n "${OSM_AFTER}" && "${OSM_BEFORE}" != "${OSM_AFTER}" ]]; then
    echo "VERIFY FAIL: osm_rows changed ${OSM_BEFORE} → ${OSM_AFTER}" >&2
    exit 1
  fi
  echo "APPLY_OK out=${OUT}"
else
  echo "DRY_RUN_OK out=${OUT} (no local writes except staging/report tables)"
  echo "Report CSV: ${OUT}/merge_report.csv"
fi
