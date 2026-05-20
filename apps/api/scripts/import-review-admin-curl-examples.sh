#!/usr/bin/env bash
# Examples for Import Review auth (IMPORT_REVIEW_ADMIN_TOKEN tier vs JWT tier).
#
# Symmetric-token tier requires header on every request:
#   x-import-review-admin-token: <IMPORT_REVIEW_ADMIN_TOKEN>
#
# Usage:
#   export API=http://localhost:3001
#   export SNAP=your_source_snapshot_version
#   export IMPORT_REVIEW_ADMIN_TOKEN='<must match apps/api .env>'
#
# JWT tier (recommended when IMPORT_REVIEW_ADMIN_TOKEN is empty on API):
#   export TOKEN="$(curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}' | jq -r '.accessToken')"
#
set -euo pipefail

API="${API:-http://localhost:3001}"
SNAP="${SNAP:?set SNAP to source_snapshot_version}"
HDR="x-import-review-admin-token"
PATCH_BODY="$(printf '{"source_snapshot_version":"%s","review_decision":"approved","review_note":"curl-example"}' "$SNAP")"

echo "=== Expect 401 (no symmetric header when IMPORT_REVIEW_ADMIN_TOKEN configured on API) ==="
curl -sS -o /tmp/ir-noauth.json -w "HTTP %{http_code}\n" \
  "$API/api/import-review/summary?source_snapshot_version=$SNAP"

if [[ -n "${IMPORT_REVIEW_ADMIN_TOKEN:-}" ]]; then
  echo ""
  echo "=== Expect 403 (wrong symmetric token) ==="
  curl -sS -o /tmp/ir-forbidden.json -w "HTTP %{http_code}\n" \
    "$API/api/import-review/summary?source_snapshot_version=$SNAP" -H "${HDR}: wrong-secret-placeholder"

  echo ""
  echo "=== Expect 200 (correct symmetric header) ==="
  curl -sS -o /tmp/ir-ok.json -w "HTTP %{http_code}\n" \
    "$API/api/import-review/summary?source_snapshot_version=$SNAP" -H "${HDR}: ${IMPORT_REVIEW_ADMIN_TOKEN}"

  echo ""
  echo "=== PATCH buildings decision — expect 200 or 404/400 from business validation (still authed) ==="
  curl -sS -o /tmp/ir-patch.json -w "HTTP %{http_code}\n" \
    -X PATCH "$API/api/import-review/buildings/1/decision" \
    -H "Content-Type: application/json" -H "${HDR}: ${IMPORT_REVIEW_ADMIN_TOKEN}" \
    --data-binary "$PATCH_BODY"
else
  echo ""
  echo "Skip symmetric-tier demos: EXPORT IMPORT_REVIEW_ADMIN_TOKEN mirroring apps/api (.env)."
fi

echo ""
echo "=== With Bearer JWT only (IMPORT_REVIEW_ADMIN_TOKEN empty on API) ==="
if [[ -n "${TOKEN:-}" ]] && [[ -z "${IMPORT_REVIEW_ADMIN_TOKEN:-}" ]]; then
  curl -sS -w "HTTP %{http_code}\n" "$API/api/import-review/summary?source_snapshot_version=$SNAP" \
    -H "Authorization: Bearer ${TOKEN}"
else
  echo "Skip JWT demo: TOKEN set + IMPORT_REVIEW_ADMIN_TOKEN unset on BOTH client env and API env."
fi

if [[ -n "${IMPORT_REVIEW_ADMIN_TOKEN:-}" ]]; then
  AUTH=(-H "${HDR}: ${IMPORT_REVIEW_ADMIN_TOKEN}")

  echo ""
  echo "=== Batch resolution (multiple non-archived batches for same snapshot) ==="

  echo ""
  echo "--- Expect 409 + batches[] (snapshot only, no latest) ---"
  curl -sS -o /tmp/ir-places-409.json -w "HTTP %{http_code}\n" \
    "$API/api/import-review/places?source_snapshot_version=$SNAP&limit=5" "${AUTH[@]}"
  if command -v jq >/dev/null 2>&1; then
    jq '{message, source_snapshot_version, batch_count: (.batches | length), first_batch: .batches[0].id, selected_by: null}' /tmp/ir-places-409.json 2>/dev/null || cat /tmp/ir-places-409.json
  fi

  echo ""
  echo "--- Expect 200 latest batch (newest uploaded_at) ---"
  curl -sS -o /tmp/ir-places-latest.json -w "HTTP %{http_code}\n" \
    "$API/api/import-review/places?source_snapshot_version=$SNAP&latest=true&limit=5" "${AUTH[@]}"
  if command -v jq >/dev/null 2>&1; then
    jq '{review_batch_id, selected_by, batch_name, total: .total}' /tmp/ir-places-latest.json 2>/dev/null || cat /tmp/ir-places-latest.json
  fi

  REVIEW_BATCH_ID="${REVIEW_BATCH_ID:-2}"
  echo ""
  echo "--- Expect 200 explicit review_batch_id=$REVIEW_BATCH_ID ---"
  curl -sS -o /tmp/ir-places-batch.json -w "HTTP %{http_code}\n" \
    "$API/api/import-review/places?review_batch_id=$REVIEW_BATCH_ID&limit=5" "${AUTH[@]}"
  if command -v jq >/dev/null 2>&1; then
    jq '{review_batch_id, selected_by, batch_name, total: .total}' /tmp/ir-places-batch.json 2>/dev/null || cat /tmp/ir-places-batch.json
  fi

  echo ""
  echo "--- Expect 404 invalid review_batch_id ---"
  curl -sS -o /tmp/ir-places-404.json -w "HTTP %{http_code}\n" \
    "$API/api/import-review/places?review_batch_id=999999&limit=5" "${AUTH[@]}"
  if command -v jq >/dev/null 2>&1; then
    jq '.' /tmp/ir-places-404.json 2>/dev/null || cat /tmp/ir-places-404.json
  fi
fi
