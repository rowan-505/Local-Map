-- Verification for migration 194: source-fresh street names only.
--
-- Pre-migration baseline (2026-08-24, PBF timestamp 2026-08-23T20:21:36Z):
--   active streets                    823006
--   active current name rows           60362
--   active streets with current name   26282
--   active public-name streets         26267
--   public road-label rows              26267
--   all core street-name rows           60370
--   manual_override rows                  515
--
-- Dry-run safe actions: 287 inserts, 62 clearly OSM-managed updates.
-- Projected active public-name streets: 26352 (+85).

-- 1. Source snapshot and exact migration action counts.
SELECT
    snapshot_ref,
    snapshot_version,
    region_code,
    checksum,
    captured_at,
    metadata
FROM system.system_source_snapshots
WHERE snapshot_version = 'osm_myanmar_2026_08_23_street_names_v1';

SELECT
    CASE
        WHEN source_refs ? 'previous_name' THEN 'safe_update_source_derived'
        ELSE 'safe_insert'
    END AS action,
    source_refs ->> 'source_tag' AS source_tag,
    language_code,
    coalesce(script_code, 'NULL') AS script_code,
    count(*) AS rows
FROM core.core_street_names
WHERE source_refs ->> 'migration' = '194_source_fresh_street_name_refresh'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

SELECT
    count(*) FILTER (WHERE source_refs ? 'previous_name') AS updated_rows,
    count(*) FILTER (WHERE NOT source_refs ? 'previous_name') AS inserted_rows,
    count(*) AS total_rows,
    count(*) FILTER (
        WHERE source_refs ->> 'source_tag' NOT IN ('name', 'name:my', 'name:en', 'name:und')
    ) AS non_whitelisted_source_tags,
    count(*) FILTER (
        WHERE source_refs ->> 'source_tag' IN (
            'ref', 'nat_ref', 'int_ref', 'old_name', 'alt_name',
            'loc_name', 'short_name', 'official_name'
        )
    ) AS ref_alias_or_historical_promotions
FROM core.core_street_names
WHERE source_refs ->> 'migration' = '194_source_fresh_street_name_refresh';

-- 2. Immutable road network fingerprints. Every *_unchanged result must be true.
WITH actual AS (
    SELECT
        count(*) AS active_streets,
        sum(hashtextextended(id::text, 0)::numeric) AS street_id_fingerprint,
        sum(hashtextextended(
            id::text || E'\x1f' || coalesce(external_id, ''), 0
        )::numeric) AS external_id_fingerprint,
        sum(hashtextextended(
            encode(st_asewkb(geom), 'hex'), 0
        )::numeric) AS geometry_fingerprint,
        sum(hashtextextended(
            id::text || E'\x1f' || manual_override::text, 0
        )::numeric) AS manual_override_fingerprint
    FROM core.core_streets
    WHERE is_active IS TRUE
      AND deleted_at IS NULL
)
SELECT
    actual.*,
    active_streets = 823006 AS road_count_unchanged,
    street_id_fingerprint = -390357737065088333603::numeric AS street_ids_unchanged,
    external_id_fingerprint = -6744484757570026914557::numeric AS external_ids_unchanged,
    geometry_fingerprint = -7622866185754379607386::numeric AS geometries_unchanged,
    manual_override_fingerprint = 12580983650663866742446::numeric AS manual_overrides_unchanged
FROM actual;

-- 3. Coverage and language/script counts.
WITH active AS (
    SELECT *
    FROM core.core_streets
    WHERE is_active IS TRUE
      AND deleted_at IS NULL
), current_names AS (
    SELECT name.*
    FROM core.core_street_names AS name
    JOIN active AS street ON street.id = name.street_id
    WHERE name.is_primary IS TRUE
      AND lower(btrim(name.name_type)) IN ('official', 'primary')
      AND nullif(btrim(name.name), '') IS NOT NULL
)
SELECT
    (SELECT count(*) FROM active) AS active_streets,
    (SELECT count(*) FROM current_names) AS active_current_name_rows,
    (SELECT count(DISTINCT street_id) FROM current_names) AS active_streets_with_current_name,
    (SELECT count(*)
     FROM tiles.tiles_street_public_names_v AS public_name
     JOIN active AS street ON street.id = public_name.street_id)
        AS active_streets_with_public_name,
    (SELECT count(*) FROM tiles.tiles_road_labels_v) AS public_label_rows,
    (SELECT count(*) FROM tiles.tiles_roads_v WHERE name IS NULL)
        AS remaining_renderable_unnamed_roads;

SELECT
    coalesce(nullif(lower(btrim(name.language_code)), ''), 'und') AS language_code,
    coalesce(nullif(btrim(name.script_code), ''), 'NULL') AS script_code,
    count(*) AS rows,
    count(DISTINCT name.street_id) AS streets
FROM core.core_street_names AS name
JOIN core.core_streets AS street ON street.id = name.street_id
WHERE street.is_active IS TRUE
  AND street.deleted_at IS NULL
  AND name.is_primary IS TRUE
  AND lower(btrim(name.name_type)) IN ('official', 'primary')
  AND nullif(btrim(name.name), '') IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

-- 4. Ref was never a candidate. This comparison is an additional guard against
-- accidentally inserting a value equal to a preserved ref-like tag.
SELECT
    count(*) FILTER (
        WHERE lower(btrim(name.name)) = lower(coalesce(street.normalized_data #>> '{tags,ref}', ''))
    ) AS equals_preserved_ref,
    count(*) FILTER (
        WHERE lower(btrim(name.name)) = lower(coalesce(street.normalized_data #>> '{tags,nat_ref}', ''))
    ) AS equals_preserved_nat_ref,
    count(*) FILTER (
        WHERE lower(btrim(name.name)) = lower(coalesce(street.normalized_data #>> '{tags,int_ref}', ''))
    ) AS equals_preserved_int_ref
FROM core.core_street_names AS name
JOIN core.core_streets AS street ON street.id = name.street_id
WHERE name.source_refs ->> 'migration' = '194_source_fresh_street_name_refresh';

-- 5. Public tile labels still reject generated/internal/ref identifiers.
WITH public_values AS (
    SELECT 'tiles_roads_v.name'::text AS field, name AS value
    FROM tiles.tiles_roads_v
    UNION ALL
    SELECT 'tiles_streets_v.name', name FROM tiles.tiles_streets_v
    UNION ALL
    SELECT 'tiles_streets_v.canonical_name', canonical_name FROM tiles.tiles_streets_v
    UNION ALL
    SELECT 'tiles_road_labels_v.name', name FROM tiles.tiles_road_labels_v
    UNION ALL
    SELECT 'tiles_road_labels_v.name_mm', name_mm FROM tiles.tiles_road_labels_v
    UNION ALL
    SELECT 'tiles_road_labels_v.name_en', name_en FROM tiles.tiles_road_labels_v
)
SELECT
    field,
    count(*) FILTER (WHERE value ~* '^(road|street)[_-][0-9]+$') AS generated_values,
    count(*) FILTER (WHERE value ~* '^unnamed(?:[[:space:]_-].*)?$') AS unnamed_values,
    count(*) FILTER (WHERE value ~* '^osm([_:/-]|$)') AS osm_identifier_values,
    count(*) FILTER (
        WHERE value ~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
    ) AS osm_object_identifier_values,
    count(*) FILTER (
        WHERE value IS NOT NULL AND nullif(btrim(value), '') IS NULL
    ) AS empty_values
FROM public_values
GROUP BY field
ORDER BY field;

SELECT
    count(*) FILTER (
        WHERE lower(btrim(public_name.name)) = lower(coalesce(street.normalized_data #>> '{tags,ref}', ''))
    ) AS ref_values_emitted,
    count(*) FILTER (
        WHERE lower(btrim(public_name.name)) = lower(coalesce(street.normalized_data #>> '{tags,route}', ''))
    ) AS route_values_emitted,
    count(*) FILTER (
        WHERE lower(btrim(public_name.name)) = lower(coalesce(street.normalized_data #>> '{tags,destination}', ''))
    ) AS destination_values_emitted
FROM tiles.tiles_street_public_names_v AS public_name
JOIN core.core_streets AS street ON street.id = public_name.street_id;
