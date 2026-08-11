#!/usr/bin/env bash
# One-time local workflow:
#   1) create basemap_source.buildings
#   2) copy staging snapshot 13
#   3) verify
#   4) pg_dump backup
#   5) optional gated cleanup of staging snap 13
#
# Local geo_core only. Does not touch Supabase.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SQL_DIR="${SCRIPT_DIR}/sql"
MIG="${REPO_ROOT}/infrastructure/database/migrations/local/010_basemap_source_buildings.sql"
ARTIFACT_ROOT="${SCRIPT_DIR}/artifacts"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${ARTIFACT_ROOT}/buildings_snap13_${STAMP}"

MODE="copy" # copy | verify | backup | cleanup-dry-run | cleanup-apply | all

usage() {
  cat <<'EOF'
usage: run_basemap_buildings_preserve.sh [--all|--copy|--verify|--backup|--cleanup-dry-run|--cleanup-apply]

Defaults to --all when no mode flag is given:
  create table → copy → verify → backup → cleanup dry-run

Cleanup apply requires:
  EXECUTE_LOCAL_BUILDING_CLEANUP=I_UNDERSTAND

Database:
  LOCAL_DATABASE_URL or docker exec geo-postgis (geo_core)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) MODE="all"; shift ;;
    --copy) MODE="copy"; shift ;;
    --verify) MODE="verify"; shift ;;
    --backup) MODE="backup"; shift ;;
    --cleanup-dry-run) MODE="cleanup-dry-run"; shift ;;
    --cleanup-apply) MODE="cleanup-apply"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

run_psql() {
  if [[ "${PSQL_MODE}" == "docker" ]]; then
    # Container cannot read host -f paths; pipe file contents on stdin.
    local args=()
    local file=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -f)
          file="$2"
          shift 2
          ;;
        *)
          args+=("$1")
          shift
          ;;
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

disk_counts() {
  run_psql -At <<'SQL'
SELECT 'staging_buildings_rows='||count(*) FROM staging.staging_building_candidates;
SELECT 'staging_snap13_rows='||count(*) FROM staging.staging_building_candidates WHERE source_snapshot_id=13;
SELECT 'staging_size='||pg_size_pretty(pg_total_relation_size('staging.staging_building_candidates'));
DO $c$
DECLARE
  n bigint;
  n13 bigint;
  sz text;
BEGIN
  IF to_regclass('basemap_source.buildings') IS NULL THEN
    RAISE NOTICE 'basemap_buildings_rows=0';
    RAISE NOTICE 'basemap_snap13_rows=0';
    RAISE NOTICE 'basemap_size=n/a';
  ELSE
    EXECUTE 'SELECT count(*) FROM basemap_source.buildings' INTO n;
    EXECUTE 'SELECT count(*) FROM basemap_source.buildings WHERE source_snapshot_id=13' INTO n13;
    EXECUTE $q$SELECT pg_size_pretty(pg_total_relation_size('basemap_source.buildings'))$q$ INTO sz;
    RAISE NOTICE 'basemap_buildings_rows=%', n;
    RAISE NOTICE 'basemap_snap13_rows=%', n13;
    RAISE NOTICE 'basemap_size=%', sz;
  END IF;
END
$c$;
SQL
}

resolve_psql
mkdir -p "${OUT}"
echo "artifact_dir=${OUT}"
echo "mode=${MODE}"
echo "=== before counts ==="
disk_counts | tee "${OUT}/before_counts.txt"

do_create() {
  echo "=== create basemap_source.buildings ==="
  run_psql -f "${MIG}" | tee "${OUT}/01_create.log"
}

do_copy() {
  echo "=== copy snapshot 13 → basemap_source.buildings ==="
  run_psql \
    -c "SET statement_timeout = 0" \
    -c "SET work_mem = '256MB'" \
    -c "SET maintenance_work_mem = '1GB'" \
    -f "${SQL_DIR}/copy_buildings_from_staging_snap13.sql" \
    | tee "${OUT}/02_copy.log"
}

do_verify() {
  echo "=== verify ==="
  run_psql \
    -c "SET statement_timeout = 0" \
    -c "SET work_mem = '256MB'" \
    -f "${SQL_DIR}/verify_buildings_snap13.sql" \
    | tee "${OUT}/03_verify.log"
}

do_backup() {
  echo "=== pg_dump basemap_source.buildings ==="
  local dump="${OUT}/basemap_source_buildings.dump"
  if [[ -n "${LOCAL_DATABASE_URL:-}" ]]; then
    pg_dump "${LOCAL_DATABASE_URL}" \
      --format=custom --no-owner --no-privileges \
      --table='basemap_source.buildings' \
      --file="${dump}"
  else
    docker exec geo-postgis pg_dump -U postgres -d geo_core \
      --format=custom --no-owner --no-privileges \
      --table='basemap_source.buildings' \
      > "${dump}"
  fi
  local bytes
  bytes="$(wc -c < "${dump}" | tr -d ' ')"
  if [[ "${bytes}" -le 0 ]]; then
    echo "backup failed: empty dump at ${dump}" >&2
    exit 1
  fi
  shasum -a 256 "${dump}" | tee "${OUT}/basemap_source_buildings.dump.sha256"
  echo "backup_path=${dump}"
  echo "backup_bytes=${bytes}"
  printf '%s\n' "${dump}" > "${OUT}/backup_path.txt"
}

do_cleanup() {
  local apply_flag="$1"
  if [[ "${apply_flag}" == "true" ]]; then
    if [[ "${EXECUTE_LOCAL_BUILDING_CLEANUP:-}" != "I_UNDERSTAND" ]]; then
      echo "refused: set EXECUTE_LOCAL_BUILDING_CLEANUP=I_UNDERSTAND for cleanup apply" >&2
      exit 1
    fi
  fi
  echo "=== cleanup staging snap13 apply=${apply_flag} ==="
  run_psql \
    -v apply="${apply_flag}" \
    -f "${SQL_DIR}/cleanup_staging_buildings_snap13.sql" \
    | tee "${OUT}/04_cleanup_${apply_flag}.log"
}

case "${MODE}" in
  copy)
    do_create; do_copy
    ;;
  verify)
    do_verify
    ;;
  backup)
    do_backup
    ;;
  cleanup-dry-run)
    do_cleanup false
    ;;
  cleanup-apply)
    do_cleanup true
    ;;
  all)
    do_create
    do_copy
    do_verify
    do_backup
    do_cleanup false
    ;;
esac

echo "=== after counts ==="
disk_counts | tee "${OUT}/after_counts.txt"
echo "done. artifacts=${OUT}"
