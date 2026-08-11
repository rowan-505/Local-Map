# National roads OSM reload policy — 2026-07-28

## Locked policy

1. **Identity match** national OSM roads to existing `core.core_streets` primarily by **`external_id`** via `system.pipeline_osm_identity_key` (`osm:way:…` / `osm:relation:…`).
2. **Null/blank external_id** streets in production (**486** as of 2026-07-28) are **non-match / IR review** — never auto-clobber.
3. **`safe_update`** only for fields allowlisted by the family-specific
   direct-Core SQL. Mass geometry or name rewrites stay IR **`conflict`**.
4. **First national roads apply** must be a single state/region or township slice with **≥ 1 000** rows (or full township set), identical rerun skip proven, then cleanup — before whole-country.
5. Legacy national load (`legacy_national_road_fast_core`, ~823 006 streets) remains the base; OSM reload is incremental match/update, not a wipe.

## Live production snapshot (2026-07-28)

| Metric | Value |
|---|---:|
| Active streets | 823 006 |
| `external_id` with `osm:` prefix | 822 520 |
| Null/blank `external_id` | **486** |
| Null `admin_area_id` | 25 044 (NO_MATCH / AMBIGUOUS only; non-ops refs = 0) |

## Direct-Core / classify enforcement

- Stage 08b/F2 must treat identity match as primary for roads.
- Stage 08c assigns production township admin via `prod_mirror` line overlap for importable road rows.
- `direct-core/export/export_roads.sql` exports only locally validated direct
  candidates and writes invalid rows to the local rejection report.
- `direct-core/sql/roads.sql` validates identity, references and geometry in one
  regional transaction and updates existing streets without replacing Core IDs,
  verification state, manual edits or relationships.

## Stop conditions

Abort national roads apply if:

- Stage 18 shows unexpected mass `safe_update` without field allowlist confidence
- IR conflict volume exceeds capacity for human review
- Null `external_id` core rows would be updated by non-identity spatial match alone
