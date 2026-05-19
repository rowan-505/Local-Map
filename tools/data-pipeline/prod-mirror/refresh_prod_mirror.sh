#!/usr/bin/env bash
# Refresh local prod_mirror copies from selected Supabase production tables.
# This script does not modify Supabase and does not promote data to core.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") [env-file]

  env-file defaults to ${SCRIPT_DIR}/00_env.sh

Create one first:
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

require_var LOCAL_DATABASE_URL
require_var SUPABASE_DB_HOST
require_var SUPABASE_DB_PORT
require_var SUPABASE_DB_NAME
require_var SUPABASE_DB_USER
require_var SUPABASE_DB_PASSWORD
require_var SUPABASE_DB_SSLMODE

LOG_DIR="${LOG_DIR:-logs/data-pipeline}"
if [[ "${LOG_DIR}" != /* ]]; then
  LOG_DIR="${REPO_ROOT}/${LOG_DIR}"
fi
mkdir -p "${LOG_DIR}"

RUN_TS="$(date -u +"%Y%m%dT%H%M%SZ")"
LOG_FILE="${LOG_DIR}/prod-mirror-refresh_${RUN_TS}.log"

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

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

run_sql() {
  local sql_file="$1"
  log ""
  log "=== $(basename "${sql_file}") ==="

  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v supabase_db_host="${SUPABASE_DB_HOST}" \
    -v supabase_db_port="${SUPABASE_DB_PORT}" \
    -v supabase_db_name="${SUPABASE_DB_NAME}" \
    -v supabase_db_user="${SUPABASE_DB_USER}" \
    -v supabase_db_password="${SUPABASE_DB_PASSWORD}" \
    -v supabase_db_sslmode="${SUPABASE_DB_SSLMODE}" \
    -f "${sql_file}" \
    2>&1 | tee -a "${LOG_FILE}"
}

log "prod_mirror refresh started at ${RUN_TS}"
log "env file: ${ENV_FILE}"
log "LOCAL_DATABASE_URL=$(mask_database_url "${LOCAL_DATABASE_URL}")"
log "SUPABASE_DB_HOST=${SUPABASE_DB_HOST}"
log "SUPABASE_DB_PORT=${SUPABASE_DB_PORT}"
log "SUPABASE_DB_NAME=${SUPABASE_DB_NAME}"
log "SUPABASE_DB_USER=${SUPABASE_DB_USER}"
log "SUPABASE_DB_SSLMODE=${SUPABASE_DB_SSLMODE}"
log "log file: ${LOG_FILE}"

run_sql "${SCRIPT_DIR}/01_setup_fdw.sql"
run_sql "${SCRIPT_DIR}/02_import_foreign_tables.sql"
run_sql "${SCRIPT_DIR}/03_refresh_prod_mirror.sql"
run_sql "${SCRIPT_DIR}/04_validate_prod_mirror.sql"

log ""
log "prod_mirror refresh finished (local copy only; Supabase was not modified)"
