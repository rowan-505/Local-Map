-- =============================================================================
-- 110_user_system_mvp.sql
-- -----------------------------------------------------------------------------
-- Reproducible migration for the CoreMap MVP user system.
--
-- IMPORTANT: This schema is ALREADY APPLIED to the live Supabase project. This
-- file exists so a fresh environment (new branch / new project) can be rebuilt
-- deterministically. It is written to be idempotent (safe to re-run) and is NOT
-- meant to be applied to the live DB, where every object already exists.
--
-- Pre-existing (V1) objects assumed present: schema `app_auth` with tables
-- auth_users / auth_roles / auth_user_roles, and schema `core` with
-- core_admin_areas. This migration is ADDITIVE to auth_users and CREATES the new
-- user-system tables. It never drops or rewrites existing columns/data.
--
-- Source-of-truth rules (do not violate in application code):
--   * contrib.point_ledger is APPEND-ONLY. Never UPDATE/DELETE a ledger row to
--     correct a mistake — insert a compensating "reversal" row instead.
--   * contrib.user_point_summary is a FAST CACHE derived from point_ledger. It is
--     not authoritative; it can be rebuilt by summing the ledger per user.
--   * app_auth.email_verification_otps stores ONLY a hash of the OTP (otp_hash).
--     The raw 6-digit code must NEVER be persisted or logged.
--   * Scores/points use whole integers; account state is governed by CHECK
--     constraints below.
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Schemas (no-ops if they already exist).
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_auth;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS contrib;
CREATE SCHEMA IF NOT EXISTS system;

-- ----------------------------------------------------------------------------
-- 1. Additive columns on app_auth.auth_users (V1 table, additive only).
-- ----------------------------------------------------------------------------
ALTER TABLE app_auth.auth_users
    ADD COLUMN IF NOT EXISTS phone              text,
    ADD COLUMN IF NOT EXISTS email_verified     boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS account_status     text        NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS primary_region_id  bigint,
    ADD COLUMN IF NOT EXISTS preferred_language text        NOT NULL DEFAULT 'my',
    ADD COLUMN IF NOT EXISTS last_seen_at       timestamptz,
    ADD COLUMN IF NOT EXISTS deleted_at         timestamptz,
    ADD COLUMN IF NOT EXISTS admin_note         text;

-- ----------------------------------------------------------------------------
-- 2. Constraints on the new auth_users columns.
--    Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so guard via pg_constraint.
-- ----------------------------------------------------------------------------

-- account_status ∈ {active, disabled, deleted}
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_account_status_chk') THEN
        ALTER TABLE app_auth.auth_users
            ADD CONSTRAINT auth_users_account_status_chk
            CHECK (account_status = ANY (ARRAY['active'::text, 'disabled'::text, 'deleted'::text]));
    END IF;
END $$;

-- preferred_language ∈ {my, en}
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_preferred_language_chk') THEN
        ALTER TABLE app_auth.auth_users
            ADD CONSTRAINT auth_users_preferred_language_chk
            CHECK (preferred_language = ANY (ARRAY['my'::text, 'en'::text]));
    END IF;
END $$;

-- primary_region_id → core.core_admin_areas(id); region deletion nulls the link.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_users_primary_region_id_fkey') THEN
        ALTER TABLE app_auth.auth_users
            ADD CONSTRAINT auth_users_primary_region_id_fkey
            FOREIGN KEY (primary_region_id) REFERENCES core.core_admin_areas(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Seed roles. Public registration only ever grants `user`; admin/super_admin
--    are provisioned out-of-band. ON CONFLICT keeps this safe to re-run.
-- ----------------------------------------------------------------------------
INSERT INTO app_auth.auth_roles (code, name, description, is_system)
VALUES
    ('user',        'User',        'Standard public user account.',        true),
    ('admin',       'Admin',       'Administrative user.',                  true),
    ('super_admin', 'Super Admin', 'Full administrative access.',           true)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. New tables.
-- ----------------------------------------------------------------------------

-- 4.1 app_auth.auth_sessions — refresh-token sessions (rotation + revocation).
--     Only the SHA-256 hash of the refresh token is stored (refresh_token_hash).
CREATE TABLE IF NOT EXISTS app_auth.auth_sessions (
    id                 bigserial   PRIMARY KEY,
    public_id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    user_id            bigint      NOT NULL,
    refresh_token_hash text        NOT NULL,
    user_agent         text,
    ip_address         text,
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_used_at       timestamptz,
    CONSTRAINT auth_sessions_public_id_key UNIQUE (public_id),
    CONSTRAINT auth_sessions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE
);

-- 4.2 app_auth.email_verification_otps — email OTP verification.
--     otp_hash is an HMAC of the code; the raw OTP is NEVER stored or logged.
CREATE TABLE IF NOT EXISTS app_auth.email_verification_otps (
    id             bigserial   PRIMARY KEY,
    user_id        bigint      NOT NULL,
    email          text        NOT NULL,
    otp_hash       text        NOT NULL,
    purpose        text        NOT NULL DEFAULT 'email_verification',
    attempts_count integer     NOT NULL DEFAULT 0,
    max_attempts   integer     NOT NULL DEFAULT 5,
    expires_at     timestamptz NOT NULL,
    consumed_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_verification_otps_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE
);

-- 4.3 app.user_saved_places — user-saved places. MVP supports entity_type='place'
--     referencing core.core_places(id) (validated in the API; see entity_type chk).
CREATE TABLE IF NOT EXISTS app.user_saved_places (
    id            bigserial   PRIMARY KEY,
    user_id       bigint      NOT NULL,
    entity_type   text        NOT NULL,
    entity_id     bigint      NOT NULL,
    custom_name   text,
    note          text,
    admin_area_id bigint,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_saved_places_entity_type_chk CHECK (entity_type = 'place'::text),
    CONSTRAINT user_saved_places_unique_entity UNIQUE (user_id, entity_type, entity_id),
    CONSTRAINT user_saved_places_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE,
    CONSTRAINT user_saved_places_admin_area_id_fkey
        FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas(id) ON DELETE SET NULL
);

-- 4.4 contrib.point_ledger — APPEND-ONLY source of truth for point changes.
--     Never UPDATE/DELETE rows for corrections; insert a reversal row instead.
CREATE TABLE IF NOT EXISTS contrib.point_ledger (
    id                  bigserial   PRIMARY KEY,
    user_id             bigint      NOT NULL,
    points_delta        integer     NOT NULL,
    reason_code         text        NOT NULL,
    related_entity_type text,
    related_entity_id   bigint,
    note                text,
    created_by          bigint,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT point_ledger_reason_code_chk
        CHECK (reason_code = ANY (ARRAY['admin_adjustment'::text, 'valid_contribution'::text, 'reversal'::text, 'spam_penalty'::text])),
    CONSTRAINT point_ledger_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE,
    CONSTRAINT point_ledger_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL
);

-- 4.5 contrib.user_point_summary — FAST CACHE of per-user totals (derived from
--     point_ledger). Rebuildable; not authoritative.
CREATE TABLE IF NOT EXISTS contrib.user_point_summary (
    user_id                 bigint      PRIMARY KEY,
    total_points            integer     NOT NULL DEFAULT 0,
    lifetime_points_earned  integer     NOT NULL DEFAULT 0,
    lifetime_points_removed integer     NOT NULL DEFAULT 0,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_point_summary_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_auth.auth_users(id) ON DELETE CASCADE
);

-- 4.6 system.audit_logs — audit trail for sensitive/admin actions. Actor is
--     nulled (not deleted) if the acting user is ever removed, to preserve history.
CREATE TABLE IF NOT EXISTS system.audit_logs (
    id              bigserial   PRIMARY KEY,
    actor_user_id   bigint,
    action_type     text        NOT NULL,
    entity_type     text        NOT NULL,
    entity_id       bigint,
    before_snapshot jsonb,
    after_snapshot  jsonb,
    ip_address      text,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_logs_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- 5. Indexes (lookup + partial "active" indexes). UNIQUE constraints above
--    already provide their backing indexes.
-- ----------------------------------------------------------------------------

-- auth_sessions
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
    ON app_auth.auth_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_refresh_hash_idx
    ON app_auth.auth_sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_active_idx
    ON app_auth.auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

-- email_verification_otps
CREATE INDEX IF NOT EXISTS email_verification_otps_user_idx
    ON app_auth.email_verification_otps (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_verification_otps_active_idx
    ON app_auth.email_verification_otps (user_id, email, purpose, expires_at) WHERE consumed_at IS NULL;

-- user_saved_places
CREATE INDEX IF NOT EXISTS user_saved_places_user_idx
    ON app.user_saved_places (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_saved_places_entity_idx
    ON app.user_saved_places (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS user_saved_places_region_idx
    ON app.user_saved_places (admin_area_id);

-- point_ledger
CREATE INDEX IF NOT EXISTS point_ledger_user_idx
    ON contrib.point_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS point_ledger_reason_idx
    ON contrib.point_ledger (reason_code, created_at DESC);
CREATE INDEX IF NOT EXISTS point_ledger_created_by_idx
    ON contrib.point_ledger (created_by, created_at DESC);

-- audit_logs
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
    ON system.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx
    ON system.audit_logs (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
    ON system.audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;

-- =============================================================================
-- End 110_user_system_mvp.sql
-- =============================================================================
