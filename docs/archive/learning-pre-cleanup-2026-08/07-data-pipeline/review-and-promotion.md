---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Import review and promotion to core
---

# Review and promotion

## Remote review path

```text
Local staging → package upload → import_review (Supabase)
→ Dashboard review → promotion → core (Supabase)
```

## API & dashboard

- API: `/api/import-review/*` — [Import review API](../03-api/import-review-api.md)
- Dashboard: [Import review](../05-dashboard/import-review.md)

## Promotion rules

- Only after review approval
- Preserve lineage in core source/version tables
- No permanent FK from core back to staging

Full mapping: archived [`staging_to_core_mapping.md`](../archive/old-docs/infrastructure/database/docs/staging_to_core_mapping.md)  
Quality rules: archived [`core_promotion_quality_rules.md`](../archive/old-docs/infrastructure/database/docs/core_promotion_quality_rules.md)

## Address / road promotion docs (archive)

- [`import-review-address-promotion.md`](../archive/old-docs/import-review-address-promotion.md)
- [`import-review-road-promotion.md`](../archive/old-docs/import-review-road-promotion.md)
- [`import-review/` folder](../archive/old-docs/import-review/) — contracts, QA, status

## Related docs

- [Data quality](data-quality.md)
- [Core review (dashboard)](../05-dashboard/core-review.md)
