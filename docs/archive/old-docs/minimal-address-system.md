---
status: archived
reason: replaced by docs/archive/old-docs/minimal-address-system.md
archived_at: 2026-07-01
---

# Minimal Address System

A lightweight, read-only reverse-address feature: turn a map point or public place
into a single human-readable address line plus a dynamically generated Plus Code.
Intentionally small — no contributions, no storage, no fuzzy plus-code search.

## Scope

In scope:

- One-line composed address (`address_line`).
- Plus Code generated dynamically from lat/lng (never stored).
- Map click → show address for the clicked point.
- Public place detail → show address + Plus Code for one opened place.

Out of scope (deliberately not built here):

- No report / contribution action.
- No save / bookmark action.
- No database writes (no `core_places.plus_code` backfill, no inserts/updates).
- No plus-code search (cannot search *by* a Plus Code yet).

## Address format

```text
Near <nearby>, <Township>, <District>, <Region/State>, Myanmar
```

Rules:

- `Near ` prefix is added only when a nearby place/street name exists.
- If there is no nearby name, the line starts with the township.
- Missing parts (e.g. district) are omitted — no empty segments, no double commas.
- Adjacent duplicate parts are collapsed.
- Country falls back to `Myanmar` when unknown.
- No ward/village line, no Plus Code, and no lat/lng inside `address_line`.

## API

```text
GET /search/reverse?lat=<number>&lng=<number>
```

- Public, unauthenticated, read-only.
- `lat` must be between -90 and 90; `lng` between -180 and 180 (Zod-validated).
- Raw SQL errors are never exposed; failures return a generic 500 message.

### Response

```json
{
  "address_line": "Near Kyauktan Market, Kyauktan Township, Yangon South District, Yangon Region, Myanmar",
  "plus_code": "6PH58R5H+XX",
  "lat": 16.123456,
  "lng": 96.123456,
  "confidence": "exact_nearby"
}
```

| Field          | Type                                                            | Notes                                              |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `address_line` | string                                                          | Always present; falls back to `"Myanmar"`.         |
| `plus_code`    | string \| null                                                  | Generated on demand; `null` for invalid coords.    |
| `lat`          | number                                                          | Echoes the request.                                |
| `lng`          | number                                                          | Echoes the request.                                |
| `confidence`   | `"exact_nearby"` \| `"street_nearby"` \| `"area_based"` \| `"unknown"` | Derived from what matched. |

`confidence` meaning:

- `exact_nearby` — a public place within 300m.
- `street_nearby` — a named active street within 200m.
- `area_based` — only township/region resolved.
- `unknown` — nothing useful found.

### Implementation map

- DB function: `core.reverse_address_minimal(lat, lng)` (migration `infrastructure/database/migrations/supabase/108_core_reverse_address_minimal_function.sql`). Reuses the existing `core.find_admin_area_for_point` + admin `parent_id` chain.
- API endpoint: `apps/api/src/modules/addresses/` — `reverse-search.{schema,repo,service,openapi}.ts`, registered in `addresses.routes.ts`.
- Address composer: `apps/api/src/modules/addresses/minimal-address-composer.ts`.
- Plus Code: `apps/api/src/lib/geo/plus-code.ts` (`pluscodes` npm package).
- Public place detail enrichment: `apps/api/src/modules/public-map/public-map.service.ts` (`getPlaceByPublicId`).
- Web client: `getReverseAddress()` in `apps/web/src/features/poi/api/publicMapApi.ts`.
- Web map-click UI: `apps/web/src/features/map/components/AddressLocationPanel.tsx` + `apps/web/src/features/map/api/useReverseAddress.ts`.
- Web place-detail UI: `apps/web/src/features/poi/components/PlaceDetailPanel.tsx`.

## Manual QA

1. Click a point inside Kyauktan → expect a `Near …, Kyauktan Township, …, Myanmar` line, usually `exact_nearby` or `street_nearby`.
2. Click a point inside Yangon but outside Kyauktan → expect the correct township/region for that point (not Kyauktan).
3. Click near a public place → `address_line` starts with `Near <place>`, `confidence = exact_nearby`.
4. Click near a named street (no place within 300m) → `Near <street>`, `confidence = street_nearby`.
5. Click a point with no nearby data → `address_line` falls back toward `Myanmar`, `confidence = area_based` or `unknown`.
6. Open one public place detail → Address and Plus Code rows render (Plus Code always available; Address line once migration 108 is applied). Hidden when missing.
7. Send invalid lat/lng (e.g. `lat=200`) → `400` validation error, no SQL leak.
8. Confirm the search result list does **not** reverse-geocode every row — only the single opened detail (or single map click) triggers `GET /search/reverse`. No N+1.

## Performance target

- Normal: under 300ms per `GET /search/reverse`.
- Acceptable: under 700ms.

Notes: the lookup is a single bounded query (nearest place ≤300m → nearest street ≤200m → admin point-in-polygon + parent chain) over existing GIST indexes, using a `geom && ST_Expand(point, …)` bbox prefilter so the geometry GiST indexes are used. Plus Code generation is pure in-memory compute. The map-click hook is race-safe and abortable so stale clicks are cancelled.

## Later TODO (do NOT implement here)

- Plus-code search (search *by* a Plus Code).
- `core_places.plus_code` backfill / storage.
- Ward / village address support.
- Copy / share buttons on the address.
- CoreMap custom short code.
