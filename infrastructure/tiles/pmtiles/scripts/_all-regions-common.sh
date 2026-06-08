# shellcheck shell=bash
# Shared sequential runner for all-regions PMTiles pipelines.
# Sourced by rebuild-all-regions.sh and build-all-regions.sh — not executed directly.

all_regions_human_size() {
  local path="$1"
  if [[ -f "$path" ]]; then
    ls -lh "$path" | awk '{print $5}'
  else
    echo "missing"
  fi
}

all_regions_now() {
  date '+%Y-%m-%d %H:%M:%S'
}

all_regions_elapsed() {
  local start="$1"
  local end="$2"
  local secs=$((end - start))
  printf '%dm %ds' $((secs / 60)) $((secs % 60))
}

# Yangon-only version override: YANGON_VERSION=v2 bash .../rebuild-all-regions.sh v1
all_regions_resolve_version() {
  local region="$1"
  local default_version="$2"
  if [[ "$region" == "yangon" && -n "${YANGON_VERSION:-}" ]]; then
    printf '%s' "$YANGON_VERSION"
  else
    printf '%s' "$default_version"
  fi
}

# Minimum bytes for an existing archive to count as completed (default 1 MiB).
all_regions_min_complete_bytes() {
  printf '%s' "${PMTILES_SKIP_MIN_BYTES:-1048576}"
}

all_regions_output_bytes() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    printf '0'
    return 0
  fi
  stat -f%z "$path" 2>/dev/null || stat -c%s "$path" 2>/dev/null || printf '0'
}

# True when PMTILES_SKIP_COMPLETED=1 and output archive already exists above min size.
all_regions_is_completed() {
  local out_pmtiles="$1"
  if [[ "${PMTILES_SKIP_COMPLETED:-0}" != "1" ]]; then
    return 1
  fi
  local min_bytes size
  min_bytes="$(all_regions_min_complete_bytes)"
  size="$(all_regions_output_bytes "$out_pmtiles")"
  [[ "$size" -ge "$min_bytes" ]]
}

all_regions_list_incomplete() {
  local default_version="$1"
  local pmtiles_root="${PMTILES_ROOT:-}"
  local script_dir region region_version out_pmtiles
  if [[ -z "$pmtiles_root" ]]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    pmtiles_root="$(cd "${script_dir}/.." && pwd)"
  fi
  for region in "${PMTILES_SUPPORTED_REGIONS[@]}"; do
    region_version="$(all_regions_resolve_version "$region" "$default_version")"
    out_pmtiles="${pmtiles_root}/regions/${region}/${region}-${region_version}.pmtiles"
    if ! all_regions_is_completed "$out_pmtiles"; then
      printf '%s\n' "$region"
    fi
  done
}

all_regions_parse_args() {
  ALL_REGIONS_VERSION=""
  ALL_REGIONS_START_REGION=""
  ALL_REGIONS_CONTINUE_ON_ERROR="${CONTINUE_ON_ERROR:-0}"
  ALL_REGIONS_EXTRA_BUILD_ARGS=()

  if [[ "$ALL_REGIONS_CONTINUE_ON_ERROR" == "1" ]]; then
    ALL_REGIONS_CONTINUE_ON_ERROR=1
  else
    ALL_REGIONS_CONTINUE_ON_ERROR=0
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --continue-on-error)
        ALL_REGIONS_CONTINUE_ON_ERROR=1
        ;;
      --skip-buildings|--roads-only|--light-only|--no-progress-ticker)
        ALL_REGIONS_EXTRA_BUILD_ARGS+=("$1")
        ;;
      -h|--help)
        all_regions_print_usage
        exit 0
        ;;
      *)
        if [[ -z "$ALL_REGIONS_VERSION" ]]; then
          ALL_REGIONS_VERSION="$1"
        elif [[ -z "$ALL_REGIONS_START_REGION" ]]; then
          if pmtiles_region_is_supported "$1"; then
            ALL_REGIONS_START_REGION="$1"
          else
            echo "error: unknown argument or region: $1" >&2
            exit 1
          fi
        else
          echo "error: unexpected argument: $1" >&2
          exit 1
        fi
        ;;
    esac
    shift
  done

  if [[ -z "$ALL_REGIONS_VERSION" ]]; then
    all_regions_print_usage
    exit 1
  fi
}

all_regions_run_pipeline() {
  local mode="$1"       # rebuild | build
  local log_prefix="$2" # rebuild-all | build-all
  local tag="$3"        # rebuild-all | build-all

  local script_dir pmtiles_root log_dir log_file pipeline_started
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  pmtiles_root="$(cd "${script_dir}/.." && pwd)"
  log_dir="${pmtiles_root}/logs"
  mkdir -p "$log_dir"
  log_file="${log_dir}/${log_prefix}-$(date '+%Y%m%dT%H%M%S').log"

  exec > >(tee -a "$log_file") 2>&1

  pipeline_started="$(date +%s)"
  local started=0 failed=0 succeeded=0
  declare -a failed_regions=()

  echo ""
  echo "[${tag}] started $(all_regions_now)"
  echo "[${tag}] mode=${mode} default_version=${ALL_REGIONS_VERSION}"
  echo "[${tag}] yangon_version=${YANGON_VERSION:-${ALL_REGIONS_VERSION}}"
  echo "[${tag}] start_region=${ALL_REGIONS_START_REGION:-<first>}"
  echo "[${tag}] skip_completed=${PMTILES_SKIP_COMPLETED:-0}"
  echo "[${tag}] continue_on_error=${ALL_REGIONS_CONTINUE_ON_ERROR}"
  echo "[${tag}] log=${log_file}"
  echo "[${tag}] regions: $(pmtiles_region_list_supported)"
  echo ""

  for region in "${PMTILES_SUPPORTED_REGIONS[@]}"; do
    if [[ -n "$ALL_REGIONS_START_REGION" && "$started" -eq 0 ]]; then
      if [[ "$region" != "$ALL_REGIONS_START_REGION" ]]; then
        echo "[${tag}] skip ${region} (waiting for start region ${ALL_REGIONS_START_REGION})"
        continue
      fi
      started=1
    fi

    local region_version region_started region_ended out_pmtiles
    region_version="$(all_regions_resolve_version "$region" "$ALL_REGIONS_VERSION")"
    out_pmtiles="${pmtiles_root}/regions/${region}/${region}-${region_version}.pmtiles"

    if all_regions_is_completed "$out_pmtiles"; then
      echo "[${tag}] skip ${region} ${region_version} (completed: ${out_pmtiles} size=$(all_regions_human_size "$out_pmtiles"))"
      succeeded=$((succeeded + 1))
      continue
    fi

    region_started="$(date +%s)"

    echo "[${tag}] === ${region} ${region_version} ==="
    echo "[${tag}] ${region} start $(all_regions_now)"

    local rc=0
    if [[ "$mode" == "rebuild" ]]; then
      if [[ ${#ALL_REGIONS_EXTRA_BUILD_ARGS[@]} -gt 0 ]]; then
        bash "${script_dir}/rebuild-region.sh" "$region" "$region_version" "${ALL_REGIONS_EXTRA_BUILD_ARGS[@]}" || rc=$?
      else
        bash "${script_dir}/rebuild-region.sh" "$region" "$region_version" || rc=$?
      fi
    else
      if [[ ${#ALL_REGIONS_EXTRA_BUILD_ARGS[@]} -gt 0 ]]; then
        bash "${script_dir}/build-region.sh" "$region" "$region_version" "${ALL_REGIONS_EXTRA_BUILD_ARGS[@]}" || rc=$?
      else
        bash "${script_dir}/build-region.sh" "$region" "$region_version" || rc=$?
      fi
    fi

    region_ended="$(date +%s)"

    if [[ "$rc" -eq 0 ]]; then
      succeeded=$((succeeded + 1))
      echo "[${tag}] ${region} end $(all_regions_now) elapsed=$(all_regions_elapsed "$region_started" "$region_ended") status=OK"
      echo "[${tag}] ${region} output=${out_pmtiles} size=$(all_regions_human_size "$out_pmtiles")"
    else
      failed=$((failed + 1))
      failed_regions+=("$region")
      echo "[${tag}] ${region} end $(all_regions_now) elapsed=$(all_regions_elapsed "$region_started" "$region_ended") status=FAILED"
      if [[ -f "$out_pmtiles" ]]; then
        echo "[${tag}] ${region} partial output=${out_pmtiles} size=$(all_regions_human_size "$out_pmtiles")"
      fi
      if [[ "$ALL_REGIONS_CONTINUE_ON_ERROR" -eq 0 ]]; then
        echo "[${tag}] aborting (set CONTINUE_ON_ERROR=1 or pass --continue-on-error to keep going)"
        echo "[${tag}] finished $(all_regions_now) total_elapsed=$(all_regions_elapsed "$pipeline_started" "$(date +%s)") succeeded=${succeeded} failed=${failed}"
        exit 1
      fi
    fi
    echo ""
  done

  echo "[${tag}] finished $(all_regions_now) total_elapsed=$(all_regions_elapsed "$pipeline_started" "$(date +%s)") succeeded=${succeeded} failed=${failed}"
  if [[ ${#failed_regions[@]} -gt 0 ]]; then
    echo "[${tag}] failed regions: ${failed_regions[*]}"
    exit 1
  fi
}
