-- =============================================================================
-- Supabase migration 203: field-survey anomaly contract on feedback.user_reports
-- =============================================================================
--
-- One real field anomaly = one feedback.user_reports row.
-- Correct observations create no server row (enforced in the field API, not here).
-- Reuses feedback.user_reports / report_status_events / report_followups.
-- Does NOT create a field-survey table.
-- Does NOT add public UUIDs on transport.route_stops or transport.route_paths.
-- Does NOT change canonical transport data.
-- Does NOT change public POST /reports behavior.
--
-- Idempotency: existing UNIQUE (public_id) is the client UUID key.
-- No extra idempotency column.
--
-- Field context (snapshotRevision, route/variant/stop public IDs, D0/D1,
-- stopSequence, canonicalSnapshot) lives in report_data jsonb — not extra columns.
-- Route/path issues key off variant public ID + snapshot revision + geom/context.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '1min';

-- Public reports keep `accepted`. Field close-state is `resolved` (already live;
-- seed for fresh replays). `resolved` does not mean canonical transport changed.
INSERT INTO ref.ref_report_statuses (code, name)
VALUES ('resolved', 'Resolved')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE feedback.user_reports
    ADD COLUMN IF NOT EXISTS source_code text NOT NULL DEFAULT 'public',
    ADD COLUMN IF NOT EXISTS observed_at timestamptz,
    ADD COLUMN IF NOT EXISTS location_accuracy_m real,
    ADD COLUMN IF NOT EXISTS report_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN feedback.user_reports.source_code IS
    'Report origin: public (map/web/app) or field_survey (surveyor anomaly).';
COMMENT ON COLUMN feedback.user_reports.observed_at IS
    'Device capture time for field_survey. Null for historical public reports.';
COMMENT ON COLUMN feedback.user_reports.location_accuracy_m IS
    'Reported device GPS accuracy in metres. Null when unknown.';
COMMENT ON COLUMN feedback.user_reports.report_data IS
    'Bounded JSON object. Field survey stores snapshotRevision, routePublicId, '
    'variantPublicId, variantCode (D0/D1), stopPublicId, stopSequence, '
    'canonicalSnapshot. Not a substitute for geom.';
COMMENT ON COLUMN feedback.user_reports.public_id IS
    'Public UUID. Field survey uses a client-generated UUID as the idempotency key '
    '(UNIQUE). Server default gen_random_uuid() remains for public reports.';
COMMENT ON COLUMN feedback.user_reports.geom IS
    'Observed GPS / report point (EPSG:4326). Required for field_survey.';

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_reports_source_code_chk'
          AND conrelid = 'feedback.user_reports'::regclass
    ) THEN
        ALTER TABLE feedback.user_reports
            ADD CONSTRAINT user_reports_source_code_chk
            CHECK (source_code IN ('public', 'field_survey'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_reports_location_accuracy_m_chk'
          AND conrelid = 'feedback.user_reports'::regclass
    ) THEN
        ALTER TABLE feedback.user_reports
            ADD CONSTRAINT user_reports_location_accuracy_m_chk
            CHECK (location_accuracy_m IS NULL OR location_accuracy_m >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_reports_report_data_object_chk'
          AND conrelid = 'feedback.user_reports'::regclass
    ) THEN
        ALTER TABLE feedback.user_reports
            ADD CONSTRAINT user_reports_report_data_object_chk
            CHECK (jsonb_typeof(report_data) = 'object');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_reports_field_survey_author_chk'
          AND conrelid = 'feedback.user_reports'::regclass
    ) THEN
        ALTER TABLE feedback.user_reports
            ADD CONSTRAINT user_reports_field_survey_author_chk
            CHECK (
                source_code <> 'field_survey'
                OR (is_anonymous = false AND created_by IS NOT NULL)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_reports_field_survey_observed_at_chk'
          AND conrelid = 'feedback.user_reports'::regclass
    ) THEN
        ALTER TABLE feedback.user_reports
            ADD CONSTRAINT user_reports_field_survey_observed_at_chk
            CHECK (source_code <> 'field_survey' OR observed_at IS NOT NULL);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_reports_field_survey_geom_chk'
          AND conrelid = 'feedback.user_reports'::regclass
    ) THEN
        ALTER TABLE feedback.user_reports
            ADD CONSTRAINT user_reports_field_survey_geom_chk
            CHECK (source_code <> 'field_survey' OR geom IS NOT NULL);
    END IF;
END
$constraints$;

-- Concrete field-queue lookup: status + time for surveyor anomalies only.
-- Idempotent retry uses existing UNIQUE user_reports_public_id_key.
CREATE INDEX IF NOT EXISTS user_reports_field_survey_status_idx
    ON feedback.user_reports (status_code, created_at DESC)
    WHERE source_code = 'field_survey';

COMMIT;
