# Import Review Direct Edit Runtime QA

This checklist is for **runtime/browser QA** and **API smoke QA** (not static route consistency).

**Related:** [direct-edit-promotion-contract.md](./direct-edit-promotion-contract.md) (promotion flow after edits), [simple-promotion-runtime-qa.md](./simple-promotion-runtime-qa.md) (validate → promote smoke + manual QA), [naming-contract.md](./naming-contract.md) (name fields).

Do **not** mark a family PASS unless it was actually tested in browser and/or by smoke script.

## Scope

Normal direct-edit families:

- `buildings`
- `places`
- `roads`
- `landuse`
- `water_lines`
- `water_polygons`
- `admin_areas`
- `routing_barriers`

Separate runtime check:

- `addresses` validation path (`POST /api/import-review/addresses/validate`)

Default test batch: `review_batch_id=2`.

**Naming contract:** Field meanings and UI priority (`name_mm`, `name_en`, source vs typed) are defined in [naming-contract.md](./naming-contract.md).

---

## Runtime Procedure (Normal Families)

For each family (`<family>`) below:

1. Open `/dashboard/import-review/<family>?review_batch_id=2`.
2. Open one row.
3. Confirm typed/source values are visible in editable inputs/dropdowns.
4. Change one safe field.
5. Click `Save Changes`.
6. Confirm Network includes:
   - `PATCH /api/import-review/<family>/<id>`
7. Confirm Network does **not** include:
   - `PATCH /api/import-review/<family>/<id>/overrides`
8. Confirm response status is `200`.
9. Confirm success message (`Saved changes.` or equivalent success banner).
10. Close and reopen drawer.
11. Refresh browser.
12. Confirm edited value persists.
13. Confirm SQL typed column changed.
14. Confirm `review_overrides` did not change.

---

## Family URLs + Safe Fields

- `buildings` -> `/dashboard/import-review/buildings?review_batch_id=2`
  - Safe fields: `name_en`, `building_type_id`
- `places` -> `/dashboard/import-review/places?review_batch_id=2`
  - Safe fields: `name_mm` or `name_en` (keep at least one populated)
- `roads` -> `/dashboard/import-review/roads?review_batch_id=2`
  - Safe fields: `surface`, `is_oneway`, `road_class_id`
- `landuse` -> `/dashboard/import-review/landuse?review_batch_id=2`
  - Safe fields: `class_code`, `landuse_class_id`
- `water_lines` -> `/dashboard/import-review/water-lines?review_batch_id=2`
  - Safe fields: `name_en`, `class_code`
- `water_polygons` -> `/dashboard/import-review/water-polygons?review_batch_id=2`
  - Safe fields: `name_en`, `class_code`
- `admin_areas` -> `/dashboard/import-review/admin-areas?review_batch_id=2`
  - Safe fields: `name_en`, `admin_level_id`, `parent_id`
- `routing_barriers` -> `/dashboard/import-review/routing-barriers?review_batch_id=2`
  - Safe fields: `barrier_type`, `class_code`

---

## Addresses Validation Runtime

Addresses are not part of the normal `/:family/:id` direct-edit patch flow.
Validate addresses via the address drawer validation action.

### Required checks

1. Open `/dashboard/import-review/addresses?review_batch_id=2`.
2. Open one address row.
3. Click `Validate address`.
4. Confirm request:
   - `POST /api/import-review/addresses/validate`
5. Confirm response:
   - `200` with `results[]` and `validation_status`, **or**
   - `400` with clear structured reason (`field`, `message`, `severity`) displayed in UI.
6. Confirm UI does not only show generic `Request failed with status 400`.

---

## SQL Verification Templates

Replace `:id` placeholders from tested candidate IDs.

### Typed columns changed

```sql
select id, name_mm, name_en, building_type_id, review_note, updated_at
from import_review.building_candidates
where id = :building_id;

select id, name_mm, name_en, category_id, admin_area_id, review_note, updated_at
from import_review.place_candidates
where id = :place_id;

select id, name_mm, name_en, road_class_id, surface, is_oneway, review_note, updated_at
from import_review.road_candidates
where id = :road_id;

select id, name_mm, name_en, class_code, landuse_class_id, review_note, updated_at
from import_review.landuse_candidates
where id = :landuse_id;

select id, name_mm, name_en, class_code, review_note, updated_at
from import_review.water_line_candidates
where id = :water_line_id;

select id, name_mm, name_en, class_code, review_note, updated_at
from import_review.water_polygon_candidates
where id = :water_polygon_id;

select id, name_mm, name_en, admin_level_id, parent_id, slug, review_note, updated_at
from import_review.admin_area_candidates
where id = :admin_area_id;

select id, barrier_type, class_code, review_note, updated_at
from import_review.routing_barrier_candidates
where id = :routing_barrier_id;
```

### `review_overrides` unchanged

```sql
select id, review_overrides from import_review.building_candidates where id = :building_id;
select id, review_overrides from import_review.place_candidates where id = :place_id;
select id, review_overrides from import_review.road_candidates where id = :road_id;
select id, review_overrides from import_review.landuse_candidates where id = :landuse_id;
select id, review_overrides from import_review.water_line_candidates where id = :water_line_id;
select id, review_overrides from import_review.water_polygon_candidates where id = :water_polygon_id;
select id, review_overrides from import_review.admin_area_candidates where id = :admin_area_id;
select id, review_overrides from import_review.routing_barrier_candidates where id = :routing_barrier_id;
```

---

## PASS/FAIL Recording Template

Fill this after real runtime execution.

| Family | Browser Runtime Tested | API Smoke Tested | PATCH `/:family/:id` seen | `/overrides` absent | 200 OK | Value persisted after reopen+refresh | SQL typed column changed | `review_overrides` unchanged | Result | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| buildings | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| places | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| roads | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| landuse | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| water_lines | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| water_polygons | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| admin_areas | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| routing_barriers | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | TODO |  |
| addresses (validate) | ☐ | ☐ | n/a | n/a | ☐ | n/a | n/a | n/a | TODO | Structured validation message shown |

Legend:

- `Browser Runtime Tested`: manually tested in UI
- `API Smoke Tested`: validated by script

---

## Optional API Smoke Scripts

**Persistence (typed column + optional DB):**

```bash
API_BASE_URL=http://localhost:3001 ADMIN_TOKEN=... DATABASE_URL=... \
  node apps/api/scripts/smoke-import-review-direct-patch-persistence.mjs
```

Verifies `PATCH /:family/:id` → GET detail persistence and, when `DATABASE_URL` is set, typed columns, `review_candidate_edits`, and unchanged `review_overrides`.

Two passes in the script output:

- **SIMPLE_FIELD_PERSISTENCE** — `name_en` / `name_mm` / `class_code` string smoke values
- **REFERENCE_FIELD_PERSISTENCE** — dropdown/FK fields: `places.category_id`, `places.admin_area_id`, `buildings.building_type_id`, `roads.road_class_id`, `landuse.landuse_class_id`, `admin_areas.admin_level_id`, `routing_barriers.class_code`

Reference ids are loaded from `ref.ref_poi_categories`, `ref.ref_building_types`, `ref.ref_road_classes`, `ref.ref_landuse_classes`, `ref.ref_admin_levels`, and `core.core_admin_areas` when `DATABASE_URL` is set.

**Direct PATCH + addresses validate:**

```bash
API_BASE_URL=http://localhost:3001 ADMIN_TOKEN=... REVIEW_BATCH_ID=2 \
  node apps/api/scripts/smoke-import-review-direct-patch.mjs
```

The older script also covers `POST /api/import-review/addresses/validate`.

