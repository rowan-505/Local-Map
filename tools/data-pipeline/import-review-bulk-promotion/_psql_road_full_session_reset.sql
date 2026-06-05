-- Drop all road-bulk-promote temp tables/functions so psql re-runs in the same session are safe.

DROP FUNCTION IF EXISTS pg_temp.bulk_road_phase_done(text, bigint, bigint, text);

DROP TABLE IF EXISTS
    bulk_road_inserted,
    bulk_road_ready,
    bulk_road_classified,
    bulk_road_admin_assignment,
    bulk_road_admin_fallback_country,
    bulk_road_admin_fallback_overlap,
    bulk_road_admin_fallback_ward,
    bulk_road_admin_fallback_simple,
    bulk_road_admin_fast,
    bulk_road_assignable,
    bulk_existing_street_external_ids,
    bulk_admin_assignment_candidates,
    bulk_road_base,
    bulk_road_chunk_stats,
    bulk_road_promote_timing,
    bulk_road_promote_summary,
    bulk_road_promote_context,
    bulk_road_promote_params,
    bulk_road_context,
    bulk_road_report;
