# Reverse address resolver

Map-click reverse geocoding resolves a WGS84 point to the best available address or partial address from **core** tables only (no import_review).

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/addresses/reverse?lat=&lng=&lang=en\|my` | Public |
| `GET` | `/admin/addresses/reverse-debug?lat=&lng=&lang=` | Dashboard JWT |

### Query parameters

- `lat` — WGS84 latitude (-90 … 90)
- `lng` — WGS84 longitude (-180 … 180)
- `lang` — `en` (default) or `my` for `display_address`

## Resolution priority

1. Core address point/entrance within **30 m**
2. Building polygon containing the point (linked address via `core_place_buildings` → `core_place_addresses`)
3. Nearby place (150 m) with or without linked address
4. Nearest street within **300 m** (higher confidence ≤ **100 m**)
5. Official admin polygons only (`boundary_status` official/surveyed, `address_usage` official)
6. Locality hint villages (`approximate` / `settlement_extent` + `locality_hint`) — **never** treated as official address lines
7. Landuse polygon at point (context label)
8. Coordinates fallback

## Boundary rule

If `address_usage = locality_hint` and `boundary_status` is `approximate` or `settlement_extent`, the village is returned only as a **locality hint** (`match_type: point_in_polygon_locality_hint` or `nearest_centroid_hint`). Display for partial field addresses uses a **Near …** prefix (EN) or **အနီး …** (MY). Settlement extent is never upgraded to official.

## Response shape

```json
{
  "result_type": "street_area_address",
  "confidence_score": 0.72,
  "full_address_en": "Thanlyin-KyaukTan Road, Kyauktan Township, Yangon Region",
  "full_address_my": null,
  "display_address": "Thanlyin-KyaukTan Road, Kyauktan Township, Yangon Region",
  "components": [
    {
      "component_type": "street",
      "value": "Thanlyin-KyaukTan Road",
      "language_code": "en",
      "source": "core_street",
      "source_id": "st_…",
      "confidence_score": 0.85,
      "match_type": "nearest_street",
      "boundary_status": null,
      "address_usage": null
    }
  ],
  "matched": {
    "address_id": null,
    "building_id": null,
    "place_id": null,
    "street_id": "st_…",
    "admin_area_id": "aa_…"
  },
  "alternatives": [],
  "warnings": ["Nearest street 12m from click."]
}
```

### `result_type` values

`exact_address` | `building_address` | `building_partial_address` | `place_address` | `street_area_address` | `locality_partial_address` | `admin_only` | `coordinate_only`

## Admin debug

Same body as public, plus:

```json
{
  "debug": {
    "lat": 16.63,
    "lng": 96.32,
    "lang": "en",
    "decision_reason": "priority_4_nearest_street",
    "layers": {
      "nearby_addresses": [],
      "building": null,
      "places": [],
      "streets": [{ "distance_m": 12, "public_id": "…" }],
      "admin_areas": [],
      "landuse": null
    }
  }
}
```

## Manual curl tests

Assume API on `http://localhost:3001` (adjust port). Kyauktan sample bbox center:

```bash
# Public reverse (English display)
curl -sS "http://localhost:3001/addresses/reverse?lat=16.63&lng=96.32&lang=en" | jq .

# Public reverse (Myanmar display)
curl -sS "http://localhost:3001/addresses/reverse?lat=16.63&lng=96.32&lang=my" | jq .

# Field / open area (expect locality_partial or admin_only depending on data)
curl -sS "http://localhost:3001/addresses/reverse?lat=16.55&lng=96.28&lang=en" | jq .

# Admin debug (replace TOKEN)
curl -sS -H "Authorization: Bearer TOKEN" \
  "http://localhost:3001/admin/addresses/reverse-debug?lat=16.63&lng=96.32&lang=en" | jq .
```

## Performance

- All spatial filters use `ST_DWithin` / `ST_Contains` with bounded limits (`REVERSE_CANDIDATE_LIMIT = 8`).
- Migration `047_reverse_address_spatial_indexes.sql` adds GIST on `core_addresses.entrance_geom` and `core_map_landuse.geom` if missing.

## Code

- `apps/api/src/modules/addresses/reverse-address.repo.ts` — SQL
- `apps/api/src/modules/addresses/reverse-address.resolver.ts` — priority stack + composition
- `apps/api/src/modules/addresses/addresses.routes.ts` — routes

## Dashboard integration

- **Import review** (`ImportReviewAddressDetailDrawer`): clickable map saves `point_geom` via `PATCH …/addresses/:id/overrides` (`review_overrides.point_geom`), then calls reverse-debug. **Use suggested components** fills the component table (and match ids when they appear in loaded options).
- **Core review** (`CoreAddressFormExtras` on address create/edit): same map + reverse panel + component editor; save sends `components` only (generated full address is readonly metadata).
- Shared UI: `apps/dashboard/src/features/addresses/` (`ReverseAddressSuggestionPanel`, `AddressLocationMapPicker`, `useReverseAddressSuggestion`).
