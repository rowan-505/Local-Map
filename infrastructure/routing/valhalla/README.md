# Local Valhalla (road routing)

Self-contained **Docker** workflow for building and running [Valhalla](https://github.com/valhalla/valhalla) on your machine. This folder is **infrastructure only** — it does not import `apps/api` or expose routing to the public web app yet.

**In scope:** walk, drive (`auto`), motorcycle costing on OSM road graphs.  
**Out of scope here:** OpenTripPlanner (OTP) multimodal transit — planned under `infrastructure/routing/otp/` later.

---

## Layout

```text
infrastructure/routing/valhalla/
  docker-compose.yml          # ghcr.io/gis-ops/docker-valhalla/valhalla
  config/valhalla.json.template
  data/osm/                   # place myanmar-latest.osm.pbf here (gitignored)
  data/builds/                # tiles, sqlite sidecars, symlinks (gitignored)
  scripts/
    build-valhalla.sh         # one-shot tile build
    start-valhalla.sh         # run HTTP service
    test-valhalla.sh          # status + sample route
    smoke-test-routes.sh      # walk / auto / motorcycle (short Yangon sample)
  env.example                 # optional local overrides
```

---

## Prerequisites

- Docker Desktop or Docker Engine + Compose v2
- Enough disk for Myanmar PBF (~100MB+) and built tiles (often **several GB**)
- Enough RAM for tile build (country-wide builds can take **hours**)

---

## 1. Place `myanmar-latest.osm.pbf`

Default path (not committed):

```text
infrastructure/routing/valhalla/data/osm/myanmar-latest.osm.pbf
```

Download example:

```bash
mkdir -p infrastructure/routing/valhalla/data/osm
curl -L -o infrastructure/routing/valhalla/data/osm/myanmar-latest.osm.pbf \
  https://download.geofabrik.de/asia/myanmar-latest.osm.pbf
```

Override path:

```bash
export VALHALLA_PBF_PATH=/path/to/your/extract.osm.pbf
```

For faster iteration, use a **smaller regional extract** (e.g. Yangon area) and set clip bbox env vars (see [Environment variables](#environment-variables)).

---

## 2. Build Valhalla tiles

From repo root:

```bash
chmod +x infrastructure/routing/valhalla/scripts/*.sh
infrastructure/routing/valhalla/scripts/build-valhalla.sh
```

The script:

1. Fails with a clear message if the PBF is missing  
2. Copies the PBF into `data/builds/` (Docker mount `/custom_files`) — a symlink to a path outside the mount is a dangling link inside the container  
3. Runs `docker compose` with `force_rebuild=True` and streams build logs  

Outputs land in `data/builds/` (e.g. `valhalla_tiles/`, `valhalla_tiles.tar`, `admins.sqlite`, generated `valhalla.json`).

Optional local config: copy `config/valhalla.json.template` → `data/builds/valhalla.json` **before** build if you need custom service limits (otherwise the image generates config).

---

## 3. Start Valhalla

```bash
infrastructure/routing/valhalla/scripts/start-valhalla.sh
```

Service listens on **`http://127.0.0.1:8002`** by default (`VALHALLA_PORT`).

Stop:

```bash
docker compose -f infrastructure/routing/valhalla/docker-compose.yml down
```

---

## 4. Test with curl

Health:

```bash
curl -sS http://127.0.0.1:8002/status | python3 -m json.tool
```

Route (Valhalla uses `lon`, not `lng`):

```bash
curl -sS http://127.0.0.1:8002/route \
  -H "Content-Type: application/json" \
  -d '{
    "locations": [
      {"lat": 16.8661, "lon": 96.1951},
      {"lat": 16.8409, "lon": 96.1735}
    ],
    "costing": "auto",
    "directions_options": {"units": "kilometers"}
  }' | python3 -m json.tool
```

Helper scripts:

```bash
infrastructure/routing/valhalla/scripts/test-valhalla.sh
infrastructure/routing/valhalla/scripts/smoke-test-routes.sh
```

Full Myanmar matrix + Fastify API checks: [tools/routing/README.md](../../../tools/routing/README.md)

| Costing (Valhalla) | CoreMap API profile (later) |
|--------------------|-----------------------------|
| `pedestrian`       | `walk`                      |
| `auto`             | `car`                       |
| `motorcycle`       | `motorcycle`                |

---

## 5. How the API will connect later

Per `AGENTS.md`, the **Fastify API** will own the public contract; Valhalla stays internal.

```text
apps/web  →  POST /api/routing/route  →  apps/api (adapter)
                                              ↓
                                    VALHALLA_BASE_URL (this Docker service)
```

Planned API env (not wired yet):

| Variable | Purpose |
|----------|---------|
| `VALHALLA_BASE_URL` | e.g. `http://127.0.0.1:8002` |
| `ENABLE_PUBLIC_ROUTING` | Master gate for directions endpoint |
| `VALHALLA_TIMEOUT_MS` | Upstream timeout |

The API maps `profile` → Valhalla `costing`, normalizes geometry into the universal `PostRouteResponseBody`, and records audits in `routing.routing_requests` / `routing.routing_builds` (migration `060`). **Browsers never call Valhalla directly.**

Production path (later): OSM PBF + core corrections → CI build → publish artifact → `routing.routing_build_artifacts` — same metadata model, different host than this local folder.

---

## Environment variables

Copy `env.example` → `.env` in this directory (optional), or export in your shell.

| Variable | Default | Description |
|----------|---------|-------------|
| `VALHALLA_PORT` | `8002` | Host port for HTTP API |
| `VALHALLA_DATA_DIR` | `data/builds` | Mounted to `/custom_files` in container |
| `VALHALLA_PBF_PATH` | `data/osm/myanmar-latest.osm.pbf` | Source OSM extract |
| `VALHALLA_MIN_X` / `MIN_Y` / `MAX_X` / `MAX_Y` | Myanmar bbox | Optional clip during build |

Build tuning (compose env, set in `build-valhalla.sh` defaults):

- `build_elevation=False` — faster local builds  
- `build_admins=True`, `build_time_zones=True` — recommended for routing quality  

---

## Future: OTP (multimodal)

Transit routing will live separately, e.g. `infrastructure/routing/otp/`, using the same **metadata tables** (`routing.routing_engine_configs`, multimodal profiles) but a different engine image and GTFS inputs. Do not mix OTP graphs into this Valhalla `data/builds/` directory.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `OSM PBF not found` | Path in §1; `VALHALLA_PBF_PATH` |
| Build exits, no tiles | `docker compose logs`; disk space; try smaller PBF + tighter bbox |
| `status` not HTTP 200 | `start-valhalla.sh`; port conflict on `VALHALLA_PORT` |
| Route fails far from graph | PBF coverage / bbox; rebuild with correct extract |

Image docs: [gis-ops/docker-valhalla](https://github.com/gis-ops/docker-valhalla).
