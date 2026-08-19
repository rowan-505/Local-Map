-- Remove legacy MVT entry points whose tiles.v_* source views were retired.
-- Active rendering uses PMTiles and the current tiles schema views/functions.
-- RESTRICT is intentional: this migration must fail instead of cascading if a
-- new database dependency appears after the dependency audit.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP FUNCTION tiles.get_admin_areas_tile(integer, integer, integer) RESTRICT;
DROP FUNCTION tiles.get_places_tile(integer, integer, integer) RESTRICT;
DROP FUNCTION tiles.get_streets_tile(integer, integer, integer) RESTRICT;
