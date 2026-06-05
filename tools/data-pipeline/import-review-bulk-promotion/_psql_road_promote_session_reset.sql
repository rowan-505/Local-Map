-- Drop working-set temp tables before rebuilding bulk_road_base (same transaction; keep params/context/summary).

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
    bulk_road_base;
