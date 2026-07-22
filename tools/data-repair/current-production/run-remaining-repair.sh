#!/usr/bin/env bash
# One-time remaining current-production repair runner.
# Usage: npm run data:repair:remaining
#    or: ./tools/data-repair/current-production/run-remaining-repair.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
MAX_ITERS=500
NO_PROGRESS_LIMIT=3

SQL_SETUP="${SCRIPT_DIR}/00_setup.sql"
SQL_STREET="${SCRIPT_DIR}/01_run_street_batch.sql"
SQL_TRANSPORT="${SCRIPT_DIR}/02_run_transport_batches.sql"
SQL_ROADS="${SCRIPT_DIR}/03_fix_safe_road_values.sql"
SQL_VERIFY="${SCRIPT_DIR}/04_verify.sql"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || die "Required SQL file missing: $1"
}

# Optional .env load when connection vars are unset (never print secrets).
if [[ -z "${DATABASE_URL:-}" && -z "${DIRECT_DATABASE_URL:-}" && -z "${SUPABASE_DB_URL:-}" ]]; then
  if [[ -f "${REPO_ROOT}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${REPO_ROOT}/.env"
    set +a
  fi
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  DB_URL="${DATABASE_URL}"
elif [[ -n "${DIRECT_DATABASE_URL:-}" ]]; then
  DB_URL="${DIRECT_DATABASE_URL}"
elif [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  DB_URL="${SUPABASE_DB_URL}"
else
  echo "Missing database connection."
  echo "Set DATABASE_URL or DIRECT_DATABASE_URL to the direct PostgreSQL connection."
  exit 1
fi

command -v psql >/dev/null 2>&1 || die "psql is not installed"

require_file "${SQL_SETUP}"
require_file "${SQL_STREET}"
require_file "${SQL_TRANSPORT}"
require_file "${SQL_ROADS}"
require_file "${SQL_VERIFY}"

psql_cmd() {
  PAGER=cat psql -X -v ON_ERROR_STOP=1 "$DB_URL" "$@"
}

psql_scalar() {
  psql_cmd -At -c "$1" | tr -d '[:space:]'
}

fmt_int() {
  printf "%'d\n" "$1" 2>/dev/null || echo "$1"
}

echo "== CoreMap remaining repair =="
echo "Working directory: ${REPO_ROOT}"
echo

echo "-- Step 1: connectivity and preflight"
psql_cmd -c "SELECT current_database(), current_user, version();" >/dev/null

missing_objs="$(psql_cmd -At -c "
SELECT string_agg(m, ', ' ORDER BY m)
FROM (
  SELECT 'core.find_admin_area_for_point' AS m
  WHERE to_regprocedure('core.find_admin_area_for_point(geometry,text)') IS NULL
  UNION ALL
  SELECT 'core.find_admin_area_for_line'
  WHERE to_regprocedure('core.find_admin_area_for_line(geometry,text)') IS NULL
  UNION ALL
  SELECT 'core.find_admin_area_for_polygon'
  WHERE to_regprocedure('core.find_admin_area_for_polygon(geometry,text)') IS NULL
  UNION ALL
  SELECT 'core.core_streets'
  WHERE to_regclass('core.core_streets') IS NULL
  UNION ALL
  SELECT 'core.core_admin_areas'
  WHERE to_regclass('core.core_admin_areas') IS NULL
  UNION ALL
  SELECT 'ref.ref_admin_levels'
  WHERE to_regclass('ref.ref_admin_levels') IS NULL
  UNION ALL
  SELECT 'ref.ref_road_classes'
  WHERE to_regclass('ref.ref_road_classes') IS NULL
  UNION ALL
  SELECT 'transport.stops'
  WHERE to_regclass('transport.stops') IS NULL
  UNION ALL
  SELECT 'transport.terminals'
  WHERE to_regclass('transport.terminals') IS NULL
  UNION ALL
  SELECT 'transport.infrastructure_lines'
  WHERE to_regclass('transport.infrastructure_lines') IS NULL
) x;
")"
if [[ -n "${missing_objs}" ]]; then
  die "Required database objects missing: ${missing_objs}"
fi
echo "Preflight OK"
echo

echo "-- Step 2: setup (idempotent)"
psql_cmd -f "${SQL_SETUP}"
echo

echo "-- Step 3: street admin batches (250 rows/batch)"
street_no_progress=0
street_iter=0
while true; do
  pending="$(psql_scalar "
    SELECT count(*)
    FROM system.repair_remaining_admin_queue_20260722
    WHERE entity_family = 'street' AND status = 'pending';
  ")"
  if [[ "${pending}" -eq 0 ]]; then
    echo "Street repair complete"
    break
  fi
  street_iter=$((street_iter + 1))
  if [[ "${street_iter}" -gt "${MAX_ITERS}" ]]; then
    die "Street loop hit max iterations (${MAX_ITERS}) with ${pending} pending; inspect queue"
  fi
  echo "Street batch ${street_iter}: $(fmt_int "${pending}") pending"
  before="${pending}"
  psql_cmd -f "${SQL_STREET}" >/dev/null
  after="$(psql_scalar "
    SELECT count(*)
    FROM system.repair_remaining_admin_queue_20260722
    WHERE entity_family = 'street' AND status = 'pending';
  ")"
  if [[ "${after}" -ge "${before}" ]]; then
    street_no_progress=$((street_no_progress + 1))
    echo "  no progress (${street_no_progress}/${NO_PROGRESS_LIMIT})"
    if [[ "${street_no_progress}" -ge "${NO_PROGRESS_LIMIT}" ]]; then
      echo "Street repair stopped: pending count did not decrease for ${NO_PROGRESS_LIMIT} batches."
      echo "Remaining rows require inspection."
      break
    fi
  else
    street_no_progress=0
  fi
done
echo

echo "-- Step 4: transport admin batches (up to 500/family)"
transport_no_progress=0
transport_iter=0
while true; do
  pending="$(psql_scalar "
    SELECT count(*)
    FROM system.repair_remaining_admin_queue_20260722
    WHERE entity_family IN ('stop', 'terminal', 'infrastructure_line')
      AND status = 'pending';
  ")"
  if [[ "${pending}" -eq 0 ]]; then
    echo "Transport repair complete"
    break
  fi
  transport_iter=$((transport_iter + 1))
  if [[ "${transport_iter}" -gt "${MAX_ITERS}" ]]; then
    die "Transport loop hit max iterations (${MAX_ITERS}) with ${pending} pending; inspect queue"
  fi
  stop_p="$(psql_scalar "SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='stop' AND status='pending';")"
  term_p="$(psql_scalar "SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='terminal' AND status='pending';")"
  infra_p="$(psql_scalar "SELECT count(*) FROM system.repair_remaining_admin_queue_20260722 WHERE entity_family='infrastructure_line' AND status='pending';")"
  echo "Transport batch ${transport_iter}: stop=$(fmt_int "${stop_p}") terminal=$(fmt_int "${term_p}") infra=$(fmt_int "${infra_p}") pending"
  before="${pending}"
  psql_cmd -f "${SQL_TRANSPORT}" >/dev/null
  after="$(psql_scalar "
    SELECT count(*)
    FROM system.repair_remaining_admin_queue_20260722
    WHERE entity_family IN ('stop', 'terminal', 'infrastructure_line')
      AND status = 'pending';
  ")"
  if [[ "${after}" -ge "${before}" ]]; then
    transport_no_progress=$((transport_no_progress + 1))
    echo "  no progress (${transport_no_progress}/${NO_PROGRESS_LIMIT})"
    if [[ "${transport_no_progress}" -ge "${NO_PROGRESS_LIMIT}" ]]; then
      echo "Transport repair stopped: pending count did not decrease for ${NO_PROGRESS_LIMIT} batches."
      echo "Remaining rows require inspection."
      break
    fi
  else
    transport_no_progress=0
  fi
done
echo

echo "-- Step 5: safe road value fixes"
psql_cmd -f "${SQL_ROADS}"
boardwalk_repaired="$(psql_scalar "
  SELECT count(*) FROM system.repair_remaining_road_backup_20260722;
")"
echo

echo "-- Step 6: verification"
mkdir -p "${LOG_DIR}"
stamp="$(date +%Y%m%d-%H%M%S)"
log_file="${LOG_DIR}/remaining-repair-${stamp}.log"
{
  echo "CoreMap remaining repair verification — ${stamp}"
  echo
  psql_cmd -f "${SQL_VERIFY}"
} | tee "${log_file}"

summary_line="$(grep -E '^[[:space:]]*SUMMARY\|' "${log_file}" | tail -n 1 | sed 's/^[[:space:]]*//')"
if [[ -z "${summary_line}" ]]; then
  die "Verification did not emit SUMMARY| line; see ${log_file}"
fi

get_kv() {
  local key="$1"
  echo "${summary_line}" | tr '|' '\n' | sed -n "s/^${key}=//p" | head -n 1
}

street_resolved="$(get_kv street_resolved)"
street_unresolved="$(get_kv street_unresolved)"
street_protected="$(get_kv street_protected)"
street_pending="$(get_kv street_pending)"
stop_resolved="$(get_kv stop_resolved)"
stop_unresolved="$(get_kv stop_unresolved)"
stop_pending="$(get_kv stop_pending)"
terminal_resolved="$(get_kv terminal_resolved)"
terminal_unresolved="$(get_kv terminal_unresolved)"
terminal_pending="$(get_kv terminal_pending)"
infra_resolved="$(get_kv infra_resolved)"
infra_unresolved="$(get_kv infra_unresolved)"
infra_pending="$(get_kv infra_pending)"
boardwalk_mismatch="$(get_kv boardwalk_safe_mismatch)"
unprot_class="$(get_kv unprotected_class_mismatch)"
prot_class="$(get_kv protected_class_mismatch)"
bad_township="$(get_kv bad_resolved_township)"

pending_total=$((street_pending + stop_pending + terminal_pending + infra_pending))
unresolved_total=$((street_unresolved + stop_unresolved + terminal_unresolved + infra_unresolved))

result="SUCCESS"
exit_code=0
if [[ "${pending_total}" -ne 0 || "${boardwalk_mismatch}" -ne 0 || "${unprot_class}" -ne 0 || "${bad_township}" -ne 0 ]]; then
  result="FAILED"
  exit_code=1
elif [[ "${unresolved_total}" -gt 0 || "${street_protected}" -gt 0 || "${prot_class}" -gt 0 ]]; then
  result="SUCCESS WITH DOCUMENTED UNRESOLVED ROWS"
fi

echo
echo "CoreMap remaining repair finished"
echo
echo "Resolved street assignments: $(fmt_int "${street_resolved}")"
echo "Unresolved streets: $(fmt_int "${street_unresolved}")"
echo "Protected streets: $(fmt_int "${street_protected}")"
echo
echo "Resolved stops: $(fmt_int "${stop_resolved}")"
echo "Unresolved stops: $(fmt_int "${stop_unresolved}")"
echo
echo "Resolved terminals: $(fmt_int "${terminal_resolved}")"
echo "Unresolved terminals: $(fmt_int "${terminal_unresolved}")"
echo
echo "Resolved infrastructure lines: $(fmt_int "${infra_resolved}")"
echo "Unresolved infrastructure lines: $(fmt_int "${infra_unresolved}")"
echo
echo "Safe boardwalk repairs (backup rows): $(fmt_int "${boardwalk_repaired}")"
echo "Protected road-class exceptions: $(fmt_int "${prot_class}")"
echo
echo "Verification log:"
echo "${log_file#"${REPO_ROOT}/"}"
echo
echo "Result: ${result}"

exit "${exit_code}"
