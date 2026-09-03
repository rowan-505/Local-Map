-- Read-only checks for migration 199 search eligibility + named land.

\pset pager off

SELECT
    search.transport_search_review_status_searchable('imported_unreviewed') AS imported_ok,
    search.transport_search_review_status_searchable('needs_review') AS needs_review_ok,
    search.transport_search_review_status_searchable('rejected') AS rejected_hidden,
    search.folded_route_code_text('YBS-37') AS folded_ybs_37;

SELECT
    to_regclass('search.v_search_land_area_source') IS NOT NULL AS land_area_view,
    to_regclass('search.v_search_bus_routes_source_base') IS NOT NULL AS routes_base_view,
    pg_get_viewdef('search.v_search_land_area_source'::regclass, true)
        ILIKE '%core_land_area_names%' AS land_named_filter,
    pg_get_viewdef('search.v_search_land_area_source'::regclass, true)
        NOT ILIKE '%lu.class_code%' AS land_no_dropped_class_code,
    pg_get_viewdef('search.v_search_land_area_source'::regclass, true)
        ILIKE '%NULLIF(btrim(lu.name)%' AS land_excludes_unnamed;
