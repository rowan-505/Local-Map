-- Read-only verification for migration 174.

SELECT count(*) AS street_count,
       count(*) FILTER (
         WHERE is_oneway IS DISTINCT FROM COALESCE(
           travel_direction IN ('forward', 'reverse'), FALSE
         )
       ) AS legacy_direction_mismatches
FROM core.core_streets;

SELECT verification_status, is_verified, count(*)
FROM core.core_streets
GROUP BY verification_status, is_verified
ORDER BY verification_status, is_verified;

SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_catalog.pg_trigger AS t
JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'core'
  AND NOT t.tgisinternal
  AND t.tgname IN (
    'trg_sync_is_verified_from_verification_status',
    'trg_sync_street_is_oneway_from_travel_direction'
  )
ORDER BY c.relname, t.tgname;

SELECT pg_get_viewdef('tiles.tiles_streets_v'::regclass, true) AS street_tile_view;
