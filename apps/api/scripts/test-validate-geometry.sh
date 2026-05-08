#!/usr/bin/env bash
# Test POST /streets/validate-geometry
# Usage: bash scripts/test-validate-geometry.sh [API_BASE_URL] [TOKEN]
#
# Defaults to http://localhost:3001 (AUTH_BYPASS=true so token is optional).

set -euo pipefail

BASE_URL="${1:-http://localhost:3001}"
TOKEN="${2:-test-token}"

echo "=== 1. Valid LineString (should return isValid: true) ==="
curl -s -X POST "${BASE_URL}/streets/validate-geometry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [96.1700, 16.8000],
        [96.1720, 16.8010],
        [96.1740, 16.8020]
      ]
    },
    "toleranceMeters": 30
  }' | jq .

echo ""
echo "=== 2. Invalid geometry (Point instead of LineString – should return isValid: false) ==="
curl -s -X POST "${BASE_URL}/streets/validate-geometry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "geometry": {
      "type": "Point",
      "coordinates": [96.1700, 16.8000]
    },
    "toleranceMeters": 30
  }' | jq .

echo ""
echo "=== 3. Too-short LineString (< 2 m – should return isValid: false) ==="
curl -s -X POST "${BASE_URL}/streets/validate-geometry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [96.170000, 16.800000],
        [96.170001, 16.800001]
      ]
    },
    "toleranceMeters": 30
  }' | jq .

echo ""
echo "=== 4. Valid LineString with excludeStreetRef (edit-mode, should not flag self as duplicate) ==="
curl -s -X POST "${BASE_URL}/streets/validate-geometry" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [96.1700, 16.8000],
        [96.1720, 16.8010],
        [96.1740, 16.8020]
      ]
    },
    "toleranceMeters": 30,
    "excludeStreetRef": { "publicId": "00000000-0000-0000-0000-000000000000" }
  }' | jq .
