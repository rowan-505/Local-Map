#!/usr/bin/env bash
# Local Supabase production mirror environment template.
# Copy to 00_env.sh and fill with real values. Never commit secrets.

# Local PostgreSQL/PostGIS lab database (mirror target).
export LOCAL_DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"

# Preferred: dedicated READ connection for FDW mirror refresh.
# Never point this at a write-only workflow variable.
export SUPABASE_READ_DATABASE_URL="postgresql://readonly_user:PASSWORD@db.<project-ref>.supabase.co:5432/postgres"

# Write connection is for Stage K / admin apply only — NEVER used by mirror refresh.
# Keep it set so scripts can refuse to mix read and write targets.
export SUPABASE_WRITE_DATABASE_URL="postgresql://postgres:PASSWORD@db.<project-ref>.supabase.co:5432/postgres"

# Do NOT set DATABASE_URL here for pipeline writes.
# API/Martin may use DATABASE_URL elsewhere; pipeline tools refuse it as a silent write target.
# See docs/database-target-safety.md

# Optional explicit project reference (otherwise derived from db.<ref>.supabase.co).
export SUPABASE_PROJECT_REF="<project-ref>"
export DB_TARGET_PRODUCTION_PROJECT_REF="<project-ref>"

# Legacy FDW parts (used only when SUPABASE_READ_DATABASE_URL is unset).
# export SUPABASE_DB_HOST="db.<project-ref>.supabase.co"
# export SUPABASE_DB_PORT="5432"
# export SUPABASE_DB_NAME="postgres"
# export SUPABASE_DB_USER="readonly_user"
# export SUPABASE_DB_PASSWORD=""
export SUPABASE_DB_SSLMODE="require"

# Fail validation / pipeline preflight when mirror older than this many hours.
export MIRROR_MAX_AGE_HOURS="168"

# Optional. Defaults to logs/data-pipeline relative to repo root when empty.
export LOG_DIR="logs/data-pipeline"
