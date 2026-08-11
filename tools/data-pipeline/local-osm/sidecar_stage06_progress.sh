#!/usr/bin/env bash
# Append live Stage-06 DB progress to a pipeline log every INTERVAL seconds.
# Read-only probes only. Does not stop the running pipeline.
#
# Usage:
#   LOG=/tmp/buildings_resume_06b.log INTERVAL=30 ./sidecar_stage06_progress.sh
#
# Env: LOG (required), INTERVAL (30), DATABASE_URL or LOCAL_DATABASE_URL,
#      TARGET_ROWS (5578282), STOP_FILE (/tmp/stage06_sidecar.stop)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${LOG:?Set LOG=/path/to/pipeline.log}"
INTERVAL="${INTERVAL:-30}"
TARGET_ROWS="${TARGET_ROWS:-5578282}"
STOP_FILE="${STOP_FILE:-/tmp/stage06_sidecar.stop}"
PIDFILE="${PIDFILE:-/tmp/stage06_sidecar.pid}"
OUT="${OUT:-/tmp/stage06_sidecar.out}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT}/prod-mirror/00_env.sh"
  DATABASE_URL="${LOCAL_DATABASE_URL:?LOCAL_DATABASE_URL missing}"
fi

echo $$ >"${PIDFILE}"
rm -f "${STOP_FILE}"

fmt_hms() {
  local s="${1:-0}"
  [[ "${s}" -lt 0 ]] && s=0
  printf '%d:%02d:%02d' "$((s / 3600))" "$(((s % 3600) / 60))" "$((s % 60))"
}

prev_bytes=-1
prev_epoch=$(date +%s)
start_epoch=$(date +%s)

append() {
  local line="[sidecar] $(date '+%Y-%m-%d %H:%M:%S') $*"
  # Prefer plain append — concurrent pipeline tee can make `tee -a` fail under set -e.
  printf '%s\n' "${line}" >>"${LOG}" 2>/dev/null || true
  printf '%s\n' "${line}" >>"${OUT}" 2>/dev/null || true
  printf '%s\n' "${line}"
}

append "started interval=${INTERVAL}s target_rows=${TARGET_ROWS} watching Stage 06 DO block"

while true; do
  if [[ -f "${STOP_FILE}" ]]; then
    append "stop file seen; exiting"
    break
  fi

  row="$(
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -At -F $'\t' -c "
SELECT
  coalesce((
    SELECT pid::text FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'active'
      AND query ILIKE '%stage06_create_diffs%'
      AND pid <> pg_backend_pid()
    ORDER BY query_start LIMIT 1
  ), '-'),
  coalesce((
    SELECT EXTRACT(EPOCH FROM (now() - query_start))::bigint::text
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'active'
      AND query ILIKE '%stage06_create_diffs%'
      AND pid <> pg_backend_pid()
    ORDER BY query_start LIMIT 1
  ), '-'),
  coalesce((
    SELECT coalesce(nullif(wait_event_type,''), 'CPU') || '/' || coalesce(nullif(wait_event,''), 'running')
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state = 'active'
      AND query ILIKE '%stage06_create_diffs%'
      AND pid <> pg_backend_pid()
    ORDER BY query_start LIMIT 1
  ), 'no_active_do'),
  (SELECT pg_total_relation_size('system.system_diff_items')::text),
  (SELECT pg_size_pretty(pg_total_relation_size('system.system_diff_items'))),
  (SELECT coalesce(reltuples::bigint,0)::text
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='system' AND c.relname='system_diff_items'),
  coalesce((
    SELECT pg_size_pretty(temp_bytes)::text
    FROM pg_stat_database WHERE datname = current_database()
  ), '-');
" 2>>"${OUT}" || true
  )"

  if [[ -z "${row}" ]]; then
    append "psql probe failed (db busy/down) — will retry"
    sleep "${INTERVAL}" || true
    continue
  fi

  IFS=$'\t' read -r pid age_s wait_ev bytes size_pretty approx_items temp_pretty <<<"${row}" || true
  now=$(date +%s)

  delta_b=0
  rate_bps=0
  eta_msg="eta≈—"
  if [[ "${bytes:-}" =~ ^[0-9]+$ && "${prev_bytes}" -ge 0 ]]; then
    delta_b=$((bytes - prev_bytes))
    dt=$((now - prev_epoch))
    if [[ "${dt}" -gt 0 ]]; then
      rate_bps=$((delta_b / dt))
    fi
  fi

  # Soft Stage-06 budget for 5.58M to_jsonb dumps (wall-clock).
  assume_total=18000
  if [[ "${rate_bps}" -gt 50000 ]]; then
    eta_msg="heap growing ${rate_bps} B/s (+${delta_b}B/sample)"
  fi
  if [[ "${age_s}" =~ ^[0-9]+$ ]]; then
    if [[ "${age_s}" -lt "${assume_total}" ]]; then
      eta_msg="eta≈$(fmt_hms "$((assume_total - age_s))") Stage06 soft (5h budget); full 06→10 +2–5h after"
    else
      eta_msg="eta≈— past soft 5h; still alive, watch wait/heap"
    fi
  fi

  age_fmt="${age_s}"
  if [[ "${age_s}" =~ ^[0-9]+$ ]]; then
    age_fmt="$(fmt_hms "${age_s}")"
  fi
  wall="$(fmt_hms "$((now - start_epoch))")"

  append "stage06 pid=${pid} age=${age_fmt} wait=${wait_ev} approx_items=${approx_items} heap=${size_pretty}(+${delta_b}B) temp≈${temp_pretty} wall=${wall} ${eta_msg}"

  if [[ "${pid}" == "-" || "${wait_ev}" == "no_active_do" ]]; then
    sleep 5 || true
    if ! pgrep -f '06_diff_current_vs_previous\.sql' >/dev/null 2>&1; then
      append "confirmed Stage 06 finished; exiting sidecar"
      break
    fi
  fi

  prev_bytes="${bytes:--1}"
  prev_epoch="${now}"
  sleep "${INTERVAL}" || true
done

rm -f "${PIDFILE}"
