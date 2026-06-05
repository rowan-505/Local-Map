-- Defaults for :'dry_run' and :'force_recalculate_verified' when not set by
-- run_admin_hierarchy_repair.sh (which passes -v dry_run=... -v force_recalculate_verified=...).
-- Safe for ad-hoc: psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_repair_admin_area_hierarchy.sql
\if :{?dry_run}
\else
\set dry_run false
\endif
\if :{?force_recalculate_verified}
\else
\set force_recalculate_verified false
\endif
\if :{?confirm_write}
\else
\set confirm_write false
\endif
\if :{?force_manual_override}
\else
\set force_manual_override false
\endif
\if :{?limit_rows}
\else
\set limit_rows 1000
\endif
\if :{?write_admin_repair_metadata}
\else
\set write_admin_repair_metadata false
\endif
\if :{?last_id}
\else
\set last_id 0
\endif

\pset pager off
