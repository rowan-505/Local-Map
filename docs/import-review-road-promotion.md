# Import-review road promotion (Phase 9D)

Controlled promotion from `import_review.road_candidates` to `core.core_streets` and `core.core_street_names`.

**Does not** write to `routing.routing_nodes`, `routing.routing_edges`, `routing.routing_edge_names`, or `routing.routing_turn_restrictions`. Routing graph generation is Phase 9E.

## Environment variables

| Variable | Required for promote | Purpose |
|----------|---------------------|---------|
| `ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true` | Yes | Master gate for road core writes |
| `ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION=true` | Only if batch has **> 3** road items | Raises controlled batch limit |

Default limit without bulk flag: **3 road publish items** per batch.

## Workflow

1. Review/approve road candidates (`review_decision=approved`, routing validation clean).
2. Create publish batch with `allow_high_risk_families=true` and `entity_families=["roads"]` (≤3 items).
3. Validate publish batch (roads are reserved; dry-run drives promotability).
4. Run road dry-run: `POST /api/import-review/promotion/batches/:id/road-dry-run`
5. Promote: `POST /api/import-review/promotion/batches/:id/promote` with `confirmation_text: "PROMOTE"`

## curl examples

Replace `{API}`, `{TOKEN}`, `{REVIEW_BATCH_ID}`, `{PUBLISH_BATCH_ID}`.

### 1. Create tiny road publish batch

```bash
curl -sS -X POST "{API}/api/import-review/promotion/batches" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "review_batch_id": "{REVIEW_BATCH_ID}",
    "entity_families": ["roads"],
    "allow_high_risk_families": true,
    "candidate_ids": ["12345", "12346"]
  }'
```

### 2. Validate batch

```bash
curl -sS -X POST "{API}/api/import-review/promotion/batches/{PUBLISH_BATCH_ID}/validate" \
  -H "Authorization: Bearer {TOKEN}"
```

### 3. Road dry-run

```bash
curl -sS -X POST "{API}/api/import-review/promotion/batches/{PUBLISH_BATCH_ID}/road-dry-run" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "include_warnings": true }'
```

### 4. Promote (requires env flag)

```bash
export ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true

curl -sS -X POST "{API}/api/import-review/promotion/batches/{PUBLISH_BATCH_ID}/promote" \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "confirmation_text": "PROMOTE",
    "confirm_warnings": true,
    "warning_confirmation_note": "Tiny controlled road batch after dry-run review."
  }'
```

## SQL verification

### Promotion blocker breakdown (per review batch)

```bash
psql "$DATABASE_URL" -v review_batch_id=2 -f infrastructure/database/migrations/import-review/010_road-promotion-blocker-breakdown.sql
```

Reports eligibility buckets, top `validation_errors` / `validation_warnings` codes, and excluded-road primary reasons. Eligibility uses **promotion-blocking** error codes only (geometry, missing class without OSM fallback, duplicate `external_id` in core); attribute gaps (name, surface, speed) belong in warnings.

### Promoted import_review rows

```sql
SELECT id, external_id, review_decision, promotion_status, promoted_core_id, promoted_at, promoted_by
FROM import_review.road_candidates
WHERE review_batch_id = {REVIEW_BATCH_ID}
  AND promotion_status = 'promoted'
ORDER BY id;
```

### Core streets lineage

```sql
SELECT
  s.id,
  s.external_id,
  s.canonical_name,
  s.road_class_id,
  s.road_class,
  s.routing_status,
  s.source_refs->>'review_candidate_id' AS review_candidate_id,
  s.source_refs->>'publish_batch_id' AS publish_batch_id,
  s.source_refs->>'road_dry_run_status' AS road_dry_run_status
FROM core.core_streets AS s
WHERE s.source_refs->>'publish_batch_id' = '{PUBLISH_BATCH_ID}'
ORDER BY s.id;
```

### Core street names (no OSM-id fake names)

```sql
SELECT n.*
FROM core.core_street_names AS n
INNER JOIN core.core_streets AS s ON s.id = n.street_id
WHERE s.source_refs->>'publish_batch_id' = '{PUBLISH_BATCH_ID}'
ORDER BY n.street_id, n.language_code;
```

### Publish items

```sql
SELECT id, entity_family, publish_status, target_table, target_id, published_at, error_message
FROM system.system_publish_items
WHERE publish_batch_id = {PUBLISH_BATCH_ID}
ORDER BY id;
```

### Confirm routing tables untouched

```sql
SELECT count(*) FROM routing.routing_nodes;
SELECT count(*) FROM routing.routing_edges;
```

## Dashboard

`/dashboard/import-review/promotion/batches/{PUBLISH_BATCH_ID}` — road dry-run panel + promote panel show env gate, batch limits, and routing graph pending notice.
