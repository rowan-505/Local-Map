#!/usr/bin/env bash
# Local Supabase production mirror environment template.
# Copy to 00_env.sh or imports/<name>.env and fill with real values.
# Never commit files containing real credentials.

# Local PostgreSQL/PostGIS database that will store prod_mirror copies.
export LOCAL_DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres"

# Supabase production database connection details.
# Prefer a read-only database user if available.
export SUPABASE_DB_HOST="db.<project-ref>.supabase.co"
export SUPABASE_DB_PORT="5432"
export SUPABASE_DB_NAME="postgres"
export SUPABASE_DB_USER="postgres"
export SUPABASE_DB_PASSWORD=""
export SUPABASE_DB_SSLMODE="require"

# Optional. Defaults to logs/data-pipeline relative to repo root when empty.
export LOG_DIR="logs/data-pipeline"
