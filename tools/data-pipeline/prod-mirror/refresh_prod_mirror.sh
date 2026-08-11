#!/usr/bin/env bash
# Refresh local prod_mirror copies from selected Supabase production tables.
# READ-ONLY against Supabase. Never uses SUPABASE_WRITE_DATABASE_URL.
# Does not promote data to core and does not write production core.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# shellcheck source=../lib/progress_heartbeat.sh
source "${SCRIPT_DIR}/../lib/progress_heartbeat.sh"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") [env-file]

  env-file defaults to ${SCRIPT_DIR}/00_env.sh

Required:
  LOCAL_DATABASE_URL
  SUPABASE_READ_DATABASE_URL
    OR legacy SUPABASE_DB_HOST/PORT/NAME/USER/PASSWORD/SSLMODE

Optional:
  SUPABASE_WRITE_DATABASE_URL   # Stage K / write ops only — never used here
  SUPABASE_PROJECT_REF
  MIRROR_MAX_AGE_HOURS          # passed to validation (default 168)

Create env from template:
  cp ${SCRIPT_DIR}/00_env.example.sh ${SCRIPT_DIR}/00_env.sh
EOF
}

ENV_FILE="${1:-${SCRIPT_DIR}/00_env.sh}"

if [[ "${ENV_FILE}" == "-h" || "${ENV_FILE}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "error: env file not found: ${ENV_FILE}" >&2
  usage
  exit 1
fi

# shellcheck source=/dev/null
source "${ENV_FILE}"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required variable ${name} is empty or unset in ${ENV_FILE}" >&2
    exit 1
  fi
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

# Parse postgres URL → host port db user password (best-effort).
parse_database_url() {
  local url="$1"
  local rest userinfo hostport db pathuser
  if [[ ! "${url}" =~ ^postgres(ql)?://([^/?]+)(/([^?]*))?(\?.*)?$ ]]; then
    echo "error: cannot parse database URL" >&2
    return 1
  fi
  rest="${BASH_REMATCH[2]}"
  db="${BASH_REMATCH[4]:-postgres}"
  db="${db%%/*}"
  [[ -z "${db}" ]] && db="postgres"

  if [[ "${rest}" == *"@"* ]]; then
    userinfo="${rest%%@*}"
    hostport="${rest#*@}"
  else
    userinfo=""
    hostport="${rest}"
  fi

  local user="" password=""
  if [[ -n "${userinfo}" ]]; then
    user="${userinfo%%:*}"
    if [[ "${userinfo}" == *":"* ]]; then
      password="${userinfo#*:}"
    fi
  fi

  local host="${hostport%%:*}"
  local port="5432"
  if [[ "${hostport}" == *":"* ]]; then
    port="${hostport##*:}"
    # strip query leftovers if any
    port="${port%%\?*}"
  fi

  # URL-decode minimal password chars (%40 etc.) — leave as-is for FDW; user should use raw.
  PARSED_DB_HOST="${host}"
  PARSED_DB_PORT="${port}"
  PARSED_DB_NAME="${db}"
  PARSED_DB_USER="${user}"
  PARSED_DB_PASSWORD="${password}"
}

url_host() {
  local url="$1"
  if [[ "${url}" =~ @([^/:?]+) ]]; then
    echo "${BASH_REMATCH[1]}"
  elif [[ "${url}" =~ ^postgres(ql)?://([^/:?]+) ]]; then
    echo "${BASH_REMATCH[2]}"
  else
    echo ""
  fi
}

normalize_url_key() {
  # host/db only for equality checks (ignore password differences).
  local url="$1"
  local host db
  host="$(url_host "${url}")"
  if [[ "${url}" =~ /([^/?]+)(\?|$) ]]; then
    db="${BASH_REMATCH[1]}"
  else
    db="postgres"
  fi
  echo "${host}|${db}"
}

require_var LOCAL_DATABASE_URL

# Prefer explicit read URL; fall back to legacy SUPABASE_DB_* parts.
if [[ -n "${SUPABASE_READ_DATABASE_URL:-}" ]]; then
  parse_database_url "${SUPABASE_READ_DATABASE_URL}"
  SUPABASE_DB_HOST="${PARSED_DB_HOST}"
  SUPABASE_DB_PORT="${PARSED_DB_PORT}"
  SUPABASE_DB_NAME="${PARSED_DB_NAME}"
  SUPABASE_DB_USER="${PARSED_DB_USER}"
  SUPABASE_DB_PASSWORD="${PARSED_DB_PASSWORD}"
  SUPABASE_DB_SSLMODE="${SUPABASE_DB_SSLMODE:-require}"
elif [[ -n "${SUPABASE_DB_HOST:-}" ]]; then
  require_var SUPABASE_DB_HOST
  require_var SUPABASE_DB_PORT
  require_var SUPABASE_DB_NAME
  require_var SUPABASE_DB_USER
  require_var SUPABASE_DB_PASSWORD
  require_var SUPABASE_DB_SSLMODE
else
  echo "error: set SUPABASE_READ_DATABASE_URL (preferred) or legacy SUPABASE_DB_* vars" >&2
  exit 1
fi

# --- Safety guards (read-only mirror) ---
# Refresh must never use the write URL as FDW target.
if [[ -n "${SUPABASE_WRITE_DATABASE_URL:-}" && -z "${SUPABASE_READ_DATABASE_URL:-}" && -z "${SUPABASE_DB_HOST:-}" ]]; then
  echo "error: SUPABASE_WRITE_DATABASE_URL is set but no read source is configured." >&2
  echo "       Mirror refresh refuses to use the write URL. Set SUPABASE_READ_DATABASE_URL." >&2
  exit 1
fi

if [[ -n "${SUPABASE_WRITE_DATABASE_URL:-}" && -n "${SUPABASE_READ_DATABASE_URL:-}" ]]; then
  if [[ "${SUPABASE_READ_DATABASE_URL}" == "${SUPABASE_WRITE_DATABASE_URL}" ]]; then
    echo "warning: SUPABASE_READ_DATABASE_URL equals SUPABASE_WRITE_DATABASE_URL." >&2
    echo "         Prefer a read-only DB user for mirror refresh." >&2
  fi
fi

# Never allow LOCAL to be the Supabase host (would mean writing mirror onto production).
LOCAL_HOST="$(url_host "${LOCAL_DATABASE_URL}")"
if [[ -n "${LOCAL_HOST}" && "${LOCAL_HOST}" == "${SUPABASE_DB_HOST}" ]]; then
  echo "error: LOCAL_DATABASE_URL host (${LOCAL_HOST}) matches Supabase read host." >&2
  echo "       Mirror refresh must write only to the local lab database." >&2
  exit 1
fi

if [[ "${LOCAL_HOST}" == *".supabase.co" || "${LOCAL_HOST}" == *".pooler.supabase.com" ]]; then
  echo "error: LOCAL_DATABASE_URL looks like Supabase (${LOCAL_HOST}). Aborting." >&2
  exit 1
fi

# Derive project ref from host or pooler username when not provided.
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "${SUPABASE_PROJECT_REF}" && "${SUPABASE_DB_HOST}" =~ ^db\.([^.]+)\.supabase\.co$ ]]; then
  SUPABASE_PROJECT_REF="${BASH_REMATCH[1]}"
elif [[ -z "${SUPABASE_PROJECT_REF}" && "${SUPABASE_DB_USER}" =~ ^postgres\.([a-z0-9]+)$ ]]; then
  SUPABASE_PROJECT_REF="${BASH_REMATCH[1]}"
fi

MIRROR_MAX_AGE_HOURS="${MIRROR_MAX_AGE_HOURS:-168}"

LOG_DIR="${LOG_DIR:-logs/data-pipeline}"
if [[ "${LOG_DIR}" != /* ]]; then
  LOG_DIR="${REPO_ROOT}/${LOG_DIR}"
fi
mkdir -p "${LOG_DIR}"

RUN_TS="$(date -u +"%Y%m%dT%H%M%SZ")"
LOG_FILE="${LOG_DIR}/prod-mirror-refresh_${RUN_TS}.log"

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

run_sql() {
  local sql_file="$1"
  local phase_name
  phase_name="$(basename "${sql_file}")"
  log ""
  log "=== ${phase_name} ==="
  progress_begin_phase "${phase_name}" "running psql -f ${phase_name}"

  # Run psql in a pipe so 1s heartbeat keeps printing; SQL NOTICE progress
  # lines update the heartbeat detail (done/total % per table).
  set +e
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v supabase_db_host="${SUPABASE_DB_HOST}" \
    -v supabase_db_port="${SUPABASE_DB_PORT}" \
    -v supabase_db_name="${SUPABASE_DB_NAME}" \
    -v supabase_db_user="${SUPABASE_DB_USER}" \
    -v supabase_db_password="${SUPABASE_DB_PASSWORD}" \
    -v supabase_db_sslmode="${SUPABASE_DB_SSLMODE}" \
    -v source_project_ref="${SUPABASE_PROJECT_REF}" \
    -v source_host="${SUPABASE_DB_HOST}" \
    -v source_database="${SUPABASE_DB_NAME}" \
    -v source_user="${SUPABASE_DB_USER}" \
    -v mirror_max_age_hours="${MIRROR_MAX_AGE_HOURS}" \
    -f "${sql_file}" \
    2>&1 | progress_tee_and_watch "${LOG_FILE}" &
  local tee_pid=$!
  wait "${tee_pid}"
  local rc=$?
  set -e

  if [[ "${rc}" -ne 0 ]]; then
    progress_set_detail "FAILED ${phase_name} exit=${rc}"
    progress_print_once
    progress_stop_heartbeat
    exit "${rc}"
  fi
  progress_end_phase "ok ${phase_name}"
}

log "prod_mirror refresh started at ${RUN_TS}"
log "env file: ${ENV_FILE}"
log "LOCAL_DATABASE_URL=$(mask_database_url "${LOCAL_DATABASE_URL}")"
if [[ -n "${SUPABASE_READ_DATABASE_URL:-}" ]]; then
  log "SUPABASE_READ_DATABASE_URL=$(mask_database_url "${SUPABASE_READ_DATABASE_URL}")"
fi
if [[ -n "${SUPABASE_WRITE_DATABASE_URL:-}" ]]; then
  log "SUPABASE_WRITE_DATABASE_URL=$(mask_database_url "${SUPABASE_WRITE_DATABASE_URL}") (NOT used by refresh)"
fi
log "SUPABASE_DB_HOST=${SUPABASE_DB_HOST}"
log "SUPABASE_DB_PORT=${SUPABASE_DB_PORT}"
log "SUPABASE_DB_NAME=${SUPABASE_DB_NAME}"
log "SUPABASE_DB_USER=${SUPABASE_DB_USER}"
log "SUPABASE_DB_SSLMODE=${SUPABASE_DB_SSLMODE}"
log "SUPABASE_PROJECT_REF=${SUPABASE_PROJECT_REF:-}"
log "MIRROR_MAX_AGE_HOURS=${MIRROR_MAX_AGE_HOURS}"
log "log file: ${LOG_FILE}"
log "mode: slim family columns (read-only FDW → local prod_mirror)"
log "progress: 1-second heartbeat enabled"

PROGRESS_LOG_FILE="${LOG_FILE}"
progress_init "prod_mirror_refresh" 4

run_sql "${SCRIPT_DIR}/01_setup_fdw.sql"
run_sql "${SCRIPT_DIR}/02_import_foreign_tables.sql"
run_sql "${SCRIPT_DIR}/03_refresh_prod_mirror.sql"
run_sql "${SCRIPT_DIR}/04_validate_prod_mirror.sql"

progress_finish "prod_mirror refresh complete"
log ""
log "prod_mirror refresh finished (local copy only; Supabase core was not modified)"
