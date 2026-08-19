-- Read-only verification after migrations 190 and 191.

SELECT
    to_regnamespace('admin_qa') IS NULL AS admin_qa_schema_removed,
    to_regclass('search.address_index') IS NOT NULL AS address_index_retained,
    to_regclass('core.core_address_components') IS NOT NULL AS address_components_retained;

SELECT
    count(*) FILTER (WHERE column_name = 'postal_code') = 1 AS postal_code_present,
    count(*) FILTER (WHERE column_name = 'postcode') = 0 AS legacy_postcode_removed,
    count(*) FILTER (WHERE column_name = 'full_address') = 1 AS full_address_retained
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name = 'core_addresses';

SELECT
    count(*)::bigint AS core_address_rows,
    count(*) FILTER (WHERE postal_code IS NOT NULL)::bigint AS populated_postal_codes
FROM core.core_addresses;

SELECT count(*)::bigint AS address_search_source_rows
FROM search.v_search_addresses_source;

SELECT
    d.refobjsubid,
    pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent_object
FROM pg_depend AS d
JOIN pg_class AS c ON c.oid = d.refobjid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'core'
  AND c.relname = 'core_addresses'
  AND d.refobjsubid = (
      SELECT attnum
      FROM pg_attribute
      WHERE attrelid = 'core.core_addresses'::regclass
        AND attname = 'postal_code'
        AND NOT attisdropped
  )
ORDER BY dependent_object;
