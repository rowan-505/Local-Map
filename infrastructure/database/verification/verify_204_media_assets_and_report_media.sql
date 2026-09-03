-- 204 media.assets + feedback.report_media
-- Expect: tables present with required columns; no generic entity link table;
-- anon/authenticated have no USAGE on media.

SELECT
    to_regclass('media.assets') IS NOT NULL AS has_media_assets,
    to_regclass('feedback.report_media') IS NOT NULL AS has_report_media,
    to_regclass('public.entity_media') IS NULL AS no_generic_entity_media,
    to_regclass('transport.stop_media') IS NULL AS no_stop_media;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'media'
  AND table_name = 'assets'
ORDER BY ordinal_position;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'feedback'
  AND table_name = 'report_media'
ORDER BY ordinal_position;

-- Expect zero rows.
SELECT r.role_name, privilege
FROM (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN LATERAL (
  VALUES
    ('USAGE', has_schema_privilege(r.role_name, 'media', 'USAGE')),
    ('CREATE', has_schema_privilege(r.role_name, 'media', 'CREATE'))
) p(privilege, allowed)
WHERE p.allowed
ORDER BY r.role_name, privilege;
