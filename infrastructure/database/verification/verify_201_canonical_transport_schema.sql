-- Canonical schema exists; historical name should not be the live SoT.
SELECT
    to_regnamespace('transport') IS NOT NULL AS has_transport,
    to_regnamespace('core_transport') IS NOT NULL AS has_core_transport,
    obj_description(to_regnamespace('transport'), 'pg_namespace') AS transport_comment;
