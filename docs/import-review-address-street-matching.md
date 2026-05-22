# Import review — address street matching API

Dropdown options and explicit match persistence for `import_review.address_candidates`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/import-review/addresses/:id/options` | Ranked streets, admin areas, postcodes |
| `PATCH` | `/api/import-review/addresses/:id/matches` | Save `matched_*` ids + sync street components |

Requires import-review admin auth (same as other import-review routes).

## Example JSON — `GET .../options`

```json
{
  "address_candidate_id": "42",
  "streets": [
    {
      "id": "1205",
      "canonical_name": "Bogyoke Aung San Road",
      "name_en": "Bogyoke Aung San Road",
      "name_my": "ဗိုလ်ချုပ်အောင်ဆန်းလမ်း",
      "name_und": null,
      "distance_m": 38.2,
      "match_score": 92,
      "match_method": "name_and_distance_admin_match"
    },
    {
      "id": "884",
      "canonical_name": "26th Street",
      "name_en": "26th Street",
      "name_my": null,
      "name_und": null,
      "distance_m": 210.5,
      "match_score": 68,
      "match_method": "distance_only"
    }
  ],
  "adminAreas": [
    {
      "id": "301",
      "canonical_name": "Ward 5",
      "name_en": "Ward 5",
      "name_my": "ရပ်ကွက် ၅",
      "admin_level_code": "ward",
      "boundary_status": "official",
      "address_usage": "official",
      "distance_m": null,
      "match_score": 100,
      "match_method": "matched_current"
    }
  ],
  "postcodes": [
    {
      "value": "11041",
      "language_code": "und",
      "source": "address_component"
    }
  ]
}
```

## Example JSON — `PATCH .../matches`

Request:

```json
{
  "matched_street_id": "1205",
  "matched_admin_area_id": "301",
  "street_match_confidence": 92
}
```

Response:

```json
{
  "address_candidate_id": "42",
  "matched_street_id": "1205",
  "matched_admin_area_id": "301",
  "matched_building_id": null,
  "matched_place_id": null,
  "street_match_type": "selected_street_match",
  "street_match_confidence": 92,
  "street_components_synced": [
    { "language_code": "en", "action": "updated" },
    { "language_code": "my", "action": "inserted" },
    { "language_code": "und", "action": "skipped" }
  ]
}
```

Set `replace_reviewed_street_components: true` to overwrite `is_reviewed` street lines.

## Manual curl tests

```bash
# Options (replace TOKEN and CANDIDATE_ID)
curl -sS "http://localhost:3001/api/import-review/addresses/CANDIDATE_ID/options" \
  -H "Authorization: Bearer TOKEN" | jq .

# Save street match
curl -sS -X PATCH "http://localhost:3001/api/import-review/addresses/CANDIDATE_ID/matches" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"matched_street_id":"1205","street_match_confidence":92}' | jq .

# Clear street match
curl -sS -X PATCH "http://localhost:3001/api/import-review/addresses/CANDIDATE_ID/matches" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"matched_street_id":null}' | jq .
```

## Street matching rules

1. Requires `point_geom` on the candidate.
2. Source names from `address_components` where `component_type_code` ∈ `street`, `road` and `language_code` ∈ `en`, `my`, `und`.
3. Nearby search: **300 m** first, then **1000 m** if empty.
4. Scoring blends name similarity, distance, and bonus when `street.admin_area_id = matched_admin_area_id`.
5. Returns top **10** streets.

Score bands: strong name + near (85–95), near-only (60–75), weak/far (&lt;60).
