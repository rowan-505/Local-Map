-- =============================================================================
-- 113_point_ledger_report_reward_reason_codes.sql
-- -----------------------------------------------------------------------------
-- Expands the contrib.point_ledger reason_code CHECK so report-based manual
-- rewards can record their own reason codes alongside the existing general
-- point-adjustment codes.
--
-- ADDITIVE + idempotent: the new allowed set is a SUPERSET of the previous one,
-- so existing rows (which use only the original 4 codes) still satisfy the
-- constraint. The ledger remains append-only — this only changes which
-- reason_code values are permitted on INSERT.
--
-- Previous allowed set (migration 110):
--   admin_adjustment, valid_contribution, reversal, spam_penalty
-- New allowed set (adds report reward/penalty codes):
--   + valid_report, useful_correction, useful_photo, false_report_penalty
-- =============================================================================

BEGIN;

-- Drop-then-add keeps this safe to re-run (DROP IF EXISTS removes either the old
-- or this migration's constraint; the ADD always re-creates the current set).
ALTER TABLE contrib.point_ledger
    DROP CONSTRAINT IF EXISTS point_ledger_reason_code_chk;

ALTER TABLE contrib.point_ledger
    ADD CONSTRAINT point_ledger_reason_code_chk
    CHECK (reason_code = ANY (ARRAY[
        'admin_adjustment'::text,
        'valid_contribution'::text,
        'reversal'::text,
        'spam_penalty'::text,
        'valid_report'::text,
        'useful_correction'::text,
        'useful_photo'::text,
        'false_report_penalty'::text
    ]));

COMMIT;

-- =============================================================================
-- End 113_point_ledger_report_reward_reason_codes.sql
-- =============================================================================
