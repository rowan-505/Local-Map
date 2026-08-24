#!/usr/bin/env python3
"""Generate the migration containing only pre-classified safe name changes."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


MIGRATION_KEY = "194_source_fresh_street_name_refresh"
SNAPSHOT_VERSION = "osm_myanmar_2026_08_23_street_names_v1"


def literal(value: str | None) -> str:
    if value in (None, ""):
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--classified-csv", required=True, type=Path)
    parser.add_argument("--source-summary", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    source = json.loads(args.source_summary.read_text(encoding="utf-8"))
    with args.classified_csv.open(encoding="utf-8", newline="") as file:
        safe = [
            row
            for row in csv.DictReader(file)
            if row["classification"]
            in ("safe_insert", "safe_update_source_derived")
        ]

    inserts = [row for row in safe if row["classification"] == "safe_insert"]
    updates = [
        row for row in safe if row["classification"] == "safe_update_source_derived"
    ]
    if len(inserts) != 287 or len(updates) != 62:
        raise SystemExit(
            f"refusing unexpected dry-run counts: inserts={len(inserts)}, updates={len(updates)}"
        )

    values = []
    for row in safe:
        values.append(
            "        ("
            + ", ".join(
                (
                    literal(row["classification"]),
                    literal(row["external_id"]),
                    row["osm_way_id"],
                    row["osm_version"] or "NULL",
                    literal(row["osm_timestamp"]),
                    literal(row["source_tag"]),
                    literal(row["candidate_name"]),
                    literal(row["language_code"]),
                    literal(row["script_code"]),
                    literal(row["existing_name"]),
                )
            )
            + ")"
        )

    sql = f"""-- Source-fresh OSM street-name refresh (exact way-ID matches only).
-- Generated from the completed dry run; do not edit the VALUES payload by hand.
--
-- PBF timestamp: {source['pbf_timestamp']}
-- PBF SHA-256: {source['pbf_sha256']}
-- Safe actions: {len(inserts)} inserts, {len(updates)} OSM-managed updates.
-- Geometry, core street identity, external_id, lifecycle, and PMTiles are untouched.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
    IF (SELECT count(*) FROM system.system_source_registry WHERE source_code = 'osm_myanmar') <> 1 THEN
        RAISE EXCEPTION 'expected exactly one active osm_myanmar source registry row';
    END IF;
END
$$;

WITH source AS (
    SELECT id
    FROM system.system_source_registry
    WHERE source_code = 'osm_myanmar'
), import_batch AS (
    INSERT INTO system.system_import_batches (
        source_registry_id, batch_name, trigger_type, status,
        started_at, finished_at, note
    )
    SELECT
        source.id,
        'source_fresh_street_names_2026_08_23',
        'manual',
        'completed',
        now(),
        now(),
        'Exact osm:W:<way_id> name-tag refresh; no geometry processing.'
    FROM source
    RETURNING id, source_registry_id
)
INSERT INTO system.system_source_snapshots (
    source_registry_id,
    import_batch_id,
    snapshot_ref,
    snapshot_version,
    region_code,
    checksum,
    captured_at,
    metadata
)
SELECT
    import_batch.source_registry_id,
    import_batch.id,
    'myanmar-260823.osm.pbf',
    '{SNAPSHOT_VERSION}',
    'MM',
    '{source['pbf_sha256']}',
    '{source['pbf_timestamp']}'::timestamptz,
    jsonb_build_object(
        'provider', 'geofabrik',
        'families', jsonb_build_array('street_names'),
        'matching', 'exact_external_id_osm_way',
        'geometry_processed', false,
        'osm_ways_scanned', {source['osm_ways_scanned']},
        'name_metadata_ways', {source['name_metadata_ways']},
        'migration', '{MIGRATION_KEY}'
    )
FROM import_batch;

CREATE TEMP TABLE temp_source_fresh_safe_names (
    action text NOT NULL,
    external_id text NOT NULL,
    osm_way_id bigint NOT NULL,
    osm_version integer,
    osm_timestamp timestamptz,
    source_tag text NOT NULL,
    candidate_name text NOT NULL,
    language_code text NOT NULL,
    script_code text,
    expected_existing_name text
) ON COMMIT DROP;

INSERT INTO temp_source_fresh_safe_names VALUES
{',\n'.join(values)};

DO $$
BEGIN
    IF (SELECT count(*) FROM temp_source_fresh_safe_names WHERE action = 'safe_insert') <> {len(inserts)}
       OR (SELECT count(*) FROM temp_source_fresh_safe_names WHERE action = 'safe_update_source_derived') <> {len(updates)} THEN
        RAISE EXCEPTION 'generated safe-action payload is incomplete';
    END IF;
END
$$;

CREATE TEMP TABLE temp_source_fresh_updated ON COMMIT DROP AS
WITH updated AS (
    UPDATE core.core_street_names AS existing
    SET
        name = candidate.candidate_name,
        script_code = candidate.script_code,
        source_refs = existing.source_refs || jsonb_build_object(
            'source', 'osm',
            'source_field', 'osm.pbf.tags',
            'source_tag', candidate.source_tag,
            'source_snapshot_version', '{SNAPSHOT_VERSION}',
            'source_snapshot_sha256', '{source['pbf_sha256']}',
            'osm_way_id', candidate.osm_way_id,
            'osm_version', candidate.osm_version,
            'osm_timestamp', candidate.osm_timestamp,
            'previous_name', existing.name,
            'migration', '{MIGRATION_KEY}'
        )
    FROM temp_source_fresh_safe_names AS candidate
    JOIN core.core_streets AS street
      ON street.external_id = candidate.external_id
     AND street.external_id = 'osm:W:' || candidate.osm_way_id::text
     AND street.is_active IS TRUE
     AND street.deleted_at IS NULL
    WHERE candidate.action = 'safe_update_source_derived'
      AND existing.street_id = street.id
      AND coalesce(nullif(lower(btrim(existing.language_code)), ''), 'und') = candidate.language_code
      AND existing.is_primary IS TRUE
      AND lower(btrim(existing.name_type)) IN ('official', 'primary')
      AND existing.name = candidate.expected_existing_name
      AND lower(coalesce(existing.source_refs ->> 'source', '')) = 'osm'
      AND existing.source_refs ->> 'source_tag' = candidate.source_tag
      AND lower(coalesce(existing.source_refs ->> 'source_field', ''))
            IN ('normalized_data.tags', 'osm.pbf.tags')
      AND street.manual_override IS NOT TRUE
      AND street.is_verified IS NOT TRUE
      AND lower(coalesce(street.source_refs ->> 'source', '')) NOT IN ('dashboard', 'manual')
      AND lower(coalesce(street.source_refs ->> 'origin', '')) NOT IN ('dashboard', 'manual')
      AND NOT EXISTS (
          SELECT 1
          FROM core.core_street_names AS other
          WHERE other.street_id = existing.street_id
            AND other.id <> existing.id
            AND coalesce(nullif(lower(btrim(other.language_code)), ''), 'und') = candidate.language_code
            AND other.is_primary IS TRUE
            AND lower(btrim(other.name_type)) IN ('official', 'primary')
            AND nullif(btrim(other.name), '') IS NOT NULL
            AND btrim(other.name) !~* '^(road|street)[_-][0-9]+$'
            AND btrim(other.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
            AND btrim(other.name) !~* '^osm([_:/-]|$)'
            AND btrim(other.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
      )
    RETURNING existing.id
)
SELECT id FROM updated;

DO $$
BEGIN
    IF (SELECT count(*) FROM temp_source_fresh_updated) <> {len(updates)} THEN
        RAISE EXCEPTION 'database drift: expected {len(updates)} safe OSM-managed updates, got %',
            (SELECT count(*) FROM temp_source_fresh_updated);
    END IF;
END
$$;

CREATE TEMP TABLE temp_source_fresh_inserted ON COMMIT DROP AS
WITH inserted AS (
    INSERT INTO core.core_street_names (
        street_id, name, language_code, script_code,
        name_type, is_primary, source_refs
    )
    SELECT
        street.id,
        candidate.candidate_name,
        candidate.language_code,
        candidate.script_code,
        'primary',
        true,
        jsonb_build_object(
            'source', 'osm',
            'source_field', 'osm.pbf.tags',
            'source_tag', candidate.source_tag,
            'source_snapshot_version', '{SNAPSHOT_VERSION}',
            'source_snapshot_sha256', '{source['pbf_sha256']}',
            'osm_way_id', candidate.osm_way_id,
            'osm_version', candidate.osm_version,
            'osm_timestamp', candidate.osm_timestamp,
            'migration', '{MIGRATION_KEY}'
        )
    FROM temp_source_fresh_safe_names AS candidate
    JOIN core.core_streets AS street
      ON street.external_id = candidate.external_id
     AND street.external_id = 'osm:W:' || candidate.osm_way_id::text
     AND street.is_active IS TRUE
     AND street.deleted_at IS NULL
    WHERE candidate.action = 'safe_insert'
      AND street.manual_override IS NOT TRUE
      AND street.is_verified IS NOT TRUE
      AND lower(coalesce(street.source_refs ->> 'source', '')) NOT IN ('dashboard', 'manual')
      AND lower(coalesce(street.source_refs ->> 'origin', '')) NOT IN ('dashboard', 'manual')
      AND NOT EXISTS (
          SELECT 1
          FROM core.core_street_names AS existing
          WHERE existing.street_id = street.id
            AND coalesce(nullif(lower(btrim(existing.language_code)), ''), 'und') = candidate.language_code
            AND existing.is_primary IS TRUE
            AND lower(btrim(existing.name_type)) IN ('official', 'primary')
            AND nullif(btrim(existing.name), '') IS NOT NULL
            AND btrim(existing.name) !~* '^(road|street)[_-][0-9]+$'
            AND btrim(existing.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
            AND btrim(existing.name) !~* '^osm([_:/-]|$)'
            AND btrim(existing.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
      )
    RETURNING id
)
SELECT id FROM inserted;

DO $$
BEGIN
    IF (SELECT count(*) FROM temp_source_fresh_inserted) <> {len(inserts)} THEN
        RAISE EXCEPTION 'database drift: expected {len(inserts)} safe inserts, got %',
            (SELECT count(*) FROM temp_source_fresh_inserted);
    END IF;
END
$$;
"""
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(sql, encoding="utf-8")


if __name__ == "__main__":
    main()
