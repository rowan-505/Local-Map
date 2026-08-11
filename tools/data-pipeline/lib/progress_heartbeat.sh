#!/usr/bin/env bash
# =============================================================================
# Shared 1-second progress heartbeat for long data-pipeline commands.
#
# Line format (every second):
#   [progress] job=... phase=... stage=I/N done=D/T (PP.PP%) elapsed=... eta≈... tick=Ns | detail
#
# - done/total = completed work units (stages, tables, …)
# - overall % uses completed + in-phase fraction (soft or measured)
# - eta≈ is for the WHOLE job from overall %
#
# Nested runners: PROGRESS_DISABLE=1 skips a second heartbeat.
# =============================================================================

PROGRESS_JOB_NAME="${PROGRESS_JOB_NAME:-pipeline}"
PROGRESS_STATE_FILE="${PROGRESS_STATE_FILE:-}"
PROGRESS_HB_PID=""
PROGRESS_LOG_FILE="${PROGRESS_LOG_FILE:-}"
PROGRESS_START_EPOCH="${PROGRESS_START_EPOCH:-0}"
PROGRESS_DISABLE="${PROGRESS_DISABLE:-0}"

progress_now_epoch() { date +%s; }

progress_fmt_hms() {
  local secs="${1:-0}"
  [[ "${secs}" -lt 0 ]] && secs=0
  printf '%d:%02d:%02d' "$((secs / 3600))" "$(((secs % 3600) / 60))" "$((secs % 60))"
}

progress_log_line() {
  local line="$1"
  if [[ -n "${PROGRESS_LOG_FILE}" ]]; then
    echo "${line}" | tee -a "${PROGRESS_LOG_FILE}"
  else
    echo "${line}"
  fi
}

progress_lock() {
  local lock_dir="${PROGRESS_STATE_FILE}.lock"
  local i=0
  while ! mkdir "${lock_dir}" 2>/dev/null; do
    i=$((i + 1))
    if [[ "${i}" -gt 500 ]]; then
      return 1
    fi
    sleep 0.01
  done
  return 0
}

progress_unlock() {
  rmdir "${PROGRESS_STATE_FILE}.lock" 2>/dev/null || true
}

# State keys:
#   phase, detail, tick, phase_start
#   done, total                 — completed whole units / planned units
#   stage_i, stage_n            — current stage index (1-based) / planned stages
#   soft_milli                  — 0..1000 fraction of CURRENT unit in progress
#   intra_done, intra_total     — measured sub-units (-1 = unknown)
#   in_phase                    — 1 while a unit is running (enables soft crawl)
#   eta_ema                     — smoothed remaining seconds (-1 = unknown)
progress_write_state_unlocked() {
  local phase="$1" done="$2" total="$3" detail="$4" phase_start="$5" tick="$6"
  local stage_i="$7" stage_n="$8" soft_milli="$9" intra_done="${10}" intra_total="${11}"
  local in_phase="${12:-1}"
  local eta_ema="${13:--1}"
  local tmp="${PROGRESS_STATE_FILE}.tmp.$$"
  printf '%s\n' \
    "phase=${phase}" \
    "done=${done}" \
    "total=${total}" \
    "detail=${detail}" \
    "phase_start=${phase_start}" \
    "tick=${tick}" \
    "stage_i=${stage_i}" \
    "stage_n=${stage_n}" \
    "soft_milli=${soft_milli}" \
    "intra_done=${intra_done}" \
    "intra_total=${intra_total}" \
    "in_phase=${in_phase}" \
    "eta_ema=${eta_ema}" > "${tmp}"
  mv -f "${tmp}" "${PROGRESS_STATE_FILE}"
}

progress_read_unlocked() {
  local key="$1"
  local default="${2:-}"
  local line
  [[ -f "${PROGRESS_STATE_FILE}" ]] || { printf '%s' "${default}"; return 0; }
  line="$(grep -E "^${key}=" "${PROGRESS_STATE_FILE}" 2>/dev/null | tail -n1 || true)"
  if [[ -z "${line}" ]]; then
    printf '%s' "${default}"
  elif [[ "${key}" == "detail" ]]; then
    printf '%s' "${line#detail=}"
  else
    printf '%s' "${line#*=}"
  fi
}

progress_overall_pct() {
  # Prints PP.PP using done/total + in-phase fraction.
  local done="$1" total="$2" soft_milli="$3" intra_done="$4" intra_total="$5"
  awk -v d="${done}" -v t="${total}" -v sm="${soft_milli}" -v id="${intra_done}" -v it="${intra_total}" 'BEGIN {
    if (t <= 0) { printf "00.00"; exit }
    frac = 0.0
    if (it > 0 && id >= 0) {
      frac = id / it
      if (frac > 0.999) frac = 0.999
      if (frac < 0) frac = 0
    } else if (sm > 0) {
      frac = sm / 1000.0
      if (frac > 0.85) frac = 0.85
    }
    pct = 100.0 * (d + frac) / t
    if (pct < 0) pct = 0
    if (pct > 100) pct = 100
    printf "%05.2f", pct
  }'
}

progress_eta_from_pct() {
  local elapsed="$1"
  local pct_str="$2"
  awk -v e="${elapsed}" -v p="${pct_str}" 'BEGIN {
    pct = p + 0.0
    if (e <= 0 || pct < 0.05) { print -1; exit }
    if (pct >= 99.995) { print 0; exit }
    rem = 100.0 - pct
    eta = int((e * rem / pct) + 0.5)
    print eta
  }'
}

# Smooth ETA: allow free decreases; cap increases so soft-crawl does not inflate forever.
progress_smooth_eta() {
  local prev_ema="$1"
  local new_eta="$2"
  local has_measured="$3"
  awk -v prev="${prev_ema}" -v neu="${new_eta}" -v measured="${has_measured}" 'BEGIN {
    if (neu < 0) { print prev; exit }
    if (prev < 0) { print neu; exit }
    # Measured intra progress: EMA, allow modest increases.
    if (measured == 1) {
      ema = int(0.35 * neu + 0.65 * prev + 0.5)
      if (neu < prev) ema = neu
      else if (ema > prev * 1.15 + 5) ema = int(prev * 1.15 + 5)
      print ema
      exit
    }
    # Soft-only / committed-only: never let displayed ETA climb.
    if (neu <= prev) print neu
    else print prev
  }'
}

progress_emit_line_unlocked() {
  local bump_tick="${1:-1}"
  local phase done total detail phase_start tick stage_i stage_n soft_milli intra_done intra_total in_phase eta_ema
  local now elapsed phase_elapsed pct eta_s eta_txt eta_pct has_measured
  [[ -f "${PROGRESS_STATE_FILE}" ]] || return 0

  phase="$(progress_read_unlocked phase idle)"
  done="$(progress_read_unlocked done 0)"
  total="$(progress_read_unlocked total 0)"
  detail="$(progress_read_unlocked detail running)"
  phase_start="$(progress_read_unlocked phase_start "${PROGRESS_START_EPOCH}")"
  tick="$(progress_read_unlocked tick 0)"
  stage_i="$(progress_read_unlocked stage_i 0)"
  stage_n="$(progress_read_unlocked stage_n 0)"
  soft_milli="$(progress_read_unlocked soft_milli 0)"
  intra_done="$(progress_read_unlocked intra_done -1)"
  intra_total="$(progress_read_unlocked intra_total -1)"
  in_phase="$(progress_read_unlocked in_phase 0)"
  eta_ema="$(progress_read_unlocked eta_ema -1)"

  # Soft crawl while a long phase has no measured intra progress (keeps % moving).
  if [[ "${bump_tick}" == "1" ]]; then
    tick=$((tick + 1))
    if [[ "${in_phase}" == "1" && ( "${intra_total}" -lt 0 || "${intra_done}" -lt 0 ) ]]; then
      now="$(progress_now_epoch)"
      phase_elapsed=$((now - phase_start))
      soft_milli="$(awk -v t="${phase_elapsed}" 'BEGIN {
        s = int(850 * (1 - exp(-t / 180.0)) + 0.5)
        if (s < 1 && t > 0) s = 1
        if (s > 850) s = 850
        print s
      }')"
    fi
    progress_write_state_unlocked \
      "${phase}" "${done}" "${total}" "${detail}" "${phase_start}" "${tick}" \
      "${stage_i}" "${stage_n}" "${soft_milli}" "${intra_done}" "${intra_total}" "${in_phase}" "${eta_ema}"
  fi

  now="$(progress_now_epoch)"
  elapsed=$((now - PROGRESS_START_EPOCH))
  phase_elapsed=$((now - phase_start))
  pct="$(progress_overall_pct "${done}" "${total}" "${soft_milli}" "${intra_done}" "${intra_total}")"

  has_measured=0
  if [[ "${intra_total}" -gt 0 && "${intra_done}" -ge 0 ]]; then
    has_measured=1
    eta_pct="${pct}"
  elif [[ "${total}" -gt 0 && "${done}" -gt 0 ]]; then
    # Soft crawl asymptotes (~85% of one stage) and makes ETA climb forever.
    # For ETA, use committed stage progress only when we lack measured intra %.
    eta_pct="$(awk -v d="${done}" -v t="${total}" 'BEGIN {
      p = 100.0 * d / t
      if (p < 0) p = 0
      if (p > 100) p = 100
      printf "%05.2f", p
    }')"
  else
    eta_pct="00.00"
  fi

  if [[ "${has_measured}" -eq 1 && "${intra_total}" -gt 0 && "${intra_done}" -gt 0 ]]; then
    # Prefer current-phase ETA from measured N/M (do not scale tiny overall %).
    eta_s="$(awk -v pe="${phase_elapsed}" -v id="${intra_done}" -v it="${intra_total}" -v d="${done}" -v t="${total}" 'BEGIN {
      frac = id / it
      if (frac <= 0) { print -1; exit }
      phase_rem = pe * (1.0 - frac) / frac
      # After this phase, estimate remaining stages from this phase duration.
      phase_total = pe / frac
      left = t - d - 1
      if (left < 0) left = 0
      # Cap remaining-stage estimate: later stages rarely match a 5.5M insert.
      rem_stages = left * phase_total * 0.25
      print int(phase_rem + rem_stages + 0.5)
    }')"
  else
    eta_s="$(progress_eta_from_pct "${elapsed}" "${eta_pct}")"
  fi
  if [[ "${has_measured}" -eq 0 && "${done}" -le 0 ]]; then
    # First long stage with no measured work units yet — do not invent a climbing clock.
    eta_s=-1
    eta_ema=-1
  else
    eta_ema="$(progress_smooth_eta "${eta_ema}" "${eta_s}" "${has_measured}")"
    eta_s="${eta_ema}"
  fi

  if [[ "${eta_s}" -ge 0 ]]; then
    eta_txt=" eta≈$(progress_fmt_hms "${eta_s}")"
  else
    eta_txt=" eta≈—"
  fi

  if [[ "${bump_tick}" == "1" ]]; then
    progress_write_state_unlocked \
      "${phase}" "${done}" "${total}" "${detail}" "${phase_start}" "${tick}" \
      "${stage_i}" "${stage_n}" "${soft_milli}" "${intra_done}" "${intra_total}" "${in_phase}" "${eta_ema}"
  fi

  if [[ "${total}" -gt 0 ]]; then
    progress_log_line "[progress] job=${PROGRESS_JOB_NAME} phase=${phase} stage=${stage_i}/${stage_n} done=${done}/${total} (${pct}%) elapsed=$(progress_fmt_hms "${elapsed}") phase_elapsed=$(progress_fmt_hms "${phase_elapsed}")${eta_txt} tick=${tick}s | ${detail}"
  else
    progress_log_line "[progress] job=${PROGRESS_JOB_NAME} phase=${phase} stage=${stage_i}/${stage_n} done=${done}/? (n/a) elapsed=$(progress_fmt_hms "${elapsed}") phase_elapsed=$(progress_fmt_hms "${phase_elapsed}") tick=${tick}s | ${detail}"
  fi
}

progress_print_from_state() {
  [[ "${PROGRESS_DISABLE}" == "1" ]] && return 0
  [[ -z "${PROGRESS_STATE_FILE}" ]] && return 0
  progress_lock || return 0
  progress_emit_line_unlocked 1
  progress_unlock
}

progress_heartbeat_loop() {
  while true; do
    progress_print_from_state
    sleep 1
  done
}

progress_stop_heartbeat() {
  if [[ -n "${PROGRESS_HB_PID}" ]] && kill -0 "${PROGRESS_HB_PID}" 2>/dev/null; then
    kill "${PROGRESS_HB_PID}" 2>/dev/null || true
    wait "${PROGRESS_HB_PID}" 2>/dev/null || true
  fi
  PROGRESS_HB_PID=""
}

progress_start_heartbeat() {
  progress_stop_heartbeat
  set +m 2>/dev/null || true
  progress_heartbeat_loop &
  PROGRESS_HB_PID=$!
  trap 'progress_stop_heartbeat; rm -rf "${PROGRESS_STATE_FILE}" "${PROGRESS_STATE_FILE}.lock" "${PROGRESS_STATE_FILE}.tmp."* 2>/dev/null || true' EXIT
}

progress_init() {
  local job_name="${1:-pipeline}"
  local total="${2:-0}"
  if [[ "${PROGRESS_DISABLE}" == "1" ]]; then
    progress_log_line "[progress] job=${job_name} SKIPPED (PROGRESS_DISABLE=1)"
    return 0
  fi
  PROGRESS_JOB_NAME="${job_name}"
  PROGRESS_START_EPOCH="$(progress_now_epoch)"
  PROGRESS_STATE_FILE="$(mktemp "${TMPDIR:-/tmp}/coremap_progress.XXXXXX")"
  progress_lock
  progress_write_state_unlocked "init" 0 "${total}" "starting" "${PROGRESS_START_EPOCH}" 0 \
    0 "${total}" 0 -1 -1 0 -1
  progress_unlock
  progress_log_line "[progress] job=${PROGRESS_JOB_NAME} INIT total_units=${total} at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  progress_start_heartbeat
}

progress_set_total() {
  local total="$1"
  [[ "${PROGRESS_DISABLE}" == "1" || -z "${PROGRESS_STATE_FILE}" ]] && return 0
  progress_lock || return 0
  progress_write_state_unlocked \
    "$(progress_read_unlocked phase idle)" \
    "$(progress_read_unlocked done 0)" \
    "${total}" \
    "$(progress_read_unlocked detail running)" \
    "$(progress_read_unlocked phase_start "${PROGRESS_START_EPOCH}")" \
    "$(progress_read_unlocked tick 0)" \
    "$(progress_read_unlocked stage_i 0)" \
    "${total}" \
    "$(progress_read_unlocked soft_milli 0)" \
    "$(progress_read_unlocked intra_done -1)" \
    "$(progress_read_unlocked intra_total -1)" \
    "$(progress_read_unlocked in_phase 0)" \
    "$(progress_read_unlocked eta_ema -1)"
  progress_unlock
}

progress_set_detail() {
  local detail="$1"
  [[ "${PROGRESS_DISABLE}" == "1" || -z "${PROGRESS_STATE_FILE}" ]] && return 0
  progress_lock || return 0
  progress_write_state_unlocked \
    "$(progress_read_unlocked phase idle)" \
    "$(progress_read_unlocked done 0)" \
    "$(progress_read_unlocked total 0)" \
    "${detail}" \
    "$(progress_read_unlocked phase_start "${PROGRESS_START_EPOCH}")" \
    "$(progress_read_unlocked tick 0)" \
    "$(progress_read_unlocked stage_i 0)" \
    "$(progress_read_unlocked stage_n 0)" \
    "$(progress_read_unlocked soft_milli 0)" \
    "$(progress_read_unlocked intra_done -1)" \
    "$(progress_read_unlocked intra_total -1)" \
    "$(progress_read_unlocked in_phase 1)" \
    "$(progress_read_unlocked eta_ema -1)"
  progress_unlock
}

# Measured sub-progress inside current unit, e.g. table 13/21.
progress_set_intra() {
  local intra_done="$1"
  local intra_total="$2"
  local detail="${3:-}"
  [[ "${PROGRESS_DISABLE}" == "1" || -z "${PROGRESS_STATE_FILE}" ]] && return 0
  progress_lock || return 0
  progress_write_state_unlocked \
    "$(progress_read_unlocked phase idle)" \
    "$(progress_read_unlocked done 0)" \
    "$(progress_read_unlocked total 0)" \
    "${detail:-$(progress_read_unlocked detail running)}" \
    "$(progress_read_unlocked phase_start "${PROGRESS_START_EPOCH}")" \
    "$(progress_read_unlocked tick 0)" \
    "$(progress_read_unlocked stage_i 0)" \
    "$(progress_read_unlocked stage_n 0)" \
    0 \
    "${intra_done}" \
    "${intra_total}" \
    1 \
    "$(progress_read_unlocked eta_ema -1)"
  progress_unlock
}

progress_begin_phase() {
  local phase="$1"
  local detail="${2:-starting}"
  local stage_i="${3:-}"
  local done total now tick stage_n
  [[ "${PROGRESS_DISABLE}" == "1" || -z "${PROGRESS_STATE_FILE}" ]] && {
    progress_log_line "[progress] job=${PROGRESS_JOB_NAME:-pipeline} phase=${phase} | ${detail}"
    return 0
  }
  now="$(progress_now_epoch)"
  progress_lock || return 0
  done="$(progress_read_unlocked done 0)"
  total="$(progress_read_unlocked total 0)"
  tick="$(progress_read_unlocked tick 0)"
  stage_n="$(progress_read_unlocked stage_n "${total}")"
  if [[ -z "${stage_i}" ]]; then
    stage_i=$((done + 1))
  fi
  if [[ "${stage_n}" -le 0 ]]; then
    stage_n="${total}"
  fi
  # Keep smoothed ETA across phases; soft/intra reset for the new unit.
  progress_write_state_unlocked "${phase}" "${done}" "${total}" "${detail}" "${now}" "${tick}" \
    "${stage_i}" "${stage_n}" 0 -1 -1 1 "$(progress_read_unlocked eta_ema -1)"
  progress_emit_line_unlocked 1
  progress_unlock
}

progress_end_phase() {
  local detail="${1:-complete}"
  local done total phase phase_start tick stage_i stage_n
  [[ "${PROGRESS_DISABLE}" == "1" || -z "${PROGRESS_STATE_FILE}" ]] && return 0
  progress_lock || return 0
  done="$(progress_read_unlocked done 0)"
  total="$(progress_read_unlocked total 0)"
  phase="$(progress_read_unlocked phase idle)"
  phase_start="$(progress_read_unlocked phase_start "${PROGRESS_START_EPOCH}")"
  tick="$(progress_read_unlocked tick 0)"
  stage_i="$(progress_read_unlocked stage_i 0)"
  stage_n="$(progress_read_unlocked stage_n 0)"
  done=$((done + 1))
  if [[ "${done}" -gt "${total}" && "${total}" -gt 0 ]]; then
    total="${done}"
    stage_n="${done}"
  fi
  # Reset ETA EMA so the next phase can recompute from committed progress.
  progress_write_state_unlocked "${phase}" "${done}" "${total}" "${detail}" "${phase_start}" "${tick}" \
    "${stage_i}" "${stage_n}" 0 -1 -1 0 -1
  progress_emit_line_unlocked 1
  progress_unlock
}

progress_finish() {
  local detail="${1:-finished}"
  local total
  if [[ "${PROGRESS_DISABLE}" == "1" || -z "${PROGRESS_STATE_FILE}" ]]; then
    progress_log_line "[progress] job=${PROGRESS_JOB_NAME:-pipeline} FINISHED (${detail})"
    return 0
  fi
  progress_lock || true
  total="$(progress_read_unlocked total 0)"
  progress_write_state_unlocked "done" "${total}" "${total}" "${detail}" "$(progress_now_epoch)" \
    "$(progress_read_unlocked tick 0)" "${total}" "${total}" 0 -1 -1 0 0
  progress_emit_line_unlocked 1
  progress_unlock
  progress_stop_heartbeat
  progress_log_line "[progress] job=${PROGRESS_JOB_NAME} FINISHED elapsed=$(progress_fmt_hms "$(($(progress_now_epoch) - PROGRESS_START_EPOCH))")"
  rm -rf "${PROGRESS_STATE_FILE}" "${PROGRESS_STATE_FILE}.lock" 2>/dev/null || true
  PROGRESS_STATE_FILE=""
}

progress_print_once() {
  progress_print_from_state
}

# Tee stdout/stderr: update detail + parse N/M or pct for real-time sync.
progress_tee_and_watch() {
  local log_file="${1:-}"
  local line detail n m pct_n soft
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ -n "${log_file}" ]]; then
      printf '%s\n' "${line}" | tee -a "${log_file}"
    else
      printf '%s\n' "${line}"
    fi

    detail="${line}"
    detail="${detail#*NOTICE:  }"
    detail="${detail#*NOTICE: }"

    # Prefer explicit "progress: N/M (P%) ..."
    if [[ "${detail}" =~ progress:[[:space:]]*([0-9]+)/([0-9]+) ]]; then
      n="${BASH_REMATCH[1]}"
      m="${BASH_REMATCH[2]}"
      if [[ "${#detail}" -gt 180 ]]; then
        detail="${detail:0:177}..."
      fi
      progress_set_intra "${n}" "${m}" "${detail}"
      continue
    fi

    # Generic N/M in NOTICE / log lines (table copy, batches, …)
    if [[ "${detail}" =~ (^|[[:space:]\(])([0-9]+)/([0-9]+)(\)|[[:space:]]|$) ]]; then
      n="${BASH_REMATCH[2]}"
      m="${BASH_REMATCH[3]}"
      if [[ "${m}" -gt 1 && "${n}" -le "${m}" ]]; then
        if [[ "${#detail}" -gt 180 ]]; then
          detail="${detail:0:177}..."
        fi
        progress_set_intra "${n}" "${m}" "${detail}"
        continue
      fi
    fi

    # Percent in notices: (12.34)% or 12.34%
    if [[ "${detail}" =~ (^|[^0-9])([0-9]{1,3}(\.[0-9]+)?)%([^0-9]|$) ]]; then
      pct_n="${BASH_REMATCH[2]}"
      soft="$(awk -v p="${pct_n}" 'BEGIN {
        s = int(p * 10 + 0.5)
        if (s < 0) s = 0
        if (s > 1000) s = 1000
        print s
      }')"
      if [[ "${#detail}" -gt 180 ]]; then
        detail="${detail:0:177}..."
      fi
      progress_lock || true
      progress_write_state_unlocked \
        "$(progress_read_unlocked phase idle)" \
        "$(progress_read_unlocked done 0)" \
        "$(progress_read_unlocked total 0)" \
        "${detail}" \
        "$(progress_read_unlocked phase_start "${PROGRESS_START_EPOCH}")" \
        "$(progress_read_unlocked tick 0)" \
        "$(progress_read_unlocked stage_i 0)" \
        "$(progress_read_unlocked stage_n 0)" \
        "${soft}" \
        -1 -1 1 \
        "$(progress_read_unlocked eta_ema -1)"
      progress_unlock
      continue
    fi

    # Any pipeline stage NOTICE keeps detail fresh (even without N/M).
    if [[ "${detail}" == stage* || "${detail}" == *"stage0"* || "${detail}" == *"stage1"* \
      || "${detail}" == *"prod_mirror"* || "${detail}" == *"pipeline"* \
      || "${detail}" == *"extraction"* || "${detail}" == *"candidates"* ]]; then
      if [[ "${#detail}" -gt 180 ]]; then
        detail="${detail:0:177}..."
      fi
      progress_set_detail "${detail}"
    fi
  done
}
