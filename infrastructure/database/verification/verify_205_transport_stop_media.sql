-- 205 transport.stop_media
-- Expect: table present; no place_media; anon cannot SELECT stop_media.

SELECT
    to_regclass('transport.stop_media') IS NOT NULL AS has_stop_media,
    to_regclass('public.place_media') IS NULL AS no_place_media;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'transport'
  AND table_name = 'stop_media'
ORDER BY ordinal_position;

-- Expect zero rows.
SELECT has_table_privilege('anon', 'transport.stop_media', 'SELECT') AS anon_can_select
WHERE has_table_privilege('anon', 'transport.stop_media', 'SELECT');

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'transport'
  AND tablename = 'stop_media'
ORDER BY indexname;
