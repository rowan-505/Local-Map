#!/usr/bin/env bash
# One-time artifact-based buildings direct-Core import (dry-run default).
# Reads retained buildings.safe.csv — does not re-export from staging.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ART_ROOT="${SCRIPT_DIR}/artifacts/buildings_national_2026_07_31"
PKG="${ART_ROOT}/one_time_artifact_package"
SAFE_CSV="${PKG}/buildings.safe.csv"
MANIFEST="${PKG}/buildings.dry_run_manifest.csv"
EXPECTED_SAFE_SHA="d308f9785e9e9570185a0b025517f4049997f0e0dd263180052cc5dcc881e6b6"
EXPECTED_MAN_SHA="83f4b09ebc14a8dca39365f1aadba88202ff5a01af8ebf214190f168352927be"
MODE="dry_run"
ENV_FILE="${REPO_ROOT}/tools/data-pipeline/prod-mirror/00_env.sh"
REGION_CODE="mm-core-buildings-v1"
SNAPSHOT_VERSION="osm_myanmar_2026_07_21_national_dry_run_v1"

usage() {
  cat <<'EOF'
usage: run_buildings_artifact_import.sh [--dry-run|--apply]

Default: --dry-run (ROLLBACK).

--apply also requires:
  EXECUTE_BUILDINGS_DIRECT_CORE=I_UNDERSTAND
  and confirmation IMPORT buildings mm-core-buildings-v1 osm_myanmar_2026_07_21_national_dry_run_v1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry_run"; shift ;;
    --apply) MODE="apply"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

echo "=== checksum gate ==="
SAFE_SHA="$(sha_of "${SAFE_CSV}")"
MAN_SHA="$(sha_of "${MANIFEST}")"
echo "buildings.safe.csv=${SAFE_SHA}"
echo "buildings.dry_run_manifest.csv=${MAN_SHA}"
[[ "${SAFE_SHA}" == "${EXPECTED_SAFE_SHA}" ]] || { echo "SAFE checksum mismatch" >&2; exit 1; }
[[ "${MAN_SHA}" == "${EXPECTED_MAN_SHA}" ]] || { echo "MANIFEST checksum mismatch" >&2; exit 1; }
echo "checksums OK"

echo "=== invoke existing direct-Core runner (mode=${MODE}) ==="
ARGS=(
  --family buildings
  --target production
  --csv "${SAFE_CSV}"
  --region-code "${REGION_CODE}"
  --snapshot-version "${SNAPSHOT_VERSION}"
  --env-file "${ENV_FILE}"
)
if [[ "${MODE}" == "apply" ]]; then
  export EXECUTE_BUILDINGS_DIRECT_CORE="${EXECUTE_BUILDINGS_DIRECT_CORE:-}"
  ARGS+=(--apply --confirmation "IMPORT buildings ${REGION_CODE} ${SNAPSHOT_VERSION}")
else
  ARGS+=(--dry-run)
fi

export SUPABASE_ALLOW_IDENTICAL_READ_WRITE_URL=true
bash "${SCRIPT_DIR}/run_direct_core_import.sh" "${ARGS[@]}"
