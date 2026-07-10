#!/usr/bin/env bash
# Probe a running Martin instance for transport TileJSON fields and sample tile availability.
# Usage:
#   MARTIN_URL=http://localhost:3002 ./validate-transport-runtime.sh
set -euo pipefail

MARTIN_URL="${MARTIN_URL:-http://localhost:3002}"
BASE="${MARTIN_URL%/}"

TRANSPORT_SOURCES=(
  transport_stops_v
  transport_terminals_v
  transport_route_paths_v
  transport_infrastructure_lines_v
)

# Yangon CBD — dense stop cluster used for zoom probes.
PROBE_LAT=16.86
PROBE_LON=96.15

failures=0

lat_lon_to_tile() {
  python3 - "$1" "$2" "$3" <<'PY'
import math, sys
lat, lon, z = map(float, sys.argv[1:4])
z = int(z)
n = 2 ** z
x = int((lon + 180) / 360 * n)
lat_rad = math.radians(lat)
y = int((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n)
print(x, y)
PY
}

echo "Martin runtime check: ${BASE}"

for source in "${TRANSPORT_SOURCES[@]}"; do
  tilejson="$(curl -fsS "${BASE}/${source}" 2>/dev/null || true)"
  if [[ -z "${tilejson}" ]]; then
    echo "FAIL ${source}: TileJSON unreachable"
    failures=$((failures + 1))
    continue
  fi

  fields="$(printf '%s' "${tilejson}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(sorted(d.get('vector_layers',[{}])[0].get('fields',{}).keys())))")"
  echo "OK   ${source} TileJSON fields: ${fields}"

  if [[ "${source}" != "transport_stops_v" ]]; then
    continue
  fi

  for z in 14 16 18 20; do
    read -r x y < <(lat_lon_to_tile "${PROBE_LAT}" "${PROBE_LON}" "${z}")
    headers="$(curl -sSI "${BASE}/${source}/${z}/${x}/${y}" | tr -d '\r')"
    status="$(printf '%s\n' "${headers}" | awk 'toupper($1) ~ /^HTTP/ { print $2; exit }')"
  size="$(printf '%s\n' "${headers}" | awk -F': ' 'tolower($1)=="content-length" { print $2; exit }')"
    size="${size:-0}"
    echo "     probe z${z} tile ${x}/${y}: http=${status} bytes=${size}"
    if [[ "${z}" -le 16 && "${status}" != "200" ]]; then
      echo "  WARN ${source}: expected data at z${z} for Yangon probe tile"
      failures=$((failures + 1))
    fi
    if [[ "${z}" -ge 18 && "${status}" == "200" && "${size}" == "0" ]]; then
      echo "  WARN ${source}: empty tile at z${z} (MapLibre may hide stops unless it overzooms)"
    fi
  done
done

if [[ "${failures}" -gt 0 ]]; then
  echo ""
  echo "Martin runtime validation reported ${failures} issue(s)."
  exit 1
fi

echo ""
echo "Martin runtime validation passed."
