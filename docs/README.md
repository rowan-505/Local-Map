# CoreMap docs

Product README is at the [repo root](../README.md). Short guides for humans start here. Old long audits live in [`archive/`](archive/README.md).

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
| V2 plan | [roadmap.md](roadmap.md) |

## Also keep open

| File | Role |
|------|------|
| [`AGENTS.md`](../AGENTS.md) | Full product + architecture rules (AI and humans) |
| [`apps/api/docs/API.md`](../apps/api/docs/API.md) | Generated route list |
| [`docs/ai/`](ai/README.md) | AI skills and workflows |

## Folder layout

```text
docs/
  README.md            ← this index
  *.md                 ← 12 short guides
  ai/                  ← AI skills (keep)
  archive/             ← outdated / one-time / pre-cleanup docs
```

## Doc rules

- Standing knowledge → short file in `docs/`.
- One-time audit or apply log → `docs/archive/YYYY-MM-topic/`.
- Prefer pointers to code READMEs over pasting long commands.
- Keep English simple. Keep each guide short.
