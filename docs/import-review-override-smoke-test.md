# Import Review — Override Form Smoke Test Checklist

Manual dashboard checks and API curl smoke tests for `review_overrides` PATCH flows.

**Last updated:** 2026-05-21

---

## Architecture notes (read first)

- The **dashboard must call the API only** — no direct database access from `apps/dashboard`.
- **`review_overrides`** on the candidate row stores **reviewer override values only** (shallow JSON merge).
- **Imported source columns** (`name`, `name_local`, `normalized_data`, etc.) must **not** change when saving overrides.
- **Core tables** (`core.*`) are **not** updated by override save. Core changes happen during **promotion** (and related approval workflows), not when PATCHing overrides.
- Override PATCH uses **primitive values** (`string`, `number`, `boolean`, `null`). Unknown keys return **400**.
- **`review_overrides: {}`** clears **all** stored overrides on that candidate.
- **`"field": null`** in the patch removes **only that key** from stored overrides.
- Scope: every PATCH body must include **exactly one** of `review_batch_id` **or** `source_snapshot_version` (not both).

---

## Prerequisites

| Item | Example |
|------|---------|
| API running | `http://localhost:3001` |
| Auth | `x-import-review-admin-token` **or** `Authorization: Bearer <admin-jwt>` — see [apps/api/docs/import-review-auth.md](../apps/api/docs/import-review-auth.md) |
| Test batch | `review_batch_id=2` (adjust to your environment) |
| Snapshot | `source_snapshot_version=osm_myanmar_2026_05_15_kyauktan_v2` (adjust) |
| Candidate | Non-promoted row with `promotion_status != promoted` |
| Dashboard scope | Apply snapshot + batch on the entity page before testing |

### Shell variables (API section)

```bash
export API=http://localhost:3001
export BATCH_ID=2
export SNAP=osm_myanmar_2026_05_15_kyauktan_v2
export CANDIDATE_ID=123          # replace with real candidate id
export AUTH_HEADER="x-import-review-admin-token: dev-secret-change-me"
# Or: export AUTH_HEADER="Authorization: Bearer <jwt>"
```

---

## Allowed override keys (reference)

| Entity family | API route | Allowed `review_overrides` keys |
|---------------|-----------|----------------------------------|
| `bus_stops` | `PATCH /api/import-review/bus_stops/:id/overrides` | `name_mm`, `name_en`, `stop_code`, `admin_area_id` |
| `places` | `PATCH /api/import-review/places/:id/overrides` | `name_mm`, `name_en`, `category_id`, `admin_area_id`, `lat`, `lng`, `confidence_score`, `importance_score`, `popularity_score` |
| `roads` | `PATCH /api/import-review/roads/:id/overrides` | `name_mm`, `name_en`, `road_class_id`, `is_oneway`, `surface`, `admin_area_id`, `confidence_score`, `geom` |
| `buildings` | `PATCH /api/import-review/buildings/:id/overrides` | `name_mm`, `name_en`, `building_type_id`, `admin_area_id`, `levels`, `height_m`, `confidence_score` |
| `landuse` | `PATCH /api/import-review/landuse/:id/overrides` | `name_mm`, `name_en`, `class_code`, `admin_area_id`, `confidence_score` |
| `water_lines` | `PATCH /api/import-review/water_lines/:id/overrides` | `name_mm`, `name_en`, `class_code`, `confidence_score` |
| `water_polygons` | `PATCH /api/import-review/water_polygons/:id/overrides` | `name_mm`, `name_en`, `class_code`, `confidence_score` |
| `admin_areas` | `PATCH /api/import-review/admin_areas/:id/overrides` | `name_mm`, `name_en`, `admin_level_id`, `parent_id` |

> **Bus routes:** No import-review dashboard page yet. DB/API family `bus_routes` is deferred; allowlist is reserved for future UI (`route_code`, `operator_name`, `route_type`, etc.).

---

## Manual dashboard tests

Use the same test batch on each page. Open a candidate detail drawer, use the **Review overrides** section, then verify stored JSON at the bottom of the form.

**Pass criteria (all entities):**

- Save succeeds with a success banner (no 400/500 toast).
- Stored `review_overrides` JSON reflects the change.
- Imported columns / `normalized_data` unchanged (refresh list or inspect API GET detail).
- Essential fields marked with `*` are visible where configured.
- Promoted rows: override editor blocked.

### Bus stops

**Route:** `/dashboard/import-review/bus-stops`

| # | Steps | Expected result |
|---|--------|-----------------|
| B1 | Save **Myanmar name** only (`name_mm`) | `review_overrides.name_mm` set; effective Myanmar name updates |
| B2 | Save **English name** only (`name_en`) | `review_overrides.name_en` set |
| B3 | Save both names | Both keys present in stored JSON |
| B4 | Clear Myanmar (Clear override), keep English; save | `name_mm` key removed; `name_en` kept |
| B5 | Clear all override fields; save | `review_overrides` becomes `{}` |
| B6 | Pick **Admin area** from dropdown; save | `admin_area_id` stored as numeric id |
| B7 | Approve with overrides / approve without overrides | Decision saves; no 500; essentials defaulted on approve if configured |

### Places

**Route:** `/dashboard/import-review/places`

| # | Steps | Expected result |
|---|--------|-----------------|
| P1 | Save `name_mm` only | Patch succeeds; at least one name satisfied |
| P2 | Save `name_en` only | Same |
| P3 | Save both + **Category** + **Admin area** | `category_id`, `admin_area_id` in stored JSON |
| P4 | Clear one name while keeping the other | Single-key null semantics; other name remains |
| P5 | Clear all overrides | `{}` stored |

### Roads / streets

**Route:** `/dashboard/import-review/roads` (legacy page with road override panel)

| # | Steps | Expected result |
|---|--------|-----------------|
| R1 | Save `name_mm` / `name_en` (optional for unnamed roads) | Names stored in `review_overrides` when provided |
| R2 | Select **Road class** * + save | `road_class_id` stored |
| R3 | Select **Admin area** * + save | `admin_area_id` stored |
| R4 | Toggle one-way; save | `is_oneway` stored |
| R5 | Save geometry edit (if drawn) | `geom` GeoJSON in overrides (roads only) |
| R6 | Acknowledge routing warnings if prompted | Save completes after confirm |

### Buildings

**Route:** `/dashboard/import-review/buildings`

| # | Steps | Expected result |
|---|--------|-----------------|
| BL1 | Save `name_mm` / `name_en` | Names in overrides |
| BL2 | Select **Building type** + **Admin area**; save | `building_type_id`, `admin_area_id` stored |
| BL3 | Set levels / height; save | Numeric fields stored |
| BL4 | Clear all overrides | `{}` |

### Landuse

**Route:** `/dashboard/import-review/landuse`

| # | Steps | Expected result |
|---|--------|-----------------|
| L1 | Save `class_code` + optional names | `class_code` required marker; value stored |
| L2 | Clear class override | Key removed or full clear via `{}` |

### Water

**Routes:** `/dashboard/import-review/water-lines`, `/dashboard/import-review/water-polygons`

| # | Steps | Expected result |
|---|--------|-----------------|
| W1 | Save `class_code` on line candidate | Override stored (`water_lines` family) |
| W2 | Save `class_code` on polygon candidate | Override stored (`water_polygons` family) |
| W3 | Save optional names | `name_mm` / `name_en` in JSON |

### Admin areas

**Route:** `/dashboard/import-review/admin-areas` (page exists)

| # | Steps | Expected result |
|---|--------|-----------------|
| A1 | Save `name_mm` / `name_en` | Stored in overrides |
| A2 | Set **Admin level** / **Parent** refs; save | `admin_level_id`, `parent_id` stored |
| A3 | If UI shows **Slug**: saving slug may return **400** (slug is not in API allowlist) | Document as known mismatch if it fails |

### Bus routes

**Import-review page:** **Not implemented** — skip manual UI tests. Use API-only checks when bus route review UI lands.

---

## API smoke tests (curl)

Use **`bus_stops`** as the primary family below; repeat key cases for `places`, `buildings`, etc. by changing the URL path.

**Generic family URL pattern:**

```text
PATCH $API/api/import-review/<family>/$CANDIDATE_ID/overrides
```

**Dedicated URLs:**

- Buildings: `PATCH $API/api/import-review/buildings/$CANDIDATE_ID/overrides`
- Roads: `PATCH $API/api/import-review/roads/$CANDIDATE_ID/overrides`

### 1. Save `name_mm` only

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_overrides\": { \"name_mm\": \"ဘတ်စ်မှတ်တိုင် စမ်းသပ်\" }
  }"
```

**Expected:** HTTP **200**; response JSON includes `review_overrides.name_mm`; imported `name` / `name_local` columns unchanged on subsequent GET.

### 2. Save `name_en` only

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_overrides\": { \"name_en\": \"Test Bus Stop EN\" }
  }"
```

**Expected:** HTTP **200**; `review_overrides.name_en` set.

### 3. Save both `name_mm` and `name_en`

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_overrides\": {
      \"name_mm\": \"မြန်မာအမည်\",
      \"name_en\": \"English Name\"
    }
  }"
```

**Expected:** HTTP **200**; both keys in returned `review_overrides`.

### 4. Clear all overrides with `{}`

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_overrides\": {}
  }"
```

**Expected:** HTTP **200**; `review_overrides` in response is `{}` (or empty object); effective values fall back to imported sources.

### 5. Clear one field with `null` (keep others)

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_overrides\": { \"name_mm\": null }
  }"
```

**Expected:** HTTP **200**; `name_mm` key absent from stored overrides; other keys unchanged.

### 6. Save `admin_area_id`

Replace `12` with a valid active `core.core_admin_areas.id`.

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_overrides\": { \"admin_area_id\": 12 }
  }"
```

**Expected:** HTTP **200**; `admin_area_id` stored; invalid/inactive id → **400** with clear message.

### 7. Invalid unsupported field → 400

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_overrides\": { \"name\": \"Legacy key should fail\" }
  }"
```

**Expected:** HTTP **400**; body message includes `Unsupported review_overrides field(s)` (not 500).

Legacy keys such as `name`, `name_local`, `canonical_name`, `poi_category_id` should also return **400**.

### 8. Buildings dedicated route (sanity)

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/buildings/$CANDIDATE_ID/overrides" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"source_snapshot_version\": \"$SNAP\",
    \"review_overrides\": {
      \"name_mm\": \"အဆောက်အဦး\",
      \"building_type_id\": 1,
      \"admin_area_id\": 12
    }
  }"
```

**Expected:** HTTP **200** when ids exist in ref/core tables.

### 9. Approve decision (no override change)

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/bus_stops/$CANDIDATE_ID/decision" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d "{
    \"review_batch_id\": \"$BATCH_ID\",
    \"review_decision\": \"approved\",
    \"review_note\": \"Smoke test approve\"
  }"
```

**Expected:** HTTP **200**; `review_decision=approved`; essential-field defaults applied server-side if missing; **400** (not 500) if required fields cannot be resolved.

---

## Quick verification queries (optional)

After override save, confirm source columns were not mutated (run against import-review DB):

```sql
-- Replace table/id as needed
SELECT id, name, name_local, review_overrides, updated_at
FROM import_review.bus_stop_candidates
WHERE id = 123;
```

`review_overrides` should change; `name` / `name_local` should match pre-save values unless a separate import job updated them.

---

## Sign-off checklist

- [ ] Bus stops — manual B1–B7
- [ ] Places — manual P1–P5
- [ ] Roads — manual R1–R6
- [ ] Buildings — manual BL1–BL4
- [ ] Landuse — manual L1–L2
- [ ] Water lines / polygons — manual W1–W3
- [ ] Admin areas — manual A1–A2 (A3 if slug tested)
- [ ] API curl 1–7 on at least one family
- [ ] API curl 8 (buildings) if building candidates available
- [ ] API curl 9 (approve) with and without prior overrides
- [ ] Unsupported field returns 400
- [ ] `{}` clears all overrides

---

## Related docs

- [import-review-auth.md](../apps/api/docs/import-review-auth.md) — authentication
- [import-review-ui-consistency-checklist.md](./import-review/import-review-ui-consistency-checklist.md) — full entity page checklist
- [entity-coverage-matrix.md](./import-review/entity-coverage-matrix.md) — staging / import_review / core coverage
