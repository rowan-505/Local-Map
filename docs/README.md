# CoreMap docs

Product README is at the [repo root](../README.md). Short guides start here.

## Read in this order

1. [Overview](overview.md) — what CoreMap is and the layer rules  
2. [Getting started](getting-started.md) — run API, web, dashboard  
3. Your area (pick one):

| Area | Doc |
|------|-----|
| Database | [database.md](database.md) |
| API | [api.md](api.md) |
| Public map | [web-map.md](web-map.md) |
| Admin UI | [dashboard.md](dashboard.md) |
| Tiles | [tiles.md](tiles.md) |
| OSM / import | [data-pipeline.md](data-pipeline.md) |
| Search / address / routing | [search-routing.md](search-routing.md) |
| Deploy | [deployment.md](deployment.md) |
| Debug | [debugging.md](debugging.md) |
| Current status | [current_status.md](current_status.md) |
| V2 plan | [roadmap.md](roadmap.md) |

## First look at the code

Start with a small module, not the largest files.

| Start here | Path |
|------|------|
| API pattern | `apps/api/src/modules/places/` (`routes` → `schema` → `service` → `repo`) |
| Public map API | `apps/api/src/modules/public-map/` |
| Public map UI | `apps/web/src/features/map/` |
| Architecture rules | [`AGENTS.md`](../AGENTS.md) |

Skip on a first pass: `apps/api/src/modules/transport/transport.repo.ts` and `apps/api/src/modules/import-review/` (large, domain-heavy). Generated route list: [`apps/api/docs/API.md`](../apps/api/docs/API.md).

## Folder layout

```text
docs/
  README.md            ← this index
  *.md                 ← short guides
  ai/                  ← AI skills
  archive/             ← old audits (not current)
```

Standing knowledge stays in `docs/*.md`. One-off audits go under `docs/archive/`.
