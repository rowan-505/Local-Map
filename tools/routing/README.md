# Routing smoke tests

Shell scripts to verify **local Valhalla** and the **CoreMap Fastify routing API** using fixed Myanmar coordinates. No paid services or secrets required.

## Prerequisites

- `curl`, `python3`
- **Valhalla** running (see [infrastructure/routing/valhalla/README.md](../../infrastructure/routing/valhalla/README.md))
- **API** with routing enabled:

```bash
# apps/api/.env
ROUTING_ENABLED=true
VALHALLA_BASE_URL=http://localhost:8002
ROUTING_PUBLIC_PROFILES=walk,car,motorcycle
```

## Scripts

| Script | What it tests |
|--------|----------------|
| `smoke-test-valhalla-direct.sh` | `POST /route` on Valhalla (pedestrian / auto / motorcycle) |
| `smoke-test-routing-api.sh` | `GET /api/routing/health`, `POST /api/routing/route` via Fastify adapter |

Shared coordinates and helpers: `_lib.sh`.

## Commands

From repo root:

```bash
# 1) Start Valhalla (if not already)
infrastructure/routing/valhalla/scripts/start-valhalla.sh

# 2) Direct Valhalla smoke (15 route calls + status)
chmod +x tools/routing/*.sh
tools/routing/smoke-test-valhalla-direct.sh

# 3) Start API with ROUTING_ENABLED=true, then:
tools/routing/smoke-test-routing-api.sh
```

Validation-only (no Valhalla required for route matrix):

```bash
SMOKE_API_VALIDATION_ONLY=1 tools/routing/smoke-test-routing-api.sh
```

Optional environment overrides:

```bash
export API_URL=http://localhost:3001
export VALHALLA_BASE_URL=http://127.0.0.1:8002
tools/routing/smoke-test-routing-api.sh
```

Loads `apps/api/.env` then repo `.env` when present (same pattern as local dev).

## Test cases

### Myanmar routes (each profile: walk, car, motorcycle)

1. Short **Kyauktan** local hop  
2. **Kyauktan → Thanlyin**  
3. **Kyauktan → Yangon** downtown  
4. **Yangon → Bago**  
5. **Yangon → Mandalay**  

Long routes may return `no_route` if the local graph does not connect — that is treated as **pass** for API tests (`status` is `ok` or `no_route`).

### API-only policy / validation

| Case | Expected |
|------|----------|
| Invalid coordinate (`lat: 95`) | HTTP **400**, `ROUTING_VALIDATION_ERROR` |
| Same origin and destination | HTTP **400**, `ROUTING_VALIDATION_ERROR` |
| `allowedModes: ["bus"]` | HTTP **400**, `ROUTING_MODE_DISABLED` |
| `ROUTING_ENABLED=false` | HTTP **503**, `ROUTING_DISABLED` |

### Valhalla down (API)

With routing enabled but Valhalla stopped (or wrong `VALHALLA_BASE_URL` on the API):

```bash
export SMOKE_EXPECT_VALHALLA_DOWN=1
tools/routing/smoke-test-routing-api.sh
```

Expects HTTP **503** on `POST /api/routing/route` (engine unavailable).

## Related scripts

- `infrastructure/routing/valhalla/scripts/test-valhalla.sh` — quick status + one sample route  
- `infrastructure/routing/valhalla/scripts/smoke-test-routes.sh` — shorter Yangon-only Valhalla check  

`smoke-test-valhalla-direct.sh` in this folder is the **full Myanmar matrix** against Valhalla; prefer it for release checks.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| All API routes **503** `ROUTING_DISABLED` | `ROUTING_ENABLED=true` and restart API |
| API routes **503** engine errors | Valhalla up at `VALHALLA_BASE_URL` |
| Valhalla script cannot connect | `infrastructure/routing/valhalla/scripts/start-valhalla.sh` |
| Long routes `no_route` | Normal on partial/local tiles; rebuild with full Myanmar PBF if needed |
