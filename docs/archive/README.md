# Documentation archive

---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Index of archived documentation preserved during the 2026 docs reorganization
---

This folder holds **superseded, duplicate, QA-only, or historical** documents. Nothing here was deleted from the repository.

## Why archive?

During the docs reorganization (2026-07-01), scattered markdown files from `docs/`, `apps/*/docs/`, and `infrastructure/database/docs/` were consolidated into the canonical structure under [`docs/`](../README.md). Originals were copied here when:

- content was merged into a canonical doc
- the doc was a one-off QA checklist or status snapshot
- the doc was outdated but still useful as historical context

## How to use

1. Prefer the **canonical** doc linked in each archived file's frontmatter (`reason:` field).
2. Search this folder when you need historical QA steps, old route inventories, or implementation-era notes.
3. Do not treat archive content as the current source of truth without cross-checking code.

## Layout

```text
archive/
├── README.md          ← this file
└── old-docs/          ← preserved originals (folder structure mirrors pre-move paths)
    ├── address-architecture.md
    ├── import-review/
    ├── infrastructure/database/docs/
    ├── apps/api/docs/
    ├── tiles/
    ├── transport/
    └── …
```

## Canonical replacements (quick map)

| Archived topic | Canonical doc |
|----------------|---------------|
| Address architecture | [`docs/08-search-address-routing/address-system.md`](../08-search-address-routing/address-system.md) |
| Search QA | [`docs/08-search-address-routing/search-system.md`](../08-search-address-routing/search-system.md) |
| Reverse address | [`docs/08-search-address-routing/reverse-address.md`](../08-search-address-routing/reverse-address.md) |
| Import review | [`docs/05-dashboard/import-review.md`](../05-dashboard/import-review.md) + [`docs/03-api/import-review-api.md`](../03-api/import-review-api.md) |
| Tiles / PMTiles / R2 | [`docs/06-tiles/`](../06-tiles/) |
| Database pipeline | [`docs/02-database/`](../02-database/) + [`docs/07-data-pipeline/`](../07-data-pipeline/) |
| API route inventory (2026-05) | Live OpenAPI at `/docs` + [`apps/api/docs/API.md`](../../apps/api/docs/API.md) |
| Routing plans | [`docs/08-search-address-routing/routing.md`](../08-search-address-routing/routing.md) |
