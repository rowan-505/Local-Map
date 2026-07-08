---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Debugging entry point across the stack
---

# Debugging overview

## By symptom

| Symptom | Start here |
|---------|------------|
| API 4xx/5xx, auth failures | [API debugging](api-debugging.md) |
| SQL, migration, index issues | [Database debugging](database-debugging.md) |
| Blank map, missing labels, tile errors | [Map rendering debugging](map-rendering-debugging.md) |
| Dashboard form/save errors | [Dashboard debugging](dashboard-debugging.md) |
| Production env, CORS, deploy | [Deployment debugging](deployment-debugging.md) |

## Local ports

| Service | Default |
|---------|---------|
| API | `http://localhost:3001` |
| Web | `http://localhost:5173` |
| Dashboard | `http://localhost:3000` |

## Quick health checks

```bash
curl -s http://localhost:3001/health | jq .
curl -s http://localhost:3001/health/import-review | jq .
```

## Regression scripts

```bash
node tools/core-review-api-regression.mjs
cd apps/web && npm run test:map
cd apps/api && npm run typecheck
```

## Logs

- API: Fastify logger to stdout
- Pipeline: `logs/data-pipeline/`
- Render: platform logs

## Related docs

- [Local setup](../01-getting-started/local-setup.md)
- [Common commands](../01-getting-started/common-commands.md)
