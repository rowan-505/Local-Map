-- =============================================================================
-- 112_feedback_user_reports_mvp.sql
-- -----------------------------------------------------------------------------
-- Minimal report / contribution MVP. Adds the feedback.user_reports lifecycle
-- on top of the EXISTING user/auth/point foundation. This migration is ADDITIVE
-- and idempotent (safe to re-run); it never drops or rewrites existing
-- auth/user/point/audit tables.
--
-- Reused (NOT recreated) objects, assumed already present:
--   * app_auth.auth_users              (report author / reviewer / actor)
--   * ref.ref_report_types             (report category reference)
--   * ref.ref_report_statuses          (report lifecycle status reference)
--   * contrib.point_ledger             (append-only reward source of truth)
--   * core.core_admin_areas            (region link)
--   * system.audit_logs                (admin/destructive action audit trail)
--
-- New objects (schema `feedback`, currently empty):
--   * feedback.user_reports            (one row per report; updated in place)
--   * feedback.report_status_events    (append-only status transition history)
--   * feedback.report_followups        (admin/user/system follow-up messages)
--
-- Source-of-truth / behavior rules (enforced in the API; documented here):
--   * Points are NEVER granted automatically. eligible_for_points only marks a
--     report as point-worthy; an admin grants points via the existing point API,
--     which links the resulting ledger row back via reward_ledger_id.
--   * `needs_more_info` does NOT create a new report. The same report row is
--     reused; admin/user exchange messages via feedback.report_followups. A user
--     reply moves status back to 'submitted' (handled in the API).
--   * Anonymous reports (is_anonymous = true) have no created_by and do NOT
--     support follow-ups in the MVP (enforced in the API).
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Schemas + extensions (no-ops if they already exist).
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ref;
CREATE SCHEMA IF NOT EXISTS feedback;
CREATE SCHEMA IF NOT EXISTS contrib;
CREATE SCHEMA IF NOT EXISTS system;
CREATE SCHEMA IF NOT EXISTS app_auth;
CREATE SCHEMA IF NOT EXISTS core;

CREATE EXTENSION IF NOT EXISTS postgis;

-- ----------------------------------------------------------------------------
-- 1. Reference seed data (idempotent). ref_report_types / ref_report_statuses
--    already exist as tables (id, code, name, created_at); only seed rows are
--    added here. `name` holds the human-facing display label.
-- ----------------------------------------------------------------------------
INSERT INTO ref.ref_report_types (code, name)
VALUES
    ('wrong_info',       'Wrong information'),
    ('wrong_location',   'Wrong location'),
    ('missing_item',     'Missing item'),
    ('closed_or_removed','Closed or removed'),
    ('duplicate_item',   'Duplicate item'),
    ('transport_issue',  'Transport issue'),
    ('community_info',   'Community info'),
    ('other_map_issue',  'Others')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ref.ref_report_statuses (code, name)
VALUES
    ('submitted',       'Submitted'),
    ('in_review',       'In review'),
    ('needs_more_info', 'Needs more info'),
    ('accepted',        'Accepted'),
    ('rejected',        'Rejected'),
    ('duplicate',       'Duplicate')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. feedback.user_reports — one durable row per report (updated in place).
--    Status-code FKs reference ref tables by their natural `code` key.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback.user_reports (
    id                 bigserial               PRIMARY KEY,
    public_id          uuid          NOT NULL  DEFAULT gen_random_uuid(),

    -- Authorship. Anonymous reports have no created_by; signed-in reports do.
    created_by         bigint,
    anonymous_id       text,
    is_anonymous       boolean       NOT NULL  DEFAULT false,
    eligible_for_points boolean      NOT NULL  DEFAULT false,

    -- Classification + lifecycle (reference codes).
    report_type_code   text          NOT NULL,
    status_code        text          NOT NULL  DEFAULT 'submitted',
    reason_code        text,

    -- Target of the report (polymorphic / coordinate-based; validated in API).
    target_entity_type text,
    target_entity_id   bigint,
    target_public_id   uuid,

    -- Content.
    title              text,
    description        text          NOT NULL,

    -- Location.
    geom               geometry(Point, 4326),
    admin_area_id      bigint,

    -- Triage + review.
    priority           text          NOT NULL  DEFAULT 'normal',
    confidence_score   integer       NOT NULL  DEFAULT 0,
    reviewed_by        bigint,
    reviewed_at        timestamptz,
    admin_note         text,

    -- Reward linkage (points are granted out-of-band via the point API).
    reward_ledger_id   bigint,
    reward_granted_at  timestamptz,

    created_at         timestamptz   NOT NULL  DEFAULT now(),
    updated_at         timestamptz   NOT NULL  DEFAULT now(),

    CONSTRAINT user_reports_public_id_key UNIQUE (public_id),

    CONSTRAINT user_reports_priority_chk
        CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])),
    CONSTRAINT user_reports_confidence_score_chk
        CHECK (confidence_score BETWEEN 0 AND 100),
    -- Anonymous reports must not carry an author id.
    CONSTRAINT user_reports_anonymous_author_chk
        CHECK (is_anonymous = false OR created_by IS NULL),
    -- Only authored reports can be flagged eligible for points.
    CONSTRAINT user_reports_points_requires_author_chk
        CHECK (eligible_for_points = false OR created_by IS NOT NULL),

    CONSTRAINT user_reports_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL,
    CONSTRAINT user_reports_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL,
    CONSTRAINT user_reports_report_type_code_fkey
        FOREIGN KEY (report_type_code) REFERENCES ref.ref_report_types(code),
    CONSTRAINT user_reports_status_code_fkey
        FOREIGN KEY (status_code) REFERENCES ref.ref_report_statuses(code),
    CONSTRAINT user_reports_admin_area_id_fkey
        FOREIGN KEY (admin_area_id) REFERENCES core.core_admin_areas(id) ON DELETE SET NULL,
    CONSTRAINT user_reports_reward_ledger_id_fkey
        FOREIGN KEY (reward_ledger_id) REFERENCES contrib.point_ledger(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- 3. feedback.report_status_events — append-only status transition history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback.report_status_events (
    id              bigserial   PRIMARY KEY,
    report_id       bigint      NOT NULL,
    old_status_code text,
    new_status_code text        NOT NULL,
    actor_user_id   bigint,
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT report_status_events_report_id_fkey
        FOREIGN KEY (report_id) REFERENCES feedback.user_reports(id) ON DELETE CASCADE,
    CONSTRAINT report_status_events_new_status_code_fkey
        FOREIGN KEY (new_status_code) REFERENCES ref.ref_report_statuses(code),
    CONSTRAINT report_status_events_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- 4. feedback.report_followups — admin/user/system follow-up messages.
--    Reused for the needs_more_info exchange (no new report row is created).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback.report_followups (
    id            bigserial   PRIMARY KEY,
    report_id     bigint      NOT NULL,
    actor_user_id bigint,
    actor_type    text        NOT NULL,
    message       text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT report_followups_actor_type_chk
        CHECK (actor_type = ANY (ARRAY['admin'::text, 'user'::text, 'system'::text])),
    CONSTRAINT report_followups_report_id_fkey
        FOREIGN KEY (report_id) REFERENCES feedback.user_reports(id) ON DELETE CASCADE,
    CONSTRAINT report_followups_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES app_auth.auth_users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- 5. Indexes (admin queues, user history, spatial, and child-table lookups).
--    UNIQUE constraints above already provide their backing indexes.
-- ----------------------------------------------------------------------------

-- user_reports
CREATE INDEX IF NOT EXISTS user_reports_status_idx
    ON feedback.user_reports (status_code, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reports_type_idx
    ON feedback.user_reports (report_type_code, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reports_admin_area_idx
    ON feedback.user_reports (admin_area_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reports_created_by_idx
    ON feedback.user_reports (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reports_anonymous_idx
    ON feedback.user_reports (anonymous_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reports_target_idx
    ON feedback.user_reports (target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS user_reports_geom_gix
    ON feedback.user_reports USING gist (geom);

-- report_status_events
CREATE INDEX IF NOT EXISTS report_status_events_report_idx
    ON feedback.report_status_events (report_id, created_at DESC);

-- report_followups
CREATE INDEX IF NOT EXISTS report_followups_report_idx
    ON feedback.report_followups (report_id, created_at DESC);

COMMIT;

-- =============================================================================
-- End 112_feedback_user_reports_mvp.sql
-- =============================================================================
