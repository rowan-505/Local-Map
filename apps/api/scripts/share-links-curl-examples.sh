#!/usr/bin/env bash
# Manual end-to-end examples for CoreMap share links (no auth required).
#
# Usage:
#   export API=http://localhost:3001
#   # Optional: a real public place uuid to exercise the place-share case.
#   export PLACE_PUBLIC_ID='<uuid>'
#   bash scripts/share-links-curl-examples.sh
#
# Requires: curl, jq.
set -euo pipefail

API="${API:-http://localhost:3001}"

POINT_BODY='{
  "target_type": "point",
  "lat": 16.639454,
  "lng": 96.322949,
  "zoom": 17,
  "address_line": "Kyauktan Township, Yangon Region, Myanmar",
  "plus_code": "7M8RJ8QF+Q5"
}'

echo "=== 1) Create point share (expect 201, code + url containing /s/) ==="
CREATE_POINT="$(curl -sS -X POST "$API/share/links" \
  -H 'Content-Type: application/json' -d "$POINT_BODY")"
echo "$CREATE_POINT" | jq .
CODE="$(echo "$CREATE_POINT" | jq -r '.code')"
URL="$(echo "$CREATE_POINT" | jq -r '.url')"
[[ "$URL" == *"/s/"* ]] && echo "OK: url contains /s/" || { echo "FAIL: url missing /s/"; exit 1; }

echo ""
echo "=== 2) Resolve point share (expect target_type=point + lat/lng/zoom/address_line/plus_code) ==="
curl -sS "$API/share/links/$CODE" | jq .

echo ""
echo "=== 3) Create the same point again (expect the SAME code via dedup) ==="
CREATE_POINT_2="$(curl -sS -X POST "$API/share/links" \
  -H 'Content-Type: application/json' -d "$POINT_BODY")"
CODE_2="$(echo "$CREATE_POINT_2" | jq -r '.code')"
echo "first=$CODE second=$CODE_2"
[[ "$CODE" == "$CODE_2" ]] && echo "OK: dedup reused the same code" || echo "WARN: codes differ (dedup not applied)"

echo ""
if [[ -n "${PLACE_PUBLIC_ID:-}" ]]; then
  echo "=== 4) Create place share (expect 201, code + url) ==="
  curl -sS -X POST "$API/share/links" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"target_type":"place","place_public_id":"%s"}' "$PLACE_PUBLIC_ID")" | jq .
else
  echo "=== 4) Skipped place share — set PLACE_PUBLIC_ID to a valid public place uuid ==="
fi

echo ""
echo "=== 5) Invalid lat/lng (expect HTTP 400 validation error) ==="
curl -sS -o /tmp/share-invalid.json -w "HTTP %{http_code}\n" \
  -X POST "$API/share/links" \
  -H 'Content-Type: application/json' \
  -d '{"target_type":"point","lat":200,"lng":96.322949}'
cat /tmp/share-invalid.json | jq . || true
