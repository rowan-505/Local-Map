# shellcheck shell=bash
# Stable PMTiles region key → core.core_admin_areas state_region polygon resolver.
# Sourced by export-region.sh, rebuild-all-regions.sh, and build-all-regions.sh.
#
# Each supported region key maps to exactly one state/region row (admin_level_code
# = state_region). OSM relation slugs are preferred; Yangon uses its canonical slug.

PMTILES_SUPPORTED_REGIONS=(
  yangon
  bago
  ayeyarwady
  mandalay
  magway
  sagaing
  tanintharyi
  naypyitaw
  kachin
  kayah
  kayin
  chin
  mon
  rakhine
  shan
)

pmtiles_region_is_supported() {
  local key="$1"
  local r
  for r in "${PMTILES_SUPPORTED_REGIONS[@]}"; do
    [[ "$r" == "$key" ]] && return 0
  done
  return 1
}

pmtiles_region_list_supported() {
  local IFS=', '
  echo "${PMTILES_SUPPORTED_REGIONS[*]}"
}

# Escape single quotes for SQL string literals.
pmtiles_sql_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

# OSM relation slug for region (empty string = canonical-name matcher, e.g. Yangon).
pmtiles_region_osm_slug() {
  case "$1" in
    bago) echo "osm:R:5996474" ;;
    ayeyarwady) echo "osm:R:5996473" ;;
    mandalay) echo "osm:R:5996480" ;;
    magway) echo "osm:R:5996479" ;;
    sagaing) echo "osm:R:5996484" ;;
    tanintharyi) echo "osm:R:5996486" ;;
    naypyitaw) echo "osm:R:5996482" ;;
    kachin) echo "osm:R:5996476" ;;
    kayah) echo "osm:R:5996477" ;;
    kayin) echo "osm:R:5996478" ;;
    chin) echo "osm:R:5996475" ;;
    mon) echo "osm:R:5996481" ;;
    rakhine) echo "osm:R:5996483" ;;
    shan) echo "osm:R:5996485" ;;
    *) echo "" ;;
  esac
}

pmtiles_region_name_en() {
  case "$1" in
    yangon) echo "Yangon Region" ;;
    bago) echo "Bago Region" ;;
    ayeyarwady) echo "Ayeyarwady Region" ;;
    mandalay) echo "Mandalay Region" ;;
    magway) echo "Magway Region" ;;
    sagaing) echo "Sagaing Region" ;;
    tanintharyi) echo "Tanintharyi Region" ;;
    naypyitaw) echo "Naypyitaw Union Territory" ;;
    kachin) echo "Kachin State" ;;
    kayah) echo "Kayah State" ;;
    kayin) echo "Kayin State" ;;
    chin) echo "Chin State" ;;
    mon) echo "Mon State" ;;
    rakhine) echo "Rakhine State" ;;
    shan) echo "Shan State" ;;
    *) echo "" ;;
  esac
}

pmtiles_region_name_mm() {
  case "$1" in
    yangon) echo "ရန်ကုန်တိုင်းဒေသကြီး" ;;
    bago) echo "ပဲခူးတိုင်းဒေသကြီး" ;;
    ayeyarwady) echo "ဧရာဝတီတိုင်း" ;;
    mandalay) echo "မန္တလေးတိုင်း" ;;
    magway) echo "မကွေးတိုင်းဒေသကြီး" ;;
    sagaing) echo "စစ်ကိုင်းတိုင်းဒေသကြီး" ;;
    tanintharyi) echo "တနင်္သာရီတိုင်း" ;;
    naypyitaw) echo "နေပြည်တော် ပြည်ထောင်စုနယ်မြေ" ;;
    kachin) echo "ကချင်ပြည်နယ်" ;;
    kayah) echo "ကယားပြည်နယ်" ;;
    kayin) echo "ကရင်ပြည်နယ်" ;;
    chin) echo "ချင်းပြည်နယ်" ;;
    mon) echo "မွန်ပြည်နယ်" ;;
    rakhine) echo "ရခိုင်ပြည်နယ်" ;;
    shan) echo "ရှမ်းပြည်နယ်" ;;
    *) echo "" ;;
  esac
}

# Build SQL predicate that matches exactly one state_region row for $region_key.
pmtiles_region_match_sql() {
  local region_key="$1"
  local osm_slug name_mm name_en
  osm_slug="$(pmtiles_region_osm_slug "$region_key")"
  name_mm="$(pmtiles_sql_quote "$(pmtiles_region_name_mm "$region_key")")"
  name_en="$(pmtiles_sql_quote "$(pmtiles_region_name_en "$region_key")")"

  if [[ -n "$osm_slug" ]]; then
    local slug_quoted
    slug_quoted="$(pmtiles_sql_quote "$osm_slug")"
    cat <<SQL
(
  a.slug = '${slug_quoted}'
  OR a.canonical_name = '${name_mm}'
  OR EXISTS (
    SELECT 1
    FROM core.core_admin_area_names AS n
    WHERE n.admin_area_id = a.id
      AND (
        lower(trim(n.name)) = lower('${name_en}')
        OR trim(n.name) = '${name_mm}'
      )
  )
)
SQL
    return 0
  fi

  # Yangon: no osm:R slug — match canonical slug/name only (avoids island noise rows).
  cat <<SQL
(
  a.slug = '${name_mm}'
  OR a.canonical_name = '${name_mm}'
  OR EXISTS (
    SELECT 1
    FROM core.core_admin_area_names AS n
    WHERE n.admin_area_id = a.id
      AND (
        lower(trim(n.name)) = lower('${name_en}')
        OR trim(n.name) = '${name_mm}'
      )
  )
)
SQL
}

# Resolve region to admin_area id; prints "id|canonical_name|area_km2" on success.
pmtiles_resolve_region_boundary() {
  local region_key="$1"
  local match_sql osm_slug name_mm

  if ! pmtiles_region_is_supported "$region_key"; then
    echo "error: unsupported region key '${region_key}'. Supported: $(pmtiles_region_list_supported)" >&2
    return 1
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "error: DATABASE_URL is not set." >&2
    return 1
  fi

  match_sql="$(pmtiles_region_match_sql "$region_key")"
  osm_slug="$(pmtiles_region_osm_slug "$region_key")"
  name_mm="$(pmtiles_region_name_mm "$region_key")"

  local result
  result="$(
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -F '|' -c "
SELECT
  a.id::text,
  a.canonical_name,
  round((st_area(a.geom::geography) / 1e6)::numeric, 1)::text
FROM core.core_admin_areas AS a
INNER JOIN ref.ref_admin_levels AS al
  ON al.id = a.admin_level_id
WHERE al.code = 'state_region'
  AND a.is_active IS TRUE
  AND a.deleted_at IS NULL
  AND a.geom IS NOT NULL
  AND NOT st_isempty(a.geom)
  AND st_isvalid(a.geom)
  AND (${match_sql})
ORDER BY st_area(a.geom::geography) DESC
LIMIT 2;
"
  )"

  if [[ -z "$result" ]]; then
    echo "error: region boundary not found for '${region_key}' (state_region in core.core_admin_areas)." >&2
    if [[ -n "$osm_slug" ]]; then
      echo "error: expected slug '${osm_slug}' or name '${name_mm}'." >&2
    else
      echo "error: expected canonical slug/name '${name_mm}'." >&2
    fi
    return 1
  fi

  local row_count
  row_count="$(printf '%s\n' "$result" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$row_count" -gt 1 ]]; then
    echo "error: region '${region_key}' matched ${row_count} state_region rows (expected exactly 1):" >&2
    printf '%s\n' "$result" | while IFS='|' read -r id name area; do
      echo "  - id=${id} name=${name} area_km2=${area}" >&2
    done
    return 1
  fi

  printf '%s' "$result" | head -n 1
}

# region_boundary + subdivided parts CTEs (resolved admin area id).
# ST_Subdivide keeps ST_Intersects fast on large line/polygon layers via GIST && prefilter per part.
pmtiles_region_boundary_ctes_sql() {
  local admin_area_id="$1"
  local buffer_meters="$2"
  local subdivide_segments="${3:-512}"
  cat <<SQL
region_boundary AS (
  SELECT
    st_setsrid(
      st_buffer(
        st_makevalid(a.geom)::geography,
        ${buffer_meters}::double precision
      )::geometry,
      4326
    ) AS geom
  FROM core.core_admin_areas AS a
  WHERE a.id = ${admin_area_id}
),
region_parts AS (
  SELECT
    (st_dump(st_subdivide(rb.geom, ${subdivide_segments}))).geom AS part_geom
  FROM region_boundary AS rb
)
SQL
}

# Clipped SELECT for a tiles.* view (all columns preserved).
pmtiles_clipped_layer_sql() {
  local view_name="$1"
  local admin_area_id="$2"
  local buffer_meters="$3"
  local subdivide_segments="${4:-512}"
  local boundary_ctes
  boundary_ctes="$(pmtiles_region_boundary_ctes_sql "$admin_area_id" "$buffer_meters" "$subdivide_segments")"
  cat <<SQL
WITH ${boundary_ctes}
SELECT DISTINCT ON (layer.id) layer.*
FROM tiles.${view_name} AS layer
INNER JOIN region_parts AS rp
  ON layer.geom && rp.part_geom
 AND st_intersects(layer.geom, rp.part_geom)
WHERE layer.geom IS NOT NULL
  AND NOT st_isempty(layer.geom)
ORDER BY layer.id
SQL
}

# Count features that would be exported for a layer (pre-export sanity check).
pmtiles_clipped_layer_count() {
  local view_name="$1"
  local admin_area_id="$2"
  local buffer_meters="$3"
  local subdivide_segments="${4:-512}"
  local boundary_ctes
  boundary_ctes="$(pmtiles_region_boundary_ctes_sql "$admin_area_id" "$buffer_meters" "$subdivide_segments")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "
SET statement_timeout TO '3600000';
WITH ${boundary_ctes}
SELECT count(DISTINCT layer.id)::bigint
FROM tiles.${view_name} AS layer
INNER JOIN region_parts AS rp
  ON layer.geom && rp.part_geom
 AND st_intersects(layer.geom, rp.part_geom)
WHERE layer.geom IS NOT NULL
  AND NOT st_isempty(layer.geom);
"
}
