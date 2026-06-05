-- Commit or rollback the current psql transaction based on -v dry_run (default true).
-- Must be used at script end outside PL/pgSQL DO blocks (ROLLBACK/COMMIT invalid inside DO).

\if :dry_run
\echo 'dry_run=true — rolling back (no changes committed)'
ROLLBACK;
\else
\echo 'dry_run=false — committing'
COMMIT;
\endif
