-- Read-only source-fresh street-name classification.
--
-- The caller creates and loads temp_osm_name_ways. This script creates only
-- temporary relations and reads production Core tables. It never uses geometry.

CREATE TEMP TABLE temp_source_fresh_candidates ON COMMIT DROP AS
WITH raw AS (
    SELECT
        source.osm_way_id,
        source.osm_version,
        source.osm_timestamp,
        source.tags,
        candidate.source_tag,
        candidate.language_code,
        candidate.fixed_script_code,
        nullif(btrim(candidate.raw_name), '') AS candidate_name,
        candidate.tag_priority
    FROM temp_osm_name_ways AS source
    CROSS JOIN LATERAL (VALUES
        ('name:my'::text,  'my'::text,  'Mymr'::text, source.tags ->> 'name:my', 1),
        ('name:en'::text,  'en'::text,  'Latn'::text, source.tags ->> 'name:en', 1),
        ('name'::text,     'und'::text, NULL::text,   source.tags ->> 'name',    1),
        ('name:und'::text, 'und'::text, NULL::text,   source.tags ->> 'name:und', 2)
    ) AS candidate(source_tag, language_code, fixed_script_code, raw_name, tag_priority)
), attached AS (
    SELECT
        raw.*,
        street.id AS street_id,
        street.public_id,
        street.external_id,
        street.manual_override,
        street.is_verified,
        street.source_refs AS street_source_refs,
        CASE
            WHEN raw.fixed_script_code IS NOT NULL THEN raw.fixed_script_code
            WHEN raw.candidate_name ~ '[က-႟ꧠ-꧿ꩠ-ꩿ]'
             AND raw.candidate_name !~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]' THEN 'Mymr'
            WHEN raw.candidate_name ~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ]'
             AND raw.candidate_name !~ '[က-႟ꧠ-꧿ꩠ-ꩿ]' THEN 'Latn'
            ELSE NULL
        END AS script_code,
        CASE
            WHEN raw.candidate_name IS NULL THEN 'empty'
            WHEN raw.candidate_name ~* '^(road|street)[_-][0-9]+$' THEN 'generated_road_identifier'
            WHEN raw.candidate_name ~* '^unnamed(?:[[:space:]_-].*)?$' THEN 'unnamed_placeholder'
            WHEN raw.candidate_name ~* '^osm([_:/-]|$)' THEN 'osm_identifier'
            WHEN raw.candidate_name ~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$' THEN 'osm_object_identifier'
            WHEN raw.candidate_name ~* '^[0-9]+$' THEN 'numeric_identifier'
            WHEN raw.candidate_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN 'uuid_identifier'
            WHEN lower(raw.candidate_name) = lower(coalesce(street.public_id::text, '')) THEN 'equals_public_id'
            WHEN lower(raw.candidate_name) = lower(coalesce(street.external_id, '')) THEN 'equals_external_id'
            WHEN lower(raw.candidate_name) = lower(coalesce(raw.tags ->> 'ref', '')) THEN 'equals_ref'
            WHEN lower(raw.candidate_name) = lower(coalesce(raw.tags ->> 'nat_ref', '')) THEN 'equals_nat_ref'
            WHEN lower(raw.candidate_name) = lower(coalesce(raw.tags ->> 'int_ref', '')) THEN 'equals_int_ref'
            WHEN lower(raw.candidate_name) = lower(coalesce(raw.tags ->> 'route', '')) THEN 'equals_route'
            WHEN lower(raw.candidate_name) = lower(coalesce(raw.tags ->> 'destination', '')) THEN 'equals_destination'
            ELSE NULL
        END AS invalid_reason
    FROM raw
    LEFT JOIN core.core_streets AS street
      ON street.external_id = 'osm:W:' || raw.osm_way_id::text
     AND street.is_active IS TRUE
     AND street.deleted_at IS NULL
    WHERE raw.candidate_name IS NOT NULL
), slot_stats AS (
    SELECT
        attached.*,
        CASE
            WHEN min(lower(attached.candidate_name)) OVER (
                    PARTITION BY attached.osm_way_id, attached.language_code
                 )
                 <> max(lower(attached.candidate_name)) OVER (
                    PARTITION BY attached.osm_way_id, attached.language_code
                 )
                THEN 2
            ELSE 1
        END AS distinct_source_values,
        row_number() OVER (
            PARTITION BY attached.osm_way_id, attached.language_code
            ORDER BY attached.tag_priority, attached.source_tag
        ) AS source_rank
    FROM attached
), existing AS (
    SELECT
        slot_stats.*,
        exact_match.id AS exact_existing_id,
        current_slot.id AS existing_name_id,
        current_slot.name AS existing_name,
        current_slot.source_refs AS existing_source_refs,
        current_slot.slot_count AS existing_slot_count
    FROM slot_stats
    LEFT JOIN LATERAL (
        SELECT name.id
        FROM core.core_street_names AS name
        WHERE name.street_id = slot_stats.street_id
          AND coalesce(nullif(lower(btrim(name.language_code)), ''), 'und') = slot_stats.language_code
          AND name.is_primary IS TRUE
          AND lower(btrim(name.name_type)) IN ('official', 'primary')
          AND lower(btrim(name.name)) = lower(slot_stats.candidate_name)
        ORDER BY CASE WHEN lower(btrim(name.name_type)) = 'official' THEN 0 ELSE 1 END, name.id
        LIMIT 1
    ) AS exact_match ON true
    LEFT JOIN LATERAL (
        SELECT
            name.id,
            name.name,
            name.source_refs,
            count(*) OVER () AS slot_count
        FROM core.core_street_names AS name
        WHERE name.street_id = slot_stats.street_id
          AND coalesce(nullif(lower(btrim(name.language_code)), ''), 'und') = slot_stats.language_code
          AND name.is_primary IS TRUE
          AND lower(btrim(name.name_type)) IN ('official', 'primary')
          AND nullif(btrim(name.name), '') IS NOT NULL
          AND btrim(name.name) !~* '^(road|street)[_-][0-9]+$'
          AND btrim(name.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
          AND btrim(name.name) !~* '^osm([_:/-]|$)'
          AND btrim(name.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
        ORDER BY name.id
        LIMIT 1
    ) AS current_slot ON true
)
SELECT
    existing.*,
    CASE
        WHEN existing.street_id IS NULL THEN 'no_matching_core_street'
        WHEN existing.invalid_reason IS NOT NULL THEN 'invalid'
        WHEN existing.distinct_source_values > 1 THEN 'conflict'
        WHEN existing.source_rank > 1 THEN 'noop'
        WHEN existing.exact_existing_id IS NOT NULL THEN 'noop'
        WHEN existing.manual_override IS TRUE
          OR existing.is_verified IS TRUE
          OR lower(coalesce(existing.street_source_refs ->> 'source', '')) IN ('dashboard', 'manual')
          OR lower(coalesce(existing.street_source_refs ->> 'origin', '')) IN ('dashboard', 'manual')
            THEN 'manual_protected'
        WHEN existing.existing_name_id IS NULL THEN 'safe_insert'
        WHEN existing.existing_slot_count = 1
          AND lower(coalesce(existing.existing_source_refs ->> 'source', '')) = 'osm'
          AND existing.existing_source_refs ->> 'source_tag' = existing.source_tag
          AND lower(coalesce(existing.existing_source_refs ->> 'source_field', ''))
                IN ('normalized_data.tags', 'osm.pbf.tags')
            THEN 'safe_update_source_derived'
        ELSE 'conflict'
    END AS classification,
    CASE
        WHEN existing.street_id IS NULL THEN 'no exact active external_id match'
        WHEN existing.invalid_reason IS NOT NULL THEN existing.invalid_reason
        WHEN existing.distinct_source_values > 1 THEN 'multiple different current values for one language slot in source'
        WHEN existing.source_rank > 1 THEN 'duplicate source value for language slot'
        WHEN existing.exact_existing_id IS NOT NULL THEN 'identical current name already exists'
        WHEN existing.manual_override IS TRUE OR existing.is_verified IS TRUE THEN 'street is manual_override or verified'
        WHEN lower(coalesce(existing.street_source_refs ->> 'source', '')) IN ('dashboard', 'manual')
          OR lower(coalesce(existing.street_source_refs ->> 'origin', '')) IN ('dashboard', 'manual')
            THEN 'street provenance is manual'
        WHEN existing.existing_name_id IS NULL THEN 'empty current language slot'
        WHEN existing.existing_slot_count = 1
          AND lower(coalesce(existing.existing_source_refs ->> 'source', '')) = 'osm'
          AND existing.existing_source_refs ->> 'source_tag' = existing.source_tag
          AND lower(coalesce(existing.existing_source_refs ->> 'source_field', ''))
                IN ('normalized_data.tags', 'osm.pbf.tags')
            THEN 'single clearly OSM-managed row for same source tag'
        ELSE 'different legitimate current name or insufficient provenance'
    END AS classification_reason
FROM existing;

CREATE INDEX ON temp_source_fresh_candidates (classification);
CREATE INDEX ON temp_source_fresh_candidates (street_id);

CREATE TEMP VIEW temp_other_language_names AS
SELECT
    source.osm_way_id,
    source.osm_version,
    source.osm_timestamp,
    key AS source_tag,
    value AS candidate_name,
    street.id AS street_id,
    street.external_id,
    CASE
        WHEN street.id IS NULL THEN 'no_matching_core_street'
        ELSE 'unsupported_language_code_review'
    END AS classification
FROM temp_osm_name_ways AS source
CROSS JOIN LATERAL jsonb_each_text(source.tags) AS tag(key, value)
LEFT JOIN core.core_streets AS street
  ON street.external_id = 'osm:W:' || source.osm_way_id::text
 AND street.is_active IS TRUE
 AND street.deleted_at IS NULL
WHERE key LIKE 'name:%'
  AND key NOT IN ('name:my', 'name:en', 'name:und')
  AND nullif(btrim(value), '') IS NOT NULL;

CREATE TEMP VIEW temp_secondary_names AS
SELECT
    source.osm_way_id,
    source.osm_version,
    source.osm_timestamp,
    tag.source_tag,
    tag.candidate_name,
    street.id AS street_id,
    street.external_id,
    CASE
        WHEN street.id IS NULL THEN 'no_matching_core_street'
        WHEN tag.source_tag = 'old_name' THEN 'historical_review_only'
        ELSE 'secondary_review_only'
    END AS classification
FROM temp_osm_name_ways AS source
CROSS JOIN LATERAL (VALUES
    ('official_name'::text, nullif(btrim(source.tags ->> 'official_name'), '')),
    ('short_name'::text,    nullif(btrim(source.tags ->> 'short_name'), '')),
    ('loc_name'::text,      nullif(btrim(source.tags ->> 'loc_name'), '')),
    ('alt_name'::text,      nullif(btrim(source.tags ->> 'alt_name'), '')),
    ('old_name'::text,      nullif(btrim(source.tags ->> 'old_name'), ''))
) AS tag(source_tag, candidate_name)
LEFT JOIN core.core_streets AS street
  ON street.external_id = 'osm:W:' || source.osm_way_id::text
 AND street.is_active IS TRUE
 AND street.deleted_at IS NULL
WHERE tag.candidate_name IS NOT NULL;
