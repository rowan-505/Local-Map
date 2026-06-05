-- =============================================================================
-- Supabase migration 093: drop unused overview core admin0 tile view
-- =============================================================================
--
-- Overview PMTiles use Natural Earth mmr_country_highlight for the Myanmar outer
-- boundary (clip-natural-earth-overview.sh). Drop legacy core-export tile view.
--
-- =============================================================================

begin;

drop view if exists tiles.tiles_overview_mmr_admin0_outline_v;

commit;
