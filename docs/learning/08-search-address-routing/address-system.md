---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Address data model and layer rules
---

# Address system

Merged summary from archived [`address-architecture.md`](../archive/old-docs/address-architecture.md).

## Layer rules

| Layer | Role |
|-------|------|
| PostgreSQL | Structured components, geometry, review state, generated full-address cache |
| API | Only reader/writer of address tables |
| Dashboard | Edits **components and matches** — not persisted full-address strings |
| Web/mobile | API for search and reverse |
| Tiles | **Not** address storage |

## Table naming

| Use | Name |
|-----|------|
| Review candidates | `import_review.address_candidates` |
| Review components | `import_review.address_components` |
| Core | `core.core_addresses`, `core.core_address_components` |

## Principles

1. Components are source of truth; full address text is derived cache
2. Bilingual: `en`, `my`, `und` language codes
3. Matched entity IDs preferred over free text where possible
4. Honest `confidence_score` and `match_type`

## Import-review address docs (archive)

- [`import-review-address-validation.md`](../archive/old-docs/import-review-address-validation.md)
- [`import-review-address-street-matching.md`](../archive/old-docs/import-review-address-street-matching.md)
- [`import-review-address-admin-inference.md`](../archive/old-docs/import-review-address-admin-inference.md)
- [`minimal-address-system.md`](../archive/old-docs/minimal-address-system.md)

## Related docs

- [Reverse address](reverse-address.md)
- [Reverse address API](../03-api/reverse-address-api.md)
