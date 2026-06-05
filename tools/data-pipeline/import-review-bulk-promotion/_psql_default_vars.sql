-- Default optional psql variables when not passed via -v on the command line.
-- Unset variables are NOT substituted in :'name' SQL fragments and cause syntax errors.

\if :{?limit_rows}
\else
\set limit_rows ''
\endif

\if :{?dry_run}
\else
\set dry_run 'true'
\endif

\if :{?show_progress_counts}
\else
\set show_progress_counts 'false'
\endif

\if :{?enable_expensive_fallback}
\else
\set enable_expensive_fallback 'false'
\endif

\if :{?enable_expensive_verify}
\else
\set enable_expensive_verify 'false'
\endif

\if :{?fail_on_warning}
\else
\set fail_on_warning 'false'
\endif

\if :{?confirm_delete}
\else
\set confirm_delete ''
\endif

\pset pager off
