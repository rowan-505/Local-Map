-- 203 field-survey contract on feedback.user_reports
-- Expect: public_id unique reused; no extra idempotency column; field columns present.

SELECT
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'user_reports'
          AND column_name = 'source_code'
    ) AS has_source_code,
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'user_reports'
          AND column_name = 'observed_at'
    ) AS has_observed_at,
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'user_reports'
          AND column_name = 'location_accuracy_m'
    ) AS has_location_accuracy_m,
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'user_reports'
          AND column_name = 'report_data'
    ) AS has_report_data,
    EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'feedback'
          AND table_name = 'user_reports'
          AND column_name = 'idempotency_key'
    ) AS has_extra_idempotency_column,
    EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_reports_public_id_key'
          AND conrelid = 'feedback.user_reports'::regclass
    ) AS has_public_id_unique,
    EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'feedback'
          AND c.relname = 'user_reports_field_survey_status_idx'
    ) AS has_field_survey_status_idx,
    EXISTS (
        SELECT 1 FROM ref.ref_report_statuses WHERE code = 'resolved'
    ) AS has_resolved_status,
    EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'feedback' AND c.relname = 'field_survey_reports'
    ) AS has_separate_field_table;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'feedback.user_reports'::regclass
  AND conname IN (
      'user_reports_source_code_chk',
      'user_reports_location_accuracy_m_chk',
      'user_reports_report_data_object_chk',
      'user_reports_field_survey_author_chk',
      'user_reports_field_survey_observed_at_chk',
      'user_reports_field_survey_geom_chk',
      'user_reports_public_id_key'
  )
ORDER BY conname;

SELECT source_code, COUNT(*)::int AS n
FROM feedback.user_reports
GROUP BY source_code
ORDER BY source_code;
