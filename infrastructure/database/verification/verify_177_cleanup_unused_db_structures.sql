-- Phase 8 / migration 177 verification. Read-only.

SELECT
  to_regclass('search.search_names') IS NULL AS search_names_removed,
  to_regclass('search.search_addresses') IS NULL AS search_addresses_removed,
  to_regclass('transport.route_unification_plan') IS NULL AS route_unification_plan_removed,
  to_regclass('search.search_documents') IS NOT NULL AS search_documents_retained,
  to_regclass('search.search_document_names') IS NOT NULL AS search_document_names_retained,
  to_regclass('search.address_index') IS NOT NULL AS address_index_retained;

SELECT
  (SELECT count(*) FROM core.core_addresses) AS core_addresses,
  (SELECT count(*) FROM search.address_index) AS address_index_rows,
  (SELECT count(*) FROM import_review.address_candidates) AS address_candidates,
  (SELECT count(*) FROM import_review.admin_area_candidates) AS admin_area_candidates,
  (SELECT count(*) FROM import_review.building_candidates) AS building_candidates,
  (SELECT count(*) FROM import_review.land_area_candidates) AS land_area_candidates,
  (SELECT count(*) FROM import_review.place_candidates) AS place_candidates,
  (SELECT count(*) FROM import_review.protected_area_candidates) AS protected_area_candidates,
  (SELECT count(*) FROM import_review.road_candidates) AS road_candidates,
  (SELECT count(*) FROM import_review.routing_barrier_candidates) AS routing_barrier_candidates,
  (SELECT count(*) FROM import_review.routing_turn_restriction_candidates) AS routing_turn_restriction_candidates,
  (SELECT count(*) FROM import_review.water_line_candidates) AS water_line_candidates,
  (SELECT count(*) FROM import_review.water_polygon_candidates) AS water_polygon_candidates;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('admin_qa', 'transit_export')
ORDER BY table_schema, table_name;
