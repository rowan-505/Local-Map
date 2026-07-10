#!/usr/bin/env bash
# =============================================================================
# transport-fast-publish pipeline runner
#
# Heavy OSM extraction happens ONLY in local Postgres. Supabase receives only
# final normalized rows into transport.*. Supabase never gets tmp/raw/staging
# schemas and osm2pgsql is never run against Supabase.
#
# Two DB connections:
#   * LOCAL_DATABASE_URL           — osm2pgsql, tmp_transport_import,
#                                    local_transport_publish, local validation.
#   * SUPABASE_DIRECT_DATABASE_URL — ONLY final upsert into Supabase transport.*
#                                    (required only when PUBLISH_TO_SUPABASE=true).
#
# Modes:
#   * Local-only test mode: PUBLISH_TO_SUPABASE=false (default). Prepares local
#     schemas, runs osm2pgsql + local normalize/validate. Touches nothing remote.
#   * Publish mode: PUBLISH_TO_SUPABASE=true. Runs everything local first, then
#     the Supabase publish stages against SUPABASE_DIRECT_DATABASE_URL.
#
# Usage:
#   ./run_transport_fast_publish_pipeline.sh imports/myanmar_transport_2026_06_v1.env
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

LOCAL_SQL_DIR="${SCRIPT_DIR}/sql/local"
SUPABASE_SQL_DIR="${SCRIPT_DIR}/sql/supabase"
PREPARE_SQL="${LOCAL_SQL_DIR}/00_prepare_local_transport_import.sql"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <import-env-file>

  Exactly one argument: path to a sourced imports/*.env file.

  Local-only test mode (default, PUBLISH_TO_SUPABASE=false):
    - prepares tmp_transport_import + local_transport_publish on LOCAL_DATABASE_URL
    - runs osm2pgsql against LOCAL_DATABASE_URL only (per IMPORT_* phase flags)
    - runs local normalize/validate SQL against LOCAL_DATABASE_URL
    - never touches Supabase

  Publish mode (PUBLISH_TO_SUPABASE=true):
    - runs all local stages first
    - then runs Supabase publish SQL against SUPABASE_DIRECT_DATABASE_URL only

  All output is appended to a timestamped log under LOG_DIR (default: logs/).

Copy template:
  cp imports/template.full.env imports/myanmar_transport_2026_06_v1.env
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

resolve_import_env_file() {
  local arg="$1"
  if [[ -f "${arg}" ]]; then
    echo "$(cd "$(dirname "${arg}")" && pwd)/$(basename "${arg}")"
    return 0
  fi
  if [[ -f "${SCRIPT_DIR}/${arg}" ]]; then
    echo "${SCRIPT_DIR}/${arg}"
    return 0
  fi
  return 1
}

if ! IMPORT_ENV_FILE="$(resolve_import_env_file "$1")"; then
  echo "error: import env file not found: $1" >&2
  echo "       (tried relative path and ${SCRIPT_DIR}/$1)" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${IMPORT_ENV_FILE}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required variable ${name} is empty or unset in ${IMPORT_ENV_FILE}" >&2
    exit 1
  fi
}

# Normalize a truthy env value to the literal "true" or "false".
to_bool() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo "true" ;;
    *)             echo "false" ;;
  esac
}

mask_database_url() {
  local url="$1"
  if [[ "${url}" =~ ^postgres(ql)?://([^:/@]+):[^@]*@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}:***@${BASH_REMATCH[3]}"
  elif [[ "${url}" =~ ^postgres(ql)?://([^@]+)@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}@${BASH_REMATCH[3]}"
  else
    echo "postgresql://***"
  fi
}

# -----------------------------------------------------------------------------
# Defaults + normalization
# -----------------------------------------------------------------------------
TMP_TRANSPORT_SCHEMA="${TMP_TRANSPORT_SCHEMA:-tmp_transport_import}"
LOCAL_PUBLISH_SCHEMA="${LOCAL_PUBLISH_SCHEMA:-local_transport_publish}"
TRANSPORT_SOURCE_NAME="${TRANSPORT_SOURCE_NAME:-openstreetmap}"
TRANSPORT_SOURCE_KIND="${TRANSPORT_SOURCE_KIND:-osm_pbf}"
IMPORT_SCOPE="${IMPORT_SCOPE:-whole_country}"
OSM2PGSQL_BIN="${OSM2PGSQL_BIN:-osm2pgsql}"
PSQL_BIN="${PSQL_BIN:-psql}"
KEEP_LOCAL_TMP_SCHEMA="$(to_bool "${KEEP_LOCAL_TMP_SCHEMA:-true}")"
LOG_DIR="${LOG_DIR:-logs}"
OSM2PGSQL_FLEX_FILE="${OSM2PGSQL_FLEX_FILE:-lua/osm2pgsql_transport_only.lua}"

IMPORT_POINTS="$(to_bool "${IMPORT_POINTS:-true}")"
IMPORT_INFRASTRUCTURE_LINES="$(to_bool "${IMPORT_INFRASTRUCTURE_LINES:-true}")"
IMPORT_ROUTE_METADATA="$(to_bool "${IMPORT_ROUTE_METADATA:-false}")"
IMPORT_ROUTE_PATHS="$(to_bool "${IMPORT_ROUTE_PATHS:-false}")"
IMPORT_ROUTE_STOPS="$(to_bool "${IMPORT_ROUTE_STOPS:-false}")"
PUBLISH_TO_SUPABASE="$(to_bool "${PUBLISH_TO_SUPABASE:-false}")"

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------
require_var LOCAL_DATABASE_URL
require_var PBF_PATH
require_var SNAPSHOT_VERSION

if [[ "${PUBLISH_TO_SUPABASE}" == "true" ]]; then
  require_var SUPABASE_DIRECT_DATABASE_URL
fi

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist: ${PBF_PATH}" >&2
  exit 1
fi

if [[ "${TMP_TRANSPORT_SCHEMA}" != "tmp_transport_import" ]]; then
  echo "error: TMP_TRANSPORT_SCHEMA must be exactly 'tmp_transport_import' (got '${TMP_TRANSPORT_SCHEMA}')" >&2
  exit 1
fi

if [[ "${LOCAL_PUBLISH_SCHEMA}" != "local_transport_publish" ]]; then
  echo "error: LOCAL_PUBLISH_SCHEMA must be exactly 'local_transport_publish' (got '${LOCAL_PUBLISH_SCHEMA}')" >&2
  exit 1
fi

if ! command -v "${PSQL_BIN}" >/dev/null 2>&1; then
  echo "error: psql is required (PSQL_BIN=${PSQL_BIN})" >&2
  exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
  echo "error: shasum is required to compute the PBF sha256" >&2
  exit 1
fi

if [[ ! -f "${PREPARE_SQL}" ]]; then
  echo "error: local prepare SQL not found: ${PREPARE_SQL}" >&2
  exit 1
fi

# Resolve relative paths against the pipeline directory.
if [[ "${OSM2PGSQL_FLEX_FILE}" != /* ]]; then
  OSM2PGSQL_FLEX_FILE="${SCRIPT_DIR}/${OSM2PGSQL_FLEX_FILE}"
fi
if [[ "${LOG_DIR}" != /* ]]; then
  LOG_DIR="${SCRIPT_DIR}/${LOG_DIR}"
fi

# -----------------------------------------------------------------------------
# Derived values
# -----------------------------------------------------------------------------
PBF_SHA256="$(shasum -a 256 "${PBF_PATH}" | awk '{print $1}')"
IMPORT_BATCH_KEY="${IMPORT_BATCH_KEY:-${TRANSPORT_SOURCE_NAME}:${TRANSPORT_SOURCE_KIND}:${SNAPSHOT_VERSION}}"
# Filesystem-safe batch key for the exports/ directory name.
SAFE_BATCH_KEY="${IMPORT_BATCH_KEY//[:\/]/_}"
EXPORT_DIR="${SCRIPT_DIR}/exports/${SAFE_BATCH_KEY}"

export TMP_TRANSPORT_SCHEMA LOCAL_PUBLISH_SCHEMA
export TRANSPORT_SOURCE_NAME TRANSPORT_SOURCE_KIND IMPORT_SCOPE SNAPSHOT_VERSION
export PBF_PATH PBF_SHA256 IMPORT_BATCH_KEY LOCAL_DATABASE_URL
export IMPORT_POINTS IMPORT_INFRASTRUCTURE_LINES IMPORT_ROUTE_METADATA
export IMPORT_ROUTE_PATHS IMPORT_ROUTE_STOPS PUBLISH_TO_SUPABASE

mkdir -p "${LOG_DIR}"
RUN_TS="$(date -u +"%Y%m%dT%H%M%SZ")"
SAFE_SNAPSHOT_VERSION="${SNAPSHOT_VERSION//\//_}"
LOG_FILE="${LOG_DIR}/transport-fast-publish_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.log"

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

run_stage() {
  log ""
  log "=== $1 ==="
}

# Common psql -v variables passed to every SQL stage.
psql_var_args() {
  printf '%s\0' \
    "-v" "ON_ERROR_STOP=1" \
    "-v" "tmp_schema=${TMP_TRANSPORT_SCHEMA}" \
    "-v" "publish_schema=${LOCAL_PUBLISH_SCHEMA}" \
    "-v" "pbf_path=${PBF_PATH}" \
    "-v" "pbf_sha256=${PBF_SHA256}" \
    "-v" "source_name=${TRANSPORT_SOURCE_NAME}" \
    "-v" "source_kind=${TRANSPORT_SOURCE_KIND}" \
    "-v" "import_scope=${IMPORT_SCOPE}" \
    "-v" "snapshot_version=${SNAPSHOT_VERSION}" \
    "-v" "import_batch_key=${IMPORT_BATCH_KEY}" \
    "-v" "import_points=${IMPORT_POINTS}" \
    "-v" "import_infrastructure_lines=${IMPORT_INFRASTRUCTURE_LINES}" \
    "-v" "import_route_metadata=${IMPORT_ROUTE_METADATA}" \
    "-v" "import_route_paths=${IMPORT_ROUTE_PATHS}" \
    "-v" "import_route_stops=${IMPORT_ROUTE_STOPS}"
}

run_psql_file() {
  local conn_url="$1"
  local sql_file="$2"
  if [[ ! -f "${sql_file}" ]]; then
    echo "error: SQL file not found: ${sql_file}" >&2
    exit 1
  fi
  local -a vargs=()
  while IFS= read -r -d '' item; do
    vargs+=("${item}")
  done < <(psql_var_args)
  # pipefail makes a failing psql abort the pipeline even through tee.
  PAGER=cat "${PSQL_BIN}" "${conn_url}" \
    "${vargs[@]}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${sql_file}" \
    2>&1 | tee -a "${LOG_FILE}"
}

# LOCAL is the only connection allowed for tmp/publish/validation SQL.
run_local_sql() {
  run_psql_file "${LOCAL_DATABASE_URL}" "$1"
}

# Guard: Supabase SQL must never reference the local tmp schema or create
# permanent tmp/raw/staging schemas. Session temp tables (_pub_*) are allowed.
guard_supabase_sql() {
  local sql_file="$1"
  if grep -Eiq 'tmp_transport_import|local_transport_publish|create[[:space:]]+schema' "${sql_file}"; then
    echo "error: Supabase SQL must not reference tmp/local schemas or CREATE SCHEMA: ${sql_file}" >&2
    exit 1
  fi
}

# Export the local publish buffer to CSV files for transfer (LOCAL connection).
# Geometry is exported as hex EWKB; jsonb columns round-trip through CSV.
export_local_publish() {
  mkdir -p "${EXPORT_DIR}"
  log "exporting local_transport_publish.* to ${EXPORT_DIR}"
  # The buffer is single-source by construction (stage 00 truncates it), so no
  # source_name filter is needed here (psql variables are not interpolated
  # reliably inside \copy). The point/line entity sets are scoped by entity_type.
  PAGER=cat "${PSQL_BIN}" "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\copy (SELECT external_id, source_kind, source_name, import_batch_key, stop_code, name, name_mm, name_en, mode, stop_type, parent_stop_external_id, admin_area_external_id, source_refs, normalized_data, confidence_score, review_status, encode(ST_AsEWKB(geom),'hex') AS geom_hex FROM local_transport_publish.stops) TO '${EXPORT_DIR}/stops.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, stop_external_id, source_kind, source_name, import_batch_key, name, language_code, script_code, name_type, is_primary, search_weight, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.stop_names) TO '${EXPORT_DIR}/stop_names.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, source_kind, source_name, import_batch_key, linked_stop_external_id, operator_external_id, terminal_code, name, name_mm, name_en, mode, terminal_role, admin_area_external_id, source_refs, normalized_data, confidence_score, review_status, encode(ST_AsEWKB(geom),'hex') AS geom_hex FROM local_transport_publish.terminals) TO '${EXPORT_DIR}/terminals.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, source_kind, source_name, import_batch_key, mode, line_type, name, name_mm, name_en, admin_area_external_id, source_refs, normalized_data, confidence_score, review_status, encode(ST_AsEWKB(geom),'hex') AS geom_hex FROM local_transport_publish.infrastructure_lines) TO '${EXPORT_DIR}/infrastructure_lines.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key, source_url, source_payload, is_primary, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.source_links WHERE entity_type IN ('stop','terminal','infrastructure_line')) TO '${EXPORT_DIR}/source_links.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, entity_type, source_kind, source_name, import_batch_key, error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.import_errors) TO '${EXPORT_DIR}/import_errors.csv' WITH (FORMAT csv, HEADER true)
EOSQL
}

# Publish to Supabase in a SINGLE psql session so the session temp tables created
# by _session_temp_tables.sql survive across \copy and the upsert/verify steps.
run_supabase_publish() {
  local f10="${SUPABASE_SQL_DIR}/10_create_supabase_import_batch.sql"
  local f11="${SUPABASE_SQL_DIR}/11_publish_points_to_supabase.sql"
  local f12="${SUPABASE_SQL_DIR}/12_verify_supabase_points.sql"
  local ftmp="${SUPABASE_SQL_DIR}/_session_temp_tables.sql"
  local f
  for f in "${f10}" "${ftmp}" "${f11}" "${f12}"; do
    if [[ ! -f "${f}" ]]; then
      echo "error: missing Supabase publish SQL: ${f}" >&2
      exit 1
    fi
    guard_supabase_sql "${f}"
  done

  export_local_publish

  log "publishing to Supabase transport.* (single session) on SUPABASE_DIRECT_DATABASE_URL"
  PAGER=cat "${PSQL_BIN}" "${SUPABASE_DIRECT_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v source_name="${TRANSPORT_SOURCE_NAME}" \
    -v source_kind="${TRANSPORT_SOURCE_KIND}" \
    -v import_scope="${IMPORT_SCOPE}" \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v pbf_path="${PBF_PATH}" \
    -v pbf_sha256="${PBF_SHA256}" \
    -v import_batch_key="${IMPORT_BATCH_KEY}" \
    2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\set ON_ERROR_STOP on
\i ${f10}
\i ${ftmp}
\copy _pub_stops FROM '${EXPORT_DIR}/stops.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_stop_names FROM '${EXPORT_DIR}/stop_names.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_terminals FROM '${EXPORT_DIR}/terminals.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_infrastructure_lines FROM '${EXPORT_DIR}/infrastructure_lines.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_source_links FROM '${EXPORT_DIR}/source_links.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_import_errors FROM '${EXPORT_DIR}/import_errors.csv' WITH (FORMAT csv, HEADER true)
\i ${f11}
\i ${f12}
EOSQL
}

# Export the local route buffer to CSV files for transfer (LOCAL connection).
# Routes/variants/names carry no geometry; jsonb columns round-trip through CSV.
export_local_routes() {
  mkdir -p "${EXPORT_DIR}"
  log "exporting local route buffer to ${EXPORT_DIR}"
  PAGER=cat "${PSQL_BIN}" "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\copy (SELECT external_id, source_kind, source_name, import_batch_key, route_code, public_name, mode, route_kind, origin_name, destination_name, description, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.routes) TO '${EXPORT_DIR}/routes.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, route_external_id, source_kind, source_name, import_batch_key, name, language_code, script_code, name_type, is_primary, search_weight, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.route_names) TO '${EXPORT_DIR}/route_names.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, route_external_id, source_kind, source_name, import_batch_key, variant_code, direction_name, direction_id, headsign, origin_stop_external_id, destination_stop_external_id, origin_name, destination_name, distance_m, estimated_duration_min, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.route_variants) TO '${EXPORT_DIR}/route_variants.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key, source_url, source_payload, is_primary, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.source_links WHERE entity_type IN ('route','route_variant')) TO '${EXPORT_DIR}/route_source_links.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, entity_type, source_kind, source_name, import_batch_key, error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.import_errors WHERE entity_type IN ('route','route_variant')) TO '${EXPORT_DIR}/route_import_errors.csv' WITH (FORMAT csv, HEADER true)
EOSQL
}

# Publish route metadata to Supabase in a SINGLE psql session (its own batch).
run_supabase_publish_routes() {
  local f10="${SUPABASE_SQL_DIR}/10_create_supabase_import_batch.sql"
  local f13="${SUPABASE_SQL_DIR}/13_publish_routes_to_supabase.sql"
  local f14="${SUPABASE_SQL_DIR}/14_verify_supabase_routes.sql"
  local ftmp="${SUPABASE_SQL_DIR}/_session_temp_tables_routes.sql"
  local f
  for f in "${f10}" "${ftmp}" "${f13}" "${f14}"; do
    if [[ ! -f "${f}" ]]; then
      echo "error: missing Supabase route publish SQL: ${f}" >&2
      exit 1
    fi
    guard_supabase_sql "${f}"
  done

  export_local_routes

  log "publishing route metadata to Supabase transport.* (single session) on SUPABASE_DIRECT_DATABASE_URL"
  PAGER=cat "${PSQL_BIN}" "${SUPABASE_DIRECT_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v source_name="${TRANSPORT_SOURCE_NAME}" \
    -v source_kind="${TRANSPORT_SOURCE_KIND}" \
    -v import_scope="${IMPORT_SCOPE}" \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v pbf_path="${PBF_PATH}" \
    -v pbf_sha256="${PBF_SHA256}" \
    -v import_batch_key="${IMPORT_BATCH_KEY}" \
    2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\set ON_ERROR_STOP on
\i ${f10}
\i ${ftmp}
\copy _pub_routes FROM '${EXPORT_DIR}/routes.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_route_names FROM '${EXPORT_DIR}/route_names.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_route_variants FROM '${EXPORT_DIR}/route_variants.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_source_links FROM '${EXPORT_DIR}/route_source_links.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_import_errors FROM '${EXPORT_DIR}/route_import_errors.csv' WITH (FORMAT csv, HEADER true)
\i ${f13}
\i ${f14}
EOSQL
}

# Export the local route_path buffer to CSV (LOCAL connection).
# Geometry is exported as hex EWKB; jsonb columns round-trip through CSV.
export_local_route_paths() {
  mkdir -p "${EXPORT_DIR}"
  log "exporting local route_paths buffer to ${EXPORT_DIR}"
  PAGER=cat "${PSQL_BIN}" "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\copy (SELECT external_id, route_variant_external_id, source_kind, source_name, import_batch_key, path_kind, distance_m, source_refs, normalized_data, confidence_score, review_status, encode(ST_AsEWKB(geom),'hex') AS geom_hex FROM local_transport_publish.route_paths) TO '${EXPORT_DIR}/route_paths.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, entity_type, entity_external_id, source_kind, source_name, import_batch_key, source_url, source_payload, is_primary, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.source_links WHERE entity_type = 'route_path') TO '${EXPORT_DIR}/route_path_source_links.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, entity_type, source_kind, source_name, import_batch_key, error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.import_errors WHERE entity_type = 'route_path') TO '${EXPORT_DIR}/route_path_import_errors.csv' WITH (FORMAT csv, HEADER true)
EOSQL
}

# Publish route paths to Supabase in a SINGLE psql session (its own batch).
# Must run AFTER run_supabase_publish_routes so route_variant source_links exist.
run_supabase_publish_route_paths() {
  local f10="${SUPABASE_SQL_DIR}/10_create_supabase_import_batch.sql"
  local f15="${SUPABASE_SQL_DIR}/15_publish_route_paths_to_supabase.sql"
  local f16="${SUPABASE_SQL_DIR}/16_verify_supabase_route_paths.sql"
  local ftmp="${SUPABASE_SQL_DIR}/_session_temp_tables_route_paths.sql"
  local f
  for f in "${f10}" "${ftmp}" "${f15}" "${f16}"; do
    if [[ ! -f "${f}" ]]; then
      echo "error: missing Supabase route-path publish SQL: ${f}" >&2
      exit 1
    fi
    guard_supabase_sql "${f}"
  done

  export_local_route_paths

  log "publishing route paths to Supabase transport.* (single session) on SUPABASE_DIRECT_DATABASE_URL"
  PAGER=cat "${PSQL_BIN}" "${SUPABASE_DIRECT_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v source_name="${TRANSPORT_SOURCE_NAME}" \
    -v source_kind="${TRANSPORT_SOURCE_KIND}" \
    -v import_scope="${IMPORT_SCOPE}" \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v pbf_path="${PBF_PATH}" \
    -v pbf_sha256="${PBF_SHA256}" \
    -v import_batch_key="${IMPORT_BATCH_KEY}" \
    2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\set ON_ERROR_STOP on
\i ${f10}
\i ${ftmp}
\copy _pub_route_paths FROM '${EXPORT_DIR}/route_paths.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_source_links FROM '${EXPORT_DIR}/route_path_source_links.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_import_errors FROM '${EXPORT_DIR}/route_path_import_errors.csv' WITH (FORMAT csv, HEADER true)
\i ${f15}
\i ${f16}
EOSQL
}

# Export the local route_stops buffer to CSV (LOCAL connection). No geometry.
export_local_route_stops() {
  mkdir -p "${EXPORT_DIR}"
  log "exporting local route_stops buffer to ${EXPORT_DIR}"
  PAGER=cat "${PSQL_BIN}" "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\copy (SELECT external_id, route_variant_external_id, stop_external_id, source_kind, source_name, import_batch_key, stop_sequence, pickup_type, drop_off_type, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.route_stops) TO '${EXPORT_DIR}/route_stops.csv' WITH (FORMAT csv, HEADER true)
\copy (SELECT external_id, entity_type, source_kind, source_name, import_batch_key, error_code, error_message, raw_payload, source_refs, normalized_data, confidence_score, review_status FROM local_transport_publish.import_errors WHERE entity_type = 'route_stop') TO '${EXPORT_DIR}/route_stop_import_errors.csv' WITH (FORMAT csv, HEADER true)
EOSQL
}

# Publish route stops to Supabase in a SINGLE psql session (its own batch).
# Must run AFTER routes (variant source_links) and points (stop source_links).
run_supabase_publish_route_stops() {
  local f10="${SUPABASE_SQL_DIR}/10_create_supabase_import_batch.sql"
  local f17="${SUPABASE_SQL_DIR}/17_publish_route_stops_to_supabase.sql"
  local f18="${SUPABASE_SQL_DIR}/18_verify_supabase_route_stops.sql"
  local ftmp="${SUPABASE_SQL_DIR}/_session_temp_tables_route_stops.sql"
  local f
  for f in "${f10}" "${ftmp}" "${f17}" "${f18}"; do
    if [[ ! -f "${f}" ]]; then
      echo "error: missing Supabase route-stop publish SQL: ${f}" >&2
      exit 1
    fi
    guard_supabase_sql "${f}"
  done

  export_local_route_stops

  log "publishing route stops to Supabase transport.* (single session) on SUPABASE_DIRECT_DATABASE_URL"
  PAGER=cat "${PSQL_BIN}" "${SUPABASE_DIRECT_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v source_name="${TRANSPORT_SOURCE_NAME}" \
    -v source_kind="${TRANSPORT_SOURCE_KIND}" \
    -v import_scope="${IMPORT_SCOPE}" \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v pbf_path="${PBF_PATH}" \
    -v pbf_sha256="${PBF_SHA256}" \
    -v import_batch_key="${IMPORT_BATCH_KEY}" \
    2>&1 <<EOSQL | tee -a "${LOG_FILE}"
\set ON_ERROR_STOP on
\i ${f10}
\i ${ftmp}
\copy _pub_route_stops FROM '${EXPORT_DIR}/route_stops.csv' WITH (FORMAT csv, HEADER true)
\copy _pub_import_errors FROM '${EXPORT_DIR}/route_stop_import_errors.csv' WITH (FORMAT csv, HEADER true)
\i ${f17}
\i ${f18}
EOSQL
}

# True if any extraction phase flag is enabled.
any_import_phase_enabled() {
  [[ "${IMPORT_POINTS}" == "true" \
     || "${IMPORT_INFRASTRUCTURE_LINES}" == "true" \
     || "${IMPORT_ROUTE_METADATA}" == "true" \
     || "${IMPORT_ROUTE_PATHS}" == "true" \
     || "${IMPORT_ROUTE_STOPS}" == "true" ]]
}

run_osm2pgsql_local() {
  if ! any_import_phase_enabled; then
    log "osm2pgsql: skipped (all IMPORT_* phase flags are false)"
    return 0
  fi
  if [[ ! -f "${OSM2PGSQL_FLEX_FILE}" ]]; then
    log "osm2pgsql: skipped (flex lua not present yet: ${OSM2PGSQL_FLEX_FILE})"
    return 0
  fi
  if ! command -v "${OSM2PGSQL_BIN}" >/dev/null 2>&1; then
    echo "error: osm2pgsql not found (OSM2PGSQL_BIN=${OSM2PGSQL_BIN})" >&2
    exit 1
  fi

  # osm2pgsql ALWAYS targets LOCAL_DATABASE_URL — never Supabase.
  local -a osm_args=(
    -d "${LOCAL_DATABASE_URL}"
    -O flex
    -S "${OSM2PGSQL_FLEX_FILE}"
    --create
    --slim
    --drop
    --verbose
  )
  if [[ -n "${OSM2PGSQL_EXTRA_ARGS:-}" ]]; then
    # shellcheck disable=SC2206
    osm_args+=(${OSM2PGSQL_EXTRA_ARGS})
  fi

  log "osm2pgsql: loading ${PBF_PATH} into ${TMP_TRANSPORT_SCHEMA} on LOCAL_DATABASE_URL"
  # shellcheck disable=SC2086
  "${OSM2PGSQL_BIN}" "${osm_args[@]}" "${PBF_PATH}" 2>&1 | tee -a "${LOG_FILE}"
}

# -----------------------------------------------------------------------------
# Resolved config
# -----------------------------------------------------------------------------
log "transport-fast-publish pipeline started at ${RUN_TS}"
log "log file: ${LOG_FILE}"
log "import env file: ${IMPORT_ENV_FILE}"
log "LOCAL_DATABASE_URL=$(mask_database_url "${LOCAL_DATABASE_URL}")"
if [[ "${PUBLISH_TO_SUPABASE}" == "true" ]]; then
  log "SUPABASE_DIRECT_DATABASE_URL=$(mask_database_url "${SUPABASE_DIRECT_DATABASE_URL}")"
else
  log "SUPABASE_DIRECT_DATABASE_URL=<unused: PUBLISH_TO_SUPABASE=false>"
fi
log "PBF_PATH=${PBF_PATH}"
log "PBF_SHA256=${PBF_SHA256}"
log "TMP_TRANSPORT_SCHEMA=${TMP_TRANSPORT_SCHEMA}"
log "LOCAL_PUBLISH_SCHEMA=${LOCAL_PUBLISH_SCHEMA}"
log "TRANSPORT_SOURCE_NAME=${TRANSPORT_SOURCE_NAME}"
log "TRANSPORT_SOURCE_KIND=${TRANSPORT_SOURCE_KIND}"
log "IMPORT_SCOPE=${IMPORT_SCOPE}"
log "SNAPSHOT_VERSION=${SNAPSHOT_VERSION}"
log "IMPORT_BATCH_KEY=${IMPORT_BATCH_KEY}"
log "KEEP_LOCAL_TMP_SCHEMA=${KEEP_LOCAL_TMP_SCHEMA}"
log "phase flags: points=${IMPORT_POINTS} infra_lines=${IMPORT_INFRASTRUCTURE_LINES} route_metadata=${IMPORT_ROUTE_METADATA} route_paths=${IMPORT_ROUTE_PATHS} route_stops=${IMPORT_ROUTE_STOPS}"
log "PUBLISH_TO_SUPABASE=${PUBLISH_TO_SUPABASE}"

# -----------------------------------------------------------------------------
# LOCAL stages
# -----------------------------------------------------------------------------
run_stage "local 00 — prepare local transport schemas"
run_local_sql "${PREPARE_SQL}"

run_stage "local — osm2pgsql extract (LOCAL only)"
run_osm2pgsql_local

run_stage "local — normalize + validate"
shopt -s nullglob
LOCAL_STAGE_RAN=0
for sql_file in "${LOCAL_SQL_DIR}"/*.sql; do
  [[ "${sql_file}" == "${PREPARE_SQL}" ]] && continue
  log "-- running local stage: $(basename "${sql_file}")"
  run_local_sql "${sql_file}"
  LOCAL_STAGE_RAN=1
done
if [[ "${LOCAL_STAGE_RAN}" -eq 0 ]]; then
  log "local normalize/validate: no additional stage SQL present yet (future phase)"
fi

# -----------------------------------------------------------------------------
# SUPABASE publish stages (only when PUBLISH_TO_SUPABASE=true)
# -----------------------------------------------------------------------------
if [[ "${PUBLISH_TO_SUPABASE}" == "true" ]]; then
  run_stage "supabase — export + publish points to transport.* (SUPABASE only)"
  run_supabase_publish

  if [[ "${IMPORT_ROUTE_METADATA}" == "true" ]]; then
    run_stage "supabase — export + publish route metadata to transport.* (SUPABASE only)"
    run_supabase_publish_routes
  else
    log "route metadata publish skipped (IMPORT_ROUTE_METADATA != true)"
  fi

  if [[ "${IMPORT_ROUTE_PATHS}" == "true" ]]; then
    if [[ "${IMPORT_ROUTE_METADATA}" == "true" ]]; then
      run_stage "supabase — export + publish route paths to transport.* (SUPABASE only)"
      run_supabase_publish_route_paths
    else
      log "route path publish skipped: IMPORT_ROUTE_PATHS=true requires IMPORT_ROUTE_METADATA=true (route_variant source_links must exist first)"
    fi
  else
    log "route path publish skipped (IMPORT_ROUTE_PATHS != true)"
  fi

  if [[ "${IMPORT_ROUTE_STOPS}" == "true" ]]; then
    if [[ "${IMPORT_ROUTE_METADATA}" == "true" ]]; then
      run_stage "supabase — export + publish route stops to transport.* (SUPABASE only)"
      run_supabase_publish_route_stops
    else
      log "route stop publish skipped: IMPORT_ROUTE_STOPS=true requires IMPORT_ROUTE_METADATA=true (route_variant source_links must exist first)"
    fi
  else
    log "route stop publish skipped (IMPORT_ROUTE_STOPS != true)"
  fi

  run_stage "supabase — rebuild unified search transport families"
  SEARCH_REBUILD_VIEWS=("bus_stops")
  if [[ "$(to_bool "${IMPORT_ROUTE_METADATA:-}")" == "true" ]]; then
    SEARCH_REBUILD_VIEWS+=("bus_routes")
  fi
  SEARCH_REBUILD_VIEWS_CSV="$(IFS=,; echo "${SEARCH_REBUILD_VIEWS[*]}")"
  log "rebuilding search families: ${SEARCH_REBUILD_VIEWS_CSV}"
  (
    cd "${REPO_ROOT}/apps/api"
    DATABASE_URL="${SUPABASE_DIRECT_DATABASE_URL}" npx tsx src/scripts/rebuild-search-index.ts --views "${SEARCH_REBUILD_VIEWS_CSV}"
  ) 2>&1 | tee -a "${LOG_FILE}"
else
  run_stage "supabase — publish skipped"
  log "PUBLISH_TO_SUPABASE=false: local-only run; Supabase untouched."
fi
shopt -u nullglob

# -----------------------------------------------------------------------------
# Optional cleanup of local tmp schema
# -----------------------------------------------------------------------------
if [[ "${KEEP_LOCAL_TMP_SCHEMA}" != "true" ]]; then
  run_stage "local — drop ${TMP_TRANSPORT_SCHEMA}"
  PAGER=cat "${PSQL_BIN}" "${LOCAL_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -c "drop schema if exists ${TMP_TRANSPORT_SCHEMA} cascade;" \
    2>&1 | tee -a "${LOG_FILE}"
fi

log ""
log "transport-fast-publish pipeline finished OK at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
