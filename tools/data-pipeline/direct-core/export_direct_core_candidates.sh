#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAMILY=""
SNAPSHOT_VERSION=""
STAGING_SCHEMA="staging"
OUTPUT_PATH=""
REJECTION_PATH=""

usage(){
  cat <<'EOF'
usage: export_direct_core_candidates.sh --family FAMILY \
  --snapshot-version VERSION --output PATH --rejections PATH \
  [--staging-schema NAME]

Reads LOCAL_DATABASE_URL only. It never connects to a production URL.
EOF
}

while [[ $# -gt 0 ]]; do
 case "$1" in
  --family) FAMILY="${2:-}"; shift 2 ;;
  --snapshot-version) SNAPSHOT_VERSION="${2:-}"; shift 2 ;;
  --staging-schema) STAGING_SCHEMA="${2:-}"; shift 2 ;;
  --output) OUTPUT_PATH="${2:-}"; shift 2 ;;
  --rejections) REJECTION_PATH="${2:-}"; shift 2 ;;
  -h|--help) usage; exit 0 ;;
  *) echo "error: unknown argument: $1" >&2; exit 2 ;;
 esac
done

[[ -n "${LOCAL_DATABASE_URL:-}" ]]||{ echo "error: LOCAL_DATABASE_URL is required" >&2;exit 2; }
[[ -n "${FAMILY}" ]]||{ usage >&2;exit 2; }
[[ -n "${SNAPSHOT_VERSION}" ]]||{ echo "error: missing --snapshot-version" >&2;exit 2; }
[[ -n "${OUTPUT_PATH}" && -n "${REJECTION_PATH}" ]]||{ echo "error: output paths are required" >&2;exit 2; }
[[ "${STAGING_SCHEMA}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]||{ echo "error: invalid staging schema" >&2;exit 2; }

case "${FAMILY}" in
 places|roads|buildings|landuse|water_lines|water_polygons|routing_barriers);;
 *)echo "error: unsupported family: ${FAMILY}" >&2;exit 2;;
esac

for path_var in OUTPUT_PATH REJECTION_PATH;do
 path="${!path_var}"
 parent="$(cd "$(dirname "${path}")" && pwd)"
 printf -v "${path_var}" '%s/%s' "${parent}" "$(basename "${path}")"
done
[[ "${OUTPUT_PATH}" != "${REJECTION_PATH}" ]]||{ echo "error: output and rejection paths must differ" >&2;exit 2; }

PAGER=cat psql "${LOCAL_DATABASE_URL}" \
 -X -v ON_ERROR_STOP=1 \
 -v snapshot_version="${SNAPSHOT_VERSION}" \
 -v staging_schema="${STAGING_SCHEMA}" \
 -v output_path="${OUTPUT_PATH}" \
 -v rejection_path="${REJECTION_PATH}" \
 -f "${SCRIPT_DIR}/export/export_${FAMILY}.sql"

echo "safe_csv=${OUTPUT_PATH}"
echo "invalid_rejections=${REJECTION_PATH}"
