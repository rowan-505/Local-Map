#!/usr/bin/env bash
# Stage-based pipeline logging (fixed milestones — not tippecanoe inner %).
# Source from export-region.sh / build-region.sh after setting:
#   PMTILES_PIPELINE_SCOPE=rebuild|build|export
#   PMTILES_PIPELINE_STARTED_AT=<unix epoch>
set -euo pipefail

PMTILES_PIPELINE_SCOPE="${PMTILES_PIPELINE_SCOPE:-build}"
PMTILES_PIPELINE_STARTED_AT="${PMTILES_PIPELINE_STARTED_AT:-$(date +%s)}"
PMTILES_STAGE_STARTED_AT="${PMTILES_STAGE_STARTED_AT:-$PMTILES_PIPELINE_STARTED_AT}"

pmtiles_fmt_duration() {
  local seconds="$1"
  if [[ "$seconds" -lt 60 ]]; then
    printf '%ss' "$seconds"
  elif [[ "$seconds" -lt 3600 ]]; then
    printf '%sm %ss' "$((seconds / 60))" "$((seconds % 60))"
  else
    printf '%sh %sm' "$((seconds / 3600))" "$(((seconds % 3600) / 60))"
  fi
}

# Log a fixed stage milestone. Resets per-stage elapsed timer.
pmtiles_stage() {
  local pct="$1"
  local label="$2"
  local now stage_elapsed total_elapsed
  now="$(date +%s)"
  stage_elapsed="$((now - PMTILES_STAGE_STARTED_AT))"
  total_elapsed="$((now - PMTILES_PIPELINE_STARTED_AT))"
  PMTILES_STAGE_STARTED_AT="$now"
  printf '[%s] %7.2f%% %-32s (stage %s, total %s)\n' \
    "${PMTILES_PIPELINE_SCOPE}" "$pct" "$label" \
    "$(pmtiles_fmt_duration "$stage_elapsed")" \
    "$(pmtiles_fmt_duration "$total_elapsed")" >&2
}

pmtiles_stage_note() {
  printf '[%s]         %s\n' "${PMTILES_PIPELINE_SCOPE}" "$*" >&2
}

pmtiles_stage_warn() {
  printf '[%s] WARNING: %s\n' "${PMTILES_PIPELINE_SCOPE}" "$*" >&2
}

# Estimated progress ticker (stage-based; never reaches next milestone until command finishes).
PMTILES_PROGRESS_TICKER_ENABLED="${PMTILES_PROGRESS_TICKER_ENABLED:-1}"
PMTILES_TICKER_PID=""

pmtiles_ticker_estimate_pct() {
  local start="$1"
  local end="$2"
  local elapsed="$3"
  awk -v s="$start" -v e="$end" -v t="$elapsed" '
    BEGIN {
      cap = e - 0.01
      if (cap <= s) {
        printf "%.2f", s
        exit
      }
      range = cap - s
      progress = 1 - exp(-t / 90.0)
      if (progress > 0.99) progress = 0.99
      printf "%.2f", s + range * progress
    }'
}

pmtiles_ticker_stop() {
  if [[ -z "${PMTILES_TICKER_PID:-}" ]]; then
    return 0
  fi
  kill "$PMTILES_TICKER_PID" 2>/dev/null || true
  wait "$PMTILES_TICKER_PID" 2>/dev/null || true
  PMTILES_TICKER_PID=""
  printf '\n' >&2
}

pmtiles_ticker_start() {
  local pct_start="$1"
  local pct_end="$2"
  local label="$3"

  pmtiles_ticker_stop

  if [[ "${PMTILES_PROGRESS_TICKER_ENABLED:-1}" != "1" ]]; then
    return 0
  fi

  local ticker_parent=$$
  (
    local started_at now elapsed est
    started_at="$(date +%s)"
    while kill -0 "$ticker_parent" 2>/dev/null; do
      sleep 2
      now="$(date +%s)"
      elapsed=$((now - started_at))
      est="$(pmtiles_ticker_estimate_pct "$pct_start" "$pct_end" "$elapsed")"
      printf '\r[%s] %6.2f%% %s... elapsed %s (estimated)' \
        "${PMTILES_PIPELINE_SCOPE}" "$est" "$label" \
        "$(pmtiles_fmt_duration "$elapsed")" >&2
    done
  ) &
  PMTILES_TICKER_PID=$!
}

# Run tippecanoe; summarize sparsify drops. Quiet live output when ticker is enabled.
pmtiles_run_tippecanoe() {
  local stage_label="$1"
  shift
  local err_log sparse_count status quiet_output

  err_log="$(mktemp "${TMPDIR:-/tmp}/pmtiles-tippecanoe.XXXXXX")"
  quiet_output=0
  if [[ "${PMTILES_PROGRESS_TICKER_ENABLED:-1}" == "1" && "${PMTILES_DEBUG:-0}" != "1" ]]; then
    quiet_output=1
  fi

  if [[ "$quiet_output" != "1" ]]; then
    pmtiles_stage_note "running tippecanoe (${stage_label})"
    pmtiles_stage_note "command: $(printf '%q ' "$@")"
  fi

  if [[ "$quiet_output" == "1" ]]; then
    if "$@" 2>"$err_log"; then
      status=0
    else
      status=$?
    fi
  else
    set +o pipefail
    "$@" 2>&1 | tee "$err_log"
    status=${PIPESTATUS[0]}
    set -o pipefail
  fi

  if [[ "$status" -ne 0 ]]; then
    pmtiles_stage_warn "tippecanoe failed during ${stage_label} (exit ${status})"
    pmtiles_stage_warn "command: $(printf '%q ' "$@")"
    if [[ -s "$err_log" ]]; then
      pmtiles_stage_warn "last output:"
      tail -40 "$err_log" >&2 || true
    fi
  fi

  sparse_count=0
  if [[ -f "$err_log" && "$status" -eq 0 ]]; then
    sparse_count="$(grep -c "sparsest" "$err_log" 2>/dev/null || true)"
    sparse_count="${sparse_count//$'\n'/}"
    sparse_count="${sparse_count:-0}"
  fi

  if [[ "$sparse_count" -gt 0 ]]; then
    pmtiles_stage_warn "tippecanoe sparsified dense tiles ${sparse_count} time(s) during ${stage_label}."
    pmtiles_stage_warn "Tile size limits caused feature drops; residential/service roads are deferred to z13+ in prepare-tippecanoe-input.py."
  fi

  rm -f "$err_log"
  return "$status"
}
