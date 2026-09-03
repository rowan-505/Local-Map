-- =============================================================================
-- Supabase migration 204: generic private media foundation
-- =============================================================================
--
-- media.assets is the single asset table for image/audio objects in R2.
-- feedback.report_media links a ready asset to a user report.
--
-- Does NOT create:
--   generic entity_type/entity_id media links
--   transport.stop_media
--   EXIF JSON, AI metadata, embeddings
--   duplicated GPS/route columns
--
-- Does NOT add orphan-cleanup workers. Keep status='pending' for abandoned
-- uploads so they can be identified later.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS media;

CREATE TABLE IF NOT EXISTS media.assets (
    id               bigserial    PRIMARY KEY,
    public_id        uuid         NOT NULL DEFAULT gen_random_uuid(),
    media_type       text         NOT NULL,
    storage_scope    text         NOT NULL,
    object_key       text         NOT NULL,
    mime_type        text         NOT NULL,
    byte_size        bigint       NOT NULL,
    width            integer,
    height           integer,
    duration_ms      integer,
    source_asset_id  bigint,
    status           text         NOT NULL,
    created_by       bigint       NOT NULL,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    ready_at         timestamptz,

    CONSTRAINT media_assets_public_id_key UNIQUE (public_id),
    CONSTRAINT media_assets_object_key_key UNIQUE (object_key),
    CONSTRAINT media_assets_media_type_chk
        CHECK (media_type = ANY (ARRAY['image'::text, 'audio'::text])),
    CONSTRAINT media_assets_storage_scope_chk
        CHECK (storage_scope = ANY (ARRAY['private'::text, 'public'::text])),
    CONSTRAINT media_assets_status_chk
        CHECK (status = ANY (ARRAY['pending'::text, 'ready'::text])),
    CONSTRAINT media_assets_byte_size_chk
        CHECK (byte_size > 0),
    CONSTRAINT media_assets_width_chk
        CHECK (width IS NULL OR width > 0),
    CONSTRAINT media_assets_height_chk
        CHECK (height IS NULL OR height > 0),
    CONSTRAINT media_assets_duration_ms_chk
        CHECK (duration_ms IS NULL OR duration_ms > 0),
    CONSTRAINT media_assets_ready_at_chk
        CHECK ((status = 'pending' AND ready_at IS NULL) OR (status = 'ready' AND ready_at IS NOT NULL)),
    CONSTRAINT media_assets_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES app_auth.auth_users (id) ON DELETE RESTRICT,
    CONSTRAINT media_assets_source_asset_id_fkey
        FOREIGN KEY (source_asset_id) REFERENCES media.assets (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS media_assets_created_by_idx
    ON media.assets (created_by);

CREATE INDEX IF NOT EXISTS media_assets_pending_created_at_idx
    ON media.assets (created_at)
    WHERE status = 'pending';

COMMENT ON SCHEMA media IS
    'Private media catalog. Object bytes live in R2; this table is the source of truth for keys and status.';
COMMENT ON TABLE media.assets IS
    'Uploaded media objects. pending = presign issued, object not verified. ready = HEAD verified. Abandoned pending rows are kept for later cleanup.';
COMMENT ON COLUMN media.assets.object_key IS
    'R2 object key inside the bucket implied by storage_scope. Never a public URL.';
COMMENT ON COLUMN media.assets.status IS
    'pending until POST /media/:publicId/complete verifies the object. No automated orphan worker in this migration.';
COMMENT ON COLUMN media.assets.source_asset_id IS
    'Optional parent asset for later derivatives. Unused in the private JPEG upload path.';

CREATE TABLE IF NOT EXISTS feedback.report_media (
    id          bigserial    PRIMARY KEY,
    report_id   bigint       NOT NULL,
    asset_id    bigint       NOT NULL,
    note        text,
    sort_order  integer      NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT report_media_report_id_fkey
        FOREIGN KEY (report_id) REFERENCES feedback.user_reports (id) ON DELETE CASCADE,
    CONSTRAINT report_media_asset_id_fkey
        FOREIGN KEY (asset_id) REFERENCES media.assets (id) ON DELETE RESTRICT,
    CONSTRAINT report_media_report_asset_key UNIQUE (report_id, asset_id),
    CONSTRAINT report_media_sort_order_chk
        CHECK (sort_order >= 0),
    CONSTRAINT report_media_note_chk
        CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS report_media_report_id_sort_idx
    ON feedback.report_media (report_id, sort_order, id);

COMMENT ON TABLE feedback.report_media IS
    'Attaches a media.assets row to one feedback.user_reports row. Not a generic entity media table.';

ALTER TABLE media.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback.report_media ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA media FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA media FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA media FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE feedback.report_media FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA media
    REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA media
    REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;

COMMIT;
