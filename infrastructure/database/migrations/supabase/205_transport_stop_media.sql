-- =============================================================================
-- Supabase migration 205: public bus-stop photo links
-- =============================================================================
--
-- transport.stop_media links a PUBLIC media.assets row to a transport stop.
-- The private original stays private. Publishing creates a new public asset
-- with source_asset_id pointing at the private original.
--
-- Does NOT create place/POI media tables.
-- Does NOT auto-publish when a field report is resolved.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS transport.stop_media (
    id                     bigserial    PRIMARY KEY,
    stop_id                bigint       NOT NULL,
    asset_id               bigint       NOT NULL,
    source_report_media_id bigint,
    note                   text,
    is_primary             boolean      NOT NULL DEFAULT false,
    is_active              boolean      NOT NULL DEFAULT true,
    published_at           timestamptz  NOT NULL DEFAULT now(),
    created_at             timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT stop_media_stop_id_fkey
        FOREIGN KEY (stop_id) REFERENCES transport.stops (id) ON DELETE CASCADE,
    CONSTRAINT stop_media_asset_id_fkey
        FOREIGN KEY (asset_id) REFERENCES media.assets (id) ON DELETE RESTRICT,
    CONSTRAINT stop_media_source_report_media_id_fkey
        FOREIGN KEY (source_report_media_id) REFERENCES feedback.report_media (id) ON DELETE SET NULL,
    CONSTRAINT stop_media_note_chk
        CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS stop_media_active_source_report_media_uidx
    ON transport.stop_media (source_report_media_id)
    WHERE source_report_media_id IS NOT NULL AND is_active;

CREATE UNIQUE INDEX IF NOT EXISTS stop_media_one_primary_per_stop_uidx
    ON transport.stop_media (stop_id)
    WHERE is_primary AND is_active;

CREATE INDEX IF NOT EXISTS stop_media_stop_id_active_idx
    ON transport.stop_media (stop_id, published_at DESC)
    WHERE is_active;

COMMENT ON TABLE transport.stop_media IS
    'Published public stop photos. asset_id must be a public media.assets row. Private originals are never flipped to public.';
COMMENT ON COLUMN transport.stop_media.source_report_media_id IS
    'Optional field-report evidence row this publish came from. Unique while active so the same evidence is not published twice.';
COMMENT ON COLUMN transport.stop_media.asset_id IS
    'Public detail-size JPEG asset. Card-size sibling uses the same source_asset_id on media.assets.';

ALTER TABLE transport.stop_media ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE transport.stop_media FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE transport.stop_media_id_seq FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
