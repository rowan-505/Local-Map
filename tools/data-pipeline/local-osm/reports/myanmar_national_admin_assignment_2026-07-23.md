# Myanmar national admin-assignment precision — 2026-07-23

## Verdict

**PARTIAL — usable for township-level national dry-run with gaps; not ready as production country covering truth.**

- One **active** country polygon exists (~819k km² — larger than Myanmar land area; treat as coarse envelope, not precision cover).
- Local hierarchy **drifts** from `prod_mirror` (fewer official townships, no `town`, extra state/district rows, many township-like wards mislabeled).
- On a **500-point** national raw sample: fine/township-like assign hit **85.2%**; **14.8%** null (no unique township-like cover; also no district cover in this sample’s nulls).
- Yangon-style mechanical township inference remains the right **rule set**; country-wide **data repair** is the blocker for higher precision.

Evidence run log: `tools/data-pipeline/local-osm/reports/_myanmar_national_admin_assignment_run.txt`  
SQL: `tools/data-pipeline/local-osm/reports/myanmar_national_admin_assignment_report.sql`  
Yangon pilot (PASS): `yangon_admin_assignment_2026-07-23.md`

---

## Scope

| Item | Value |
|------|--------|
| Snapshot / raw | `osm_myanmar_2026_07_21_national_dry_run_v1` (id **13**) |
| Assign functions | `system.pipeline_assign_admin_area_for_point` (settlements / fine cover) |
| Township-like rule (probe) | official `township`/`town` **or** `ward_village_tract` name without `ရပ်ကွက်` / `အမှတ်` |
| Staging family assign | **not** re-measured here (Stage 05 held staging locks during probe) |
| Admin polygons | **not** edited |

---

## Covering inventory

### Local `core.core_admin_areas` (active)

| Level | Count |
|-------|------:|
| country | 1 active (+2 inactive duplicates same name) |
| state_region | 24 (sum area ~773k km²) |
| district | 118 |
| township | 304 |
| town | **0** |
| ward_village_tract | 2078 |

### `prod_mirror` (production-shaped)

| Level | Count |
|-------|------:|
| country | 1 |
| state_region | 17 |
| district | 116 |
| township | **377** |
| town | **12** |
| ward_village_tract | 1995 |

### Township-like drift

| Metric | N |
|--------|--:|
| Official local township | 304 |
| Local ward rows that look township-like (name heuristic) | 117 |
| Mirror townships | 377 |
| Name match (local township-like ward ↔ mirror township) | **65** |

So local cannot yet match production township coverage by reusing ward labels alone.

---

## Sample assignment precision (500 raw points, snap 13)

### A) `pipeline_assign_admin_area_for_point`

| Metric | Value |
|--------|------:|
| Assigned | 426 / 500 (**85.2%**) |
| Null | 74 (**14.8%**) |
| Assigned level mix | all **township** (426) — no ward hits in this sample |
| Runtime | ~0.4 s for 500 points (after planar-area fix) |

### B) Set-based unique township-like cover

Prefer official township/town, else township-like ward; require **unique** cover at best priority (ambiguous → null).

| Metric | Value |
|--------|------:|
| Unique township-like | 426 (**85.2%**) |
| Ambiguous | 0 |
| No township-like | 74 |
| District but no township-like | 0 (in this sample) |

Nulls are therefore **outside** the current township-like polygon set (border, coast, incomplete hierarchy, or points outside active admin geom), not “ambiguous double cover.”

---

## Recommended covering model (country)

Use a **cascade**, never a single forced polygon:

```text
1) country     — envelope / sanity only (one active row)
2) state_region — regional package / stats
3) district    — fallback when township unresolved
4) township    — default public assignment target for places/roads
5) ward/village — optional fine assign for settlements only
```

### Country polygon

1. Keep **exactly one** active `country` row; soft-delete or deactivate duplicates (local still has inactive twins).
2. Do **not** use country geom for entity `admin_area_id`.
3. Validate envelope against an official Myanmar boundary (land area ~676k km²). Current ~819k km² suggests water/buffer/overlap — OK as clip envelope after audit, not as cadastral truth.

### State / district

1. Prefer **production** (`prod_mirror` / Supabase) counts as target: 17 state_region, ~116 district.
2. Local 24 state_region / 118 district need a reconcile pass (extra/split/legacy rows).
3. Assignment: `ST_Covers` + unique match; if multiple → NULL (same as township policy).

### Township (primary public level)

1. **Assign on production geometry** (or mirror) when writing production `admin_area_id`, or map local id → production id.
2. Keep Yangon inference rules (migration **145** / `pipeline_township_assignment.sql`):
   - point: unique cover; prefer true township/town over township-like ward; ambiguous → NULL; **no district fallback into township field**
   - line/polygon: overlap thresholds from the Yangon report
3. Repair local labels: promote township-like `ward_village_tract` → `township` where mirror agrees (65 name matches are the first safe batch).
4. Fill missing townships vs mirror (377 − usable local set).

### Ward / village

1. Use only for **settlement** fine placement (`pipeline_assign_admin_area_for_point`), not for every POI (Stage 05 already settlements-only).
2. Do not treat urban township-like wards as wards in product UI.

---

## Recommended assignment policy (loaders / Stage 05)

| Use case | Target level | Rule |
|----------|--------------|------|
| National dry-run / IR package | township | unique cover; NULL if weak/ambiguous |
| Settlements confidence | ward → township | fine assign if unique ward; else township |
| Roads / landuse / water | township (or district if NULL) | store district separately if needed; do not fake township |
| Production write | production admin ids | never write local-only ids to Supabase |
| Country / state | metadata only | not entity FK default |

Suspicion flags for national Stage 18:

- missing township on dense urban samples
- sudden spike of NULL after enabling unique-match (expected; do not force)
- local vs production id mismatch after load

---

## What to do next (ordered)

1. **Finish national places+roads dry-run** (batched Stage 05–10) without upload/apply — see `docs/myanmar-national-osm-dry-run.md`.
2. **Reconcile admin levels** local ↔ mirror (township-like wards, missing towns, state/district extras).
3. **Re-run this report** with sample 5k–20k points + staging families once Stage 05 unlocks.
4. Apply migration **145** to production only after local/mirror id mapping is defined.
5. Optional: precompute `area_m2` on admin polygons and keep planar sort (already in pipeline assign).

---

## How to re-run

```bash
# While Stage 05 may lock staging — this SQL avoids staging tables
PAGER=cat psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f tools/data-pipeline/local-osm/reports/myanmar_national_admin_assignment_report.sql \
  | tee tools/data-pipeline/local-osm/reports/_myanmar_national_admin_assignment_run.txt
```

Do **not** run `pipeline_township_assignment.sql` (CREATE OR REPLACE) while a long Stage 05 transaction is open — it waits on locks.

---

## Risks

1. Local/production admin id and level drift → wrong FK if loaders use local ids.
2. ~15% sample nulls → expect national NULL township rate until coverage repaired.
3. Country area oversize → bad for analytics if treated as land area.
4. Zero local `town` vs 12 in mirror → town-targeted assign never hits locally.
