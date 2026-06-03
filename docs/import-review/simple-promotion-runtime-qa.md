# Simple promotion runtime QA

Manual and automated checks for the **simplified direct-edit promotion flow**: typed candidate columns → publish batch (`mode=selected`) → validate → promote → verify.

**Related:**

- [direct-edit-promotion-contract.md](./direct-edit-promotion-contract.md) — normative promotion contract
- [direct-edit-runtime-qa.md](./direct-edit-runtime-qa.md) — pre-promote PATCH persistence
- [naming-contract.md](./naming-contract.md) — name fields

**Automated smoke:** `apps/api/scripts/smoke-import-review-promotion-simple.mjs`

Default scope: **one candidate** in `review_batch_id=2`, **buildings** first (low risk). Optional families: `places`, `roads`, `routing_barriers`.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| API running | Local or staging only unless explicitly allowed |
| Admin token | `x-import-review-admin-token` (same as other import-review smokes) |
| Database URL | Required for smoke script SQL evidence |
| Test batch | Non-production `review_batch_id` with at least one promotable candidate per family |

**Smoke env vars:**

```bash
API_BASE_URL=http://localhost:3001
ADMIN_TOKEN=<import-review-admin-token>
DATABASE_URL=postgresql://...
REVIEW_BATCH_ID=2
# optional:
FAMILY=buildings|places|roads|routing_barriers
ALLOW_HIGH_RISK=true          # required for roads, routing_barriers
ALLOW_PRODUCTION=true         # only if you intentionally target prod-like URLs
PROMOTION_NOTE="smoke simple promotion"
```

**Run (from repo root):**

```bash
node apps/api/scripts/smoke-import-review-promotion-simple.mjs
```

Script prints **PASS/FAIL** per step and JSON **SQL evidence** blocks. Exit code `0` = overall pass.

If validate fails with a Prisma `geometry` deserialization error in `current_message`, that is an API/runtime issue (validation SQL must cast geometry columns for Prisma raw queries), not a smoke-script false negative.

Optional: `SMOKE_CANDIDATE_ID=<id>` to pin a specific candidate.

---

## Dashboard procedure (manual)

Use a **non-production** review batch. Prefer `review_batch_id=2` on local/staging.

### 1. Scope — pick one approved candidate

1. Open `/dashboard/import-review/promotion?review_batch_id=2`.
2. In **Scope**, select exactly **one family** (start with **Buildings**).
3. Confirm the family checklist shows target table `core.core_map_buildings`.
4. Open the family list (e.g. `/dashboard/import-review/buildings?review_batch_id=2`).
5. Open one row that is **Approved** (or approve after fixing typed fields).
6. Ensure typed fields required for promotion are set (see contract §4):
   - `geom` valid polygon
   - `building_type_id` set
   - lineage: `external_id` OR `local_staging_id` OR non-empty `source_refs`
7. Save any edits via **Save Changes** (`PATCH /api/import-review/buildings/:id`, not `/overrides`).

### 2. Create promotion batch (`mode=selected`)

1. Back on `/dashboard/import-review/promotion`.
2. Select the same single family and the **one candidate** (checkbox / selected scope).
3. Create batch with mode **Selected** (not “all ready”).
4. Note the new **publish batch id** from the UI or batch history link.

### 3. Validate

1. Open batch detail: `/dashboard/import-review/promotion/batches/<id>`.
2. Run **Validate**.
3. Wait until batch is no longer `validating`.
4. Confirm item shows **Ready** or **Warning** (not **Blocked**).
5. If **Warning**, read issues; you will need **Confirm warnings** + note on promote.

### 4. Promote

1. Type confirmation `PROMOTE` when prompted.
2. If warnings: enable **Confirm warnings** and enter a **promotion note**.
3. Start promote; wait until status is not `promoting`.
4. For **roads** / **routing_barriers**: dry-run is **recommended** but not required by the simplified flow; treat as high-risk (see below).

### 5. Verify (UI + API)

1. On batch detail, open **Verify** / verification panel if present.
2. Confirm candidate list shows **Promoted** for the test row.
3. Use entity link to open core row (buildings → core map building).

Record: `publish_batch_id`, `candidate_id`, `promoted_core_id`, timestamp, operator note.

---

## SQL verification queries

Replace placeholders: `:batch_id`, `:candidate_id`, `:core_id`, `:review_batch_id`.

### Candidate promotion state

```sql
-- buildings (swap table for other families)
SELECT id, review_batch_id, review_status, review_decision,
       promotion_status, promoted_core_id, promoted_at,
       building_type_id, name_en, name_mm, external_id, local_staging_id
FROM import_review.building_candidates
WHERE review_batch_id = :review_batch_id
  AND id = :candidate_id;
```

**Expect:** `promotion_status = 'promoted'`, `promoted_core_id` NOT NULL, `promoted_at` set.

### Publish item (validation + promote)

```sql
SELECT id, publish_batch_id, entity_family, review_candidate_id,
       publish_status, target_schema, target_table, target_id,
       validation_result->>'status' AS validation_status,
       validation_result, published_at, error_message
FROM system.system_publish_items
WHERE publish_batch_id = :batch_id
  AND review_candidate_id = :candidate_id;
```

**Expect after validate:** `validation_result.status` in (`ready`, `valid`, `warning`).

**Expect after promote:** `publish_status = 'success'` (not a separate `promoted` value — DB check constraint), `target_schema` / `target_table` / `target_id` populated.

**Family targets:**

| Family | `target_schema` | `target_table` |
|--------|-----------------|----------------|
| buildings | `core` | `core_map_buildings` |
| places | `core` | `core_places` |
| roads | `core` | `core_streets` |
| routing_barriers | `routing` | `routing_barriers` |

### Core row exists

```sql
SELECT id, name, building_type_id, external_id, source_staging_id, is_active, deleted_at
FROM core.core_map_buildings
WHERE id = :core_id;
```

### Typed column match (buildings example)

```sql
SELECT
  b.id AS candidate_id,
  b.building_type_id AS cand_type,
  c.building_type_id AS core_type,
  trim(coalesce(nullif(trim(b.name_en), ''), b.name_mm)) AS cand_name,
  trim(c.name) AS core_name,
  (b.building_type_id = c.building_type_id) AS type_match,
  (trim(coalesce(nullif(trim(b.name_en), ''), b.name_mm)) = trim(c.name)) AS name_match
FROM import_review.building_candidates b
JOIN core.core_map_buildings c ON c.id = b.promoted_core_id
WHERE b.id = :candidate_id;
```

### Places / roads / routing_barriers

```sql
-- places: category_id, admin_area_id, point_geom vs core_places.point_geom
SELECT b.category_id, p.category_id,
       ST_Distance(b.point_geom::geography, p.point_geom::geography) AS dist_m
FROM import_review.place_candidates b
JOIN core.core_places p ON p.id = b.promoted_core_id
WHERE b.id = :candidate_id;

-- roads: road_class_id
SELECT b.road_class_id, s.road_class_id
FROM import_review.road_candidates b
JOIN core.core_streets s ON s.id = b.promoted_core_id
WHERE b.id = :candidate_id;

-- routing_barriers: barrier_type + geometry
SELECT b.barrier_type, r.barrier_type,
       ST_Distance(b.point_geom::geography, r.geom::geography) AS dist_m
FROM import_review.routing_barrier_candidates b
JOIN routing.routing_barriers r ON r.id = b.promoted_core_id
WHERE b.id = :candidate_id;
```

### Batch summary

```sql
SELECT id, status, review_batch_id, summary, validated_at, promoted_at
FROM system.system_publish_batches
WHERE id = :batch_id;
```

---

## Rollback notes (non-production only)

Promotion creates or updates **production core/routing rows**. On staging/dev, rollback is manual and must be coordinated:

1. **Do not** delete ledger/history rows casually; prefer deactivating test core rows.
2. For a mistaken **insert**, soft-deactivate if supported:

   ```sql
   UPDATE core.core_map_buildings
   SET is_active = false, deleted_at = now(), updated_at = now()
   WHERE id = :core_id;
   ```

3. Reset candidate promotion flags **only on non-prod** when you need to re-run the smoke:

   ```sql
   UPDATE import_review.building_candidates
   SET promotion_status = NULL,
       promoted_core_id = NULL,
       promoted_at = NULL
   WHERE id = :candidate_id;
   ```

4. Mark publish item failed/skipped only if your ops playbook allows; otherwise leave audit trail and create a new batch.

5. If duplicate `external_id` errors appear on re-run, change `external_id` on the **candidate** (typed column) or pick another candidate.

**Never** run rollback SQL on production without an approved ops procedure.

---

## What not to test on production

| Do not | Why |
|--------|-----|
| Run the smoke script without `ALLOW_PRODUCTION=true` on prod-like URLs | Script refuses prod-like `API_BASE_URL` / `DATABASE_URL` by default |
| Promote arbitrary batches on production | Writes real core/routing data |
| Use `FAMILY=roads` or `routing_barriers` without dry-run review on prod | High-impact geometry / routing graph |
| Bus families via this flow | Disabled in simplified promotion UI |
| Expect `system_publish_items.status = 'promoted'` | Allowed values: `pending`, `success`, `failed`, `skipped`, `rolled_back` |
| Valhalla rebuild, PMTiles publish, OTP | Out of scope for import-review promotion |
| Bulk `all_ready` promotion during smoke | Smoke uses `mode=selected` with one id |

**Safe default:** local API + local/staging DB + `REVIEW_BATCH_ID` dedicated to QA + **buildings** only.

**High-risk families (`roads`, `routing_barriers`):** require `ALLOW_HIGH_RISK=true` in smoke; in manual QA, confirm geometry and class/FK fields, review validation warnings, and avoid peak-traffic production windows.

---

## PASS checklist

| Step | Buildings | Places | Roads | Routing barriers |
|------|-----------|--------|-------|------------------|
| Typed fields + approved | ☐ | ☐ | ☐ | ☐ |
| Batch `mode=selected` | ☐ | ☐ | ☐ | ☐ |
| Validate → Ready/Warning | ☐ | ☐ | ☐ | ☐ |
| Promote → success | ☐ | ☐ | ☐ | ☐ |
| `promotion_status=promoted` | ☐ | ☐ | ☐ | ☐ |
| Core/routing row + typed match | ☐ | ☐ | ☐ | ☐ |
| Smoke script OVERALL PASS | ☐ | ☐ | ☐ | ☐ |

Do not mark PASS for a family unless browser and/or smoke evidence exists for that family.
