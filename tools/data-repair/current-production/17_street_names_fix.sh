#!/usr/bin/env bash
# Prompt 9 — batch-flag streets with generated_label as name_is_generated
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
set -a
# shellcheck disable=SC1091
source .env
set +a

export PAGER=cat
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/data-repair/current-production/17_street_names_fix.sql

BOUNDS=$(psql "$DATABASE_URL" -At -c "SELECT min(id)::text || ' ' || max(id)::text FROM core.core_streets WHERE deleted_at IS NULL;")
MIN_ID=${BOUNDS%% *}
MAX_ID=${BOUNDS##* }
echo "street id bounds: min=$MIN_ID max=$MAX_ID"

BATCH=25000
cur=$MIN_ID
grand=0
while (( cur <= MAX_ID )); do
  nxt=$((cur + BATCH))
  updated=$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 \
    -c "SET statement_timeout = '10min'" \
    -c "
WITH u AS (
  UPDATE core.core_streets s
  SET normalized_data = coalesce(s.normalized_data, '{}'::jsonb)
    || jsonb_build_object('name_is_generated', true),
      updated_at = now()
  WHERE s.id >= $cur AND s.id < $nxt
    AND s.deleted_at IS NULL
    AND nullif(btrim(s.normalized_data->>'generated_label'), '') IS NOT NULL
    AND coalesce((s.normalized_data->>'name_is_generated')::boolean, false) IS NOT TRUE
    AND NOT COALESCE(s.manual_override, false)
  RETURNING s.id
)
SELECT count(*)::text FROM u;
" | tail -n 1)
  grand=$((grand + updated))
  echo "batch id [$cur .. $nxt) updated=$updated grand=$grand"
  cur=$nxt
done

psql "$DATABASE_URL" -c "
SELECT 'streets_flagged_name_is_generated' AS metric, count(*)::text AS value
FROM core.core_streets
WHERE deleted_at IS NULL AND coalesce((normalized_data->>'name_is_generated')::boolean, false)
UNION ALL
SELECT 'remaining_unflagged_generated_label', count(*)::text
FROM core.core_streets
WHERE deleted_at IS NULL
  AND nullif(btrim(normalized_data->>'generated_label'), '') IS NOT NULL
  AND coalesce((normalized_data->>'name_is_generated')::boolean, false) IS NOT TRUE
  AND NOT COALESCE(manual_override, false);
"
